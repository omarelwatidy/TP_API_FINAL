import { body } from 'express-validator';
import validate from '../middleware/validate.mjs';
import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import {
  findOr404, allow, sameId, paginate, pageOf
} from '../services/helpers.mjs';
import { loadEvent, isEventOrganizer, isEventParticipant } from '../services/access.mjs';
import {
  text, idParam, idBody, idQuery, pagination
} from '../services/rules.mjs';

const maybe = (chain, optional) => (optional ? chain.optional() : chain);

// Les chaînes de validation sont modifiables : on en fabrique de neuves à chaque appel
const questionRules = (optional = false) => [
  maybe(body('questions'), optional).isArray({ min: 1, max: 50 }).withMessage('questions : 1 à 50 questions'),
  maybe(body('questions.*.text'), optional).isString().trim().isLength({ min: 1, max: 300 })
    .withMessage('question : 1 à 300 caractères')
    .escape(),
  maybe(body('questions.*.options'), optional).isArray({ min: 2, max: 20 })
    .withMessage('options : 2 à 20 réponses possibles'),
  maybe(body('questions.*.options.*.label'), optional).isString().trim().isLength({ min: 1, max: 200 })
    .withMessage('réponse : 1 à 200 caractères')
    .escape()
];

const cleanQuestions = (questions) => questions.map((q) => ({
  text: q.text,
  options: q.options.map((o) => ({ label: o.label }))
}));

const answerRules = () => [
  body('answers').isArray({ min: 1, max: 50 }).withMessage('answers : tableau attendu'),
  body('answers.*.question').isMongoId().withMessage('question : identifiant invalide'),
  body('answers.*.option').isMongoId().withMessage('option : identifiant invalide')
];

const Polls = class Polls {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  async loadPoll(id, user) {
    const poll = await findOr404(this.models.Poll.findById(id), 'Sondage');
    const event = await loadEvent(this.models, poll.event, user);
    return {
      poll,
      event,
      participant: isEventParticipant(event, user),
      organizer: isEventOrganizer(event, user)
    };
  }

  create() {
    const rules = () => [idBody('event'), text('title', { min: 3, max: 200 }), ...questionRules()];

    this.app.post('/polls', authenticate, rules(), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.body.event, req.user);
      allow(isEventOrganizer(event, req.user), 'Seul un organisateur peut créer un sondage');

      const poll = await this.models.Poll.create({
        event: event.id,
        title: req.body.title,
        questions: cleanQuestions(req.body.questions),
        createdBy: req.user.id
      });
      res.status(201).json(poll);
    });
  }

  list() {
    this.app.get('/polls', authenticate, idQuery('event'), pagination, validate, async (req, res) => {
      const event = await loadEvent(this.models, req.query.event, req.user);
      allow(isEventParticipant(event, req.user) || isEventOrganizer(event, req.user));

      const p = paginate(req.query);
      const filter = { event: event.id };
      const [polls, total] = await Promise.all([
        this.models.Poll.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit),
        this.models.Poll.countDocuments(filter)
      ]);
      res.status(200).json(pageOf(polls, total, p));
    });
  }

  show() {
    this.app.get('/polls/:id', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadPoll(req.params.id, req.user);
      allow(ctx.participant || ctx.organizer);
      res.status(200).json(ctx.poll);
    });
  }

  update() {
    const rules = () => [text('title', { min: 3, max: 200, optional: true })];

    this.app.put('/polls/:id', authenticate, idParam(), rules(), questionRules(true), validate, async (req, res) => {
      const ctx = await this.loadPoll(req.params.id, req.user);
      allow(ctx.organizer);

      if (req.body.title) {
        ctx.poll.title = req.body.title;
      }
      if (req.body.questions) {
        const answered = await this.models.PollAnswer.exists({ poll: ctx.poll.id });
        if (answered) {
          throw new AppError(409, 'Impossible de modifier les questions : des participants ont déjà répondu');
        }
        ctx.poll.questions = cleanQuestions(req.body.questions);
      }
      await ctx.poll.save();
      res.status(200).json(ctx.poll);
    });
  }

  remove() {
    this.app.delete('/polls/:id', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadPoll(req.params.id, req.user);
      allow(ctx.organizer);

      await this.models.PollAnswer.deleteMany({ poll: ctx.poll.id });
      await ctx.poll.deleteOne();
      res.status(204).end();
    });
  }

  // Une réponse (et une seule) par question, avec une option qui appartient à la question
  static checkAnswers(poll, answers) {
    if (answers.length !== poll.questions.length) {
      throw new AppError(422, 'Il faut répondre à chaque question du sondage');
    }
    poll.questions.forEach((question) => {
      const matching = answers.filter((a) => sameId(a.question, question.id));
      if (matching.length !== 1) {
        throw new AppError(422, `Il faut exactement une réponse pour la question ${question.id}`);
      }
      if (!question.options.some((o) => sameId(o.id, matching[0].option))) {
        throw new AppError(422, `Option invalide pour la question ${question.id}`);
      }
    });
    return answers.map((a) => ({ question: a.question, option: a.option }));
  }

  answer() {
    this.app.post('/polls/:id/answers', authenticate, idParam(), answerRules(), validate, async (req, res) => {
      const ctx = await this.loadPoll(req.params.id, req.user);
      allow(ctx.participant, 'Réservé aux participants de l\'événement');

      if (await this.models.PollAnswer.exists({ poll: ctx.poll.id, user: req.user.id })) {
        throw new AppError(409, 'Vous avez déjà répondu à ce sondage (utilisez PUT pour modifier)');
      }
      const answers = Polls.checkAnswers(ctx.poll, req.body.answers);
      const saved = await this.models.PollAnswer.create({ poll: ctx.poll.id, user: req.user.id, answers });
      res.status(201).json(saved);
    });

    this.app.put('/polls/:id/answers', authenticate, idParam(), answerRules(), validate, async (req, res) => {
      const ctx = await this.loadPoll(req.params.id, req.user);
      allow(ctx.participant, 'Réservé aux participants de l\'événement');

      const saved = await findOr404(
        this.models.PollAnswer.findOne({ poll: ctx.poll.id, user: req.user.id }),
        'Votre réponse'
      );
      saved.answers = Polls.checkAnswers(ctx.poll, req.body.answers);
      await saved.save();
      res.status(200).json(saved);
    });

    this.app.get('/polls/:id/answers/me', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadPoll(req.params.id, req.user);
      allow(ctx.participant);

      const saved = await findOr404(
        this.models.PollAnswer.findOne({ poll: ctx.poll.id, user: req.user.id }),
        'Votre réponse'
      );
      res.status(200).json(saved);
    });

    this.app.delete('/polls/:id/answers', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadPoll(req.params.id, req.user);
      allow(ctx.participant);

      await findOr404(
        this.models.PollAnswer.findOneAndDelete({ poll: ctx.poll.id, user: req.user.id }),
        'Votre réponse'
      );
      res.status(204).end();
    });
  }

  results() {
    this.app.get('/polls/:id/results', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadPoll(req.params.id, req.user);
      allow(ctx.participant || ctx.organizer);

      const answers = await this.models.PollAnswer.find({ poll: ctx.poll.id });
      const results = ctx.poll.questions.map((q) => ({
        questionId: q.id,
        question: q.text,
        options: q.options.map((o) => ({
          optionId: o.id,
          label: o.label,
          votes: answers.filter((a) => a.answers.some(
            (x) => sameId(x.question, q.id) && sameId(x.option, o.id)
          )).length
        }))
      }));

      res.status(200).json({ pollId: ctx.poll.id, title: ctx.poll.title, totalAnswers: answers.length, results });
    });
  }

  run() {
    this.create();
    this.list();
    this.show();
    this.update();
    this.remove();
    this.answer();
    this.results();
  }
};

export default Polls;
