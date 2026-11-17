import validate from '../middleware/validate.mjs';
import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import {
  findOr404, allow, sameId, escapeRegex, paginate, pageOf
} from '../services/helpers.mjs';
import {
  loadEvent, loadGroup, isEventOrganizer, isGroupAdmin, threadAccess
} from '../services/access.mjs';
import { deleteThreadsWhere } from '../services/cascade.mjs';
import commentRoutes from '../services/comments.mjs';
import {
  text, idParam, idBody, idQuery, pagination, search
} from '../services/rules.mjs';

const Threads = class Threads {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  async loadThread(id, user) {
    const thread = await findOr404(this.models.Thread.findById(id), 'Fil de discussion');
    const access = await threadAccess(this.models, thread, user);
    return { thread, ...access };
  }

  async loadMessage(id, user) {
    const message = await findOr404(this.models.Message.findById(id), 'Message');
    const ctx = await this.loadThread(message.thread, user);
    return { message, ...ctx };
  }

  create() {
    const rules = () => [text('title', { min: 1, max: 200 }), idBody('group', true), idBody('event', true)];

    this.app.post('/threads', authenticate, rules(), validate, async (req, res) => {
      const { group, event, title } = req.body;

      if (Boolean(group) === Boolean(event)) {
        throw new AppError(422, 'Un fil est lié à un groupe OU à un événement (pas les deux)');
      }

      if (group) {
        const g = await loadGroup(this.models, group, req.user);
        allow(isGroupAdmin(g, req.user), 'Seul un administrateur peut créer le fil du groupe');
      } else {
        const e = await loadEvent(this.models, event, req.user);
        allow(isEventOrganizer(e, req.user), 'Seul un organisateur peut créer le fil de l\'événement');
      }

      try {
        const thread = await this.models.Thread.create({
          title, group, event, createdBy: req.user.id
        });
        res.status(201).json(thread);
      } catch (err) {
        if (err.code === 11000) {
          throw new AppError(409, 'Un fil de discussion existe déjà pour ce groupe/événement');
        }
        throw err;
      }
    });
  }

  list() {
    const rules = [idQuery('group', true), idQuery('event', true)];

    this.app.get('/threads', authenticate, rules, validate, async (req, res) => {
      const { group, event } = req.query;
      if (Boolean(group) === Boolean(event)) {
        throw new AppError(422, 'Précisez ?group=ID ou ?event=ID (un seul des deux)');
      }

      const threads = await this.models.Thread.find(group ? { group } : { event });
      const visible = [];
      for (const thread of threads) {
        const access = await threadAccess(this.models, thread, req.user); // eslint-disable-line no-await-in-loop
        if (access.canRead) {
          visible.push(thread);
        }
      }
      res.status(200).json(visible);
    });
  }

  show() {
    this.app.get('/threads/:id', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadThread(req.params.id, req.user);
      allow(ctx.canRead);
      res.status(200).json(ctx.thread);
    });
  }

  update() {
    this.app.put('/threads/:id', authenticate, idParam(), text('title', { min: 1, max: 200 }), validate, async (req, res) => {
      const ctx = await this.loadThread(req.params.id, req.user);
      allow(ctx.canModerate);

      ctx.thread.title = req.body.title;
      await ctx.thread.save();
      res.status(200).json(ctx.thread);
    });
  }

  remove() {
    this.app.delete('/threads/:id', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadThread(req.params.id, req.user);
      allow(ctx.canModerate);

      await deleteThreadsWhere(this.models, { _id: ctx.thread.id });
      res.status(204).end();
    });
  }

  // ---------------------------------------------------------------- Messages
  createMessage() {
    this.app.post('/threads/:id/messages', authenticate, idParam(), text('content', { min: 1, max: 2000 }), validate, async (req, res) => {
      const ctx = await this.loadThread(req.params.id, req.user);
      allow(ctx.canPost, 'Vous n\'avez pas le droit de publier dans ce fil');

      const message = await this.models.Message.create({
        thread: ctx.thread.id, author: req.user.id, content: req.body.content
      });
      res.status(201).json(message);
    });
  }

  listMessages() {
    this.app.get('/threads/:id/messages', authenticate, idParam(), pagination, search, validate, async (req, res) => {
      const ctx = await this.loadThread(req.params.id, req.user);
      allow(ctx.canRead);

      const p = paginate(req.query);
      const filter = { thread: ctx.thread.id };
      if (req.query.q) {
        filter.content = new RegExp(escapeRegex(req.query.q), 'i');
      }

      const [messages, total] = await Promise.all([
        this.models.Message.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit),
        this.models.Message.countDocuments(filter)
      ]);
      res.status(200).json(pageOf(messages, total, p));
    });
  }

  showMessage() {
    this.app.get('/messages/:id', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadMessage(req.params.id, req.user);
      allow(ctx.canRead);
      res.status(200).json(ctx.message);
    });
  }

  updateMessage() {
    this.app.put('/messages/:id', authenticate, idParam(), text('content', { min: 1, max: 2000 }), validate, async (req, res) => {
      const ctx = await this.loadMessage(req.params.id, req.user);
      allow(sameId(ctx.message.author, req.user.id), 'Vous ne pouvez modifier que vos messages');

      ctx.message.content = req.body.content;
      await ctx.message.save();
      res.status(200).json(ctx.message);
    });
  }

  removeMessage() {
    this.app.delete('/messages/:id', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadMessage(req.params.id, req.user);
      allow(sameId(ctx.message.author, req.user.id) || ctx.canModerate);

      await ctx.message.deleteOne();
      res.status(204).end();
    });
  }

  run() {
    this.create();
    this.list();
    this.show();
    this.update();
    this.remove();
    this.createMessage();
    this.listMessages();
    this.showMessage();
    this.updateMessage();
    this.removeMessage();

    commentRoutes(this.app, {
      path: '/messages',
      load: async (req) => {
        const ctx = await this.loadMessage(req.params.id, req.user);
        return { doc: ctx.message, ...ctx };
      }
    });
  }
};

export default Threads;
