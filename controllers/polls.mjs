import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import {
  sameId, getPagination, pageResult, getEvent, isOrganizer, isParticipant
} from '../middleware/checks.mjs';

// Prépare les questions envoyées par l'utilisateur (on ne garde que text, options et label)
const cleanQuestions = (questions) => {
  if (!Array.isArray(questions)) {
    throw new AppError(422, 'questions doit être un tableau');
  }

  return questions.map((q) => ({
    text: q && q.text,
    options: q && Array.isArray(q.options) ? q.options.map((o) => ({ label: o && o.label })) : []
  }));
};

// Vérifie les réponses : une réponse (et une seule) par question, avec une option de cette question
const checkAnswers = (poll, answers) => {
  if (!Array.isArray(answers) || answers.length !== poll.questions.length) {
    throw new AppError(422, 'Il faut répondre à chaque question du sondage');
  }

  poll.questions.forEach((question) => {
    const found = answers.filter((a) => a && sameId(a.question, question.id));
    if (found.length !== 1) {
      throw new AppError(422, `Il faut exactement une réponse pour la question ${question.id}`);
    }
    const optionOk = question.options.some((o) => sameId(o.id, found[0].option));
    if (!optionOk) {
      throw new AppError(422, `Option invalide pour la question ${question.id}`);
    }
  });

  return answers.map((a) => ({ question: a.question, option: a.option }));
};

const Polls = class Polls {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  async getPoll(id, user) {
    const poll = await this.models.Poll.findById(id);
    if (!poll) throw new AppError(404, 'Sondage introuvable');

    const event = await getEvent(this.models, poll.event, user);
    return { poll, event };
  }

  create() {
    this.app.post('/polls', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.body.event, req.user);
      if (!isOrganizer(event, req.user)) {
        throw new AppError(403, 'Seul un organisateur peut créer un sondage');
      }

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
    this.app.get('/polls', authenticate, async (req, res) => {
      if (!req.query.event) throw new AppError(422, 'Le paramètre event est obligatoire');

      const event = await getEvent(this.models, String(req.query.event), req.user);
      if (!isParticipant(event, req.user) && !isOrganizer(event, req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      const p = getPagination(req.query);
      const filter = { event: event.id };
      const polls = await this.models.Poll.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit);
      const total = await this.models.Poll.countDocuments(filter);

      res.status(200).json(pageResult(polls, total, p));
    });
  }

  show() {
    this.app.get('/polls/:id', authenticate, async (req, res) => {
      const { poll, event } = await this.getPoll(req.params.id, req.user);
      if (!isParticipant(event, req.user) && !isOrganizer(event, req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      res.status(200).json(poll);
    });
  }

  update() {
    this.app.put('/polls/:id', authenticate, async (req, res) => {
      const { poll, event } = await this.getPoll(req.params.id, req.user);
      if (!isOrganizer(event, req.user)) throw new AppError(403, 'Accès interdit');

      if (req.body.title !== undefined) {
        poll.title = req.body.title;
      }

      if (req.body.questions !== undefined) {
        // On ne change plus les questions quand quelqu'un a déjà répondu
        const answered = await this.models.PollAnswer.exists({ poll: poll.id });
        if (answered) {
          throw new AppError(409, 'Impossible de modifier les questions : des participants ont déjà répondu');
        }
        poll.questions = cleanQuestions(req.body.questions);
      }

      await poll.save();
      res.status(200).json(poll);
    });
  }

  remove() {
    this.app.delete('/polls/:id', authenticate, async (req, res) => {
      const { poll, event } = await this.getPoll(req.params.id, req.user);
      if (!isOrganizer(event, req.user)) throw new AppError(403, 'Accès interdit');

      await this.models.PollAnswer.deleteMany({ poll: poll.id });
      await poll.deleteOne();

      res.status(204).end();
    });
  }

  // ------------------------------------------------------------- Réponses
  answer() {
    this.app.post('/polls/:id/answers', authenticate, async (req, res) => {
      const { poll, event } = await this.getPoll(req.params.id, req.user);
      if (!isParticipant(event, req.user)) {
        throw new AppError(403, 'Réservé aux participants de l\'événement');
      }

      const already = await this.models.PollAnswer.exists({ poll: poll.id, user: req.user.id });
      if (already) {
        throw new AppError(409, 'Vous avez déjà répondu à ce sondage (utilisez PUT pour modifier)');
      }

      const answers = checkAnswers(poll, req.body.answers);
      const saved = await this.models.PollAnswer.create({ poll: poll.id, user: req.user.id, answers });

      res.status(201).json(saved);
    });
  }

  updateAnswer() {
    this.app.put('/polls/:id/answers', authenticate, async (req, res) => {
      const { poll, event } = await this.getPoll(req.params.id, req.user);
      if (!isParticipant(event, req.user)) {
        throw new AppError(403, 'Réservé aux participants de l\'événement');
      }

      const saved = await this.models.PollAnswer.findOne({ poll: poll.id, user: req.user.id });
      if (!saved) throw new AppError(404, 'Votre réponse introuvable');

      saved.answers = checkAnswers(poll, req.body.answers);
      await saved.save();

      res.status(200).json(saved);
    });
  }

  myAnswer() {
    this.app.get('/polls/:id/answers/me', authenticate, async (req, res) => {
      const { poll, event } = await this.getPoll(req.params.id, req.user);
      if (!isParticipant(event, req.user)) throw new AppError(403, 'Accès interdit');

      const saved = await this.models.PollAnswer.findOne({ poll: poll.id, user: req.user.id });
      if (!saved) throw new AppError(404, 'Votre réponse introuvable');

      res.status(200).json(saved);
    });
  }

  removeAnswer() {
    this.app.delete('/polls/:id/answers', authenticate, async (req, res) => {
      const { poll, event } = await this.getPoll(req.params.id, req.user);
      if (!isParticipant(event, req.user)) throw new AppError(403, 'Accès interdit');

      const saved = await this.models.PollAnswer.findOneAndDelete({ poll: poll.id, user: req.user.id });
      if (!saved) throw new AppError(404, 'Votre réponse introuvable');

      res.status(204).end();
    });
  }

  // Nombre de votes pour chaque réponse possible
  results() {
    this.app.get('/polls/:id/results', authenticate, async (req, res) => {
      const { poll, event } = await this.getPoll(req.params.id, req.user);
      if (!isParticipant(event, req.user) && !isOrganizer(event, req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      const allAnswers = await this.models.PollAnswer.find({ poll: poll.id });

      const results = poll.questions.map((question) => ({
        questionId: question.id,
        question: question.text,
        options: question.options.map((option) => {
          let votes = 0;
          allAnswers.forEach((one) => {
            const chosen = one.answers.some((a) => sameId(a.question, question.id) && sameId(a.option, option.id));
            if (chosen) votes += 1;
          });
          return { optionId: option.id, label: option.label, votes };
        })
      }));

      res.status(200).json({
        pollId: poll.id,
        title: poll.title,
        totalAnswers: allAnswers.length,
        results
      });
    });
  }

  run() {
    this.create();
    this.list();
    this.show();
    this.update();
    this.remove();
    this.answer();
    this.updateAnswer();
    this.myAnswer();
    this.removeAnswer();
    this.results();
  }
};

export default Polls;
