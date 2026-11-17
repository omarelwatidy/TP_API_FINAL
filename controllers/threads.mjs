import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import {
  sameId, escapeRegex, getPagination, pageResult,
  getEvent, getGroup, isOrganizer, isParticipant, isGroupAdmin, isGroupMember
} from '../middleware/checks.mjs';

const Threads = class Threads {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  // Ce que l'utilisateur a le droit de faire dans le fil
  async getAccess(thread, user) {
    // Fil d'un groupe
    if (thread.group) {
      const group = await getGroup(this.models, thread.group, user);
      const admin = isGroupAdmin(group, user);
      const member = isGroupMember(group, user);

      return {
        canRead: group.type === 'public' || member || admin,
        canPost: admin || (member && group.allowMembersToPost),
        canComment: admin || member,
        canModerate: admin
      };
    }

    // Fil d'un événement
    const event = await getEvent(this.models, thread.event, user);
    const organizer = isOrganizer(event, user);
    const participant = isParticipant(event, user);

    return {
      canRead: organizer || participant,
      canPost: organizer || participant,
      canComment: organizer || participant,
      canModerate: organizer
    };
  }

  async getThread(id, user) {
    const thread = await this.models.Thread.findById(id);
    if (!thread) throw new AppError(404, 'Fil de discussion introuvable');

    const access = await this.getAccess(thread, user);
    return { thread, access };
  }

  async getMessage(id, user) {
    const message = await this.models.Message.findById(id);
    if (!message) throw new AppError(404, 'Message introuvable');

    const { access } = await this.getThread(message.thread, user);
    return { message, access };
  }

  // ------------------------------------------------------------------ Fils
  create() {
    this.app.post('/threads', authenticate, async (req, res) => {
      const { title, group, event } = req.body;

      // Un fil est lié à un groupe OU à un événement, pas les deux
      if (Boolean(group) === Boolean(event)) {
        throw new AppError(422, 'Un fil est lié à un groupe OU à un événement (pas les deux)');
      }

      if (group) {
        const g = await getGroup(this.models, group, req.user);
        if (!isGroupAdmin(g, req.user)) {
          throw new AppError(403, 'Seul un administrateur peut créer le fil du groupe');
        }
      } else {
        const e = await getEvent(this.models, event, req.user);
        if (!isOrganizer(e, req.user)) {
          throw new AppError(403, 'Seul un organisateur peut créer le fil de l\'événement');
        }
      }

      try {
        const thread = await this.models.Thread.create({
          title, group, event, createdBy: req.user.id
        });
        res.status(201).json(thread);
      } catch (err) {
        // Index unique : il y a déjà un fil pour ce groupe / cet événement
        if (err.code === 11000) {
          throw new AppError(409, 'Un fil de discussion existe déjà pour ce groupe/événement');
        }
        throw err;
      }
    });
  }

  list() {
    this.app.get('/threads', authenticate, async (req, res) => {
      const { group, event } = req.query;

      if (Boolean(group) === Boolean(event)) {
        throw new AppError(422, 'Précisez ?group=ID ou ?event=ID (un seul des deux)');
      }

      const threads = await this.models.Thread.find(group ? { group: String(group) } : { event: String(event) });

      // On ne renvoie que les fils que l'utilisateur a le droit de lire
      const visible = [];
      for (const thread of threads) {
        const access = await this.getAccess(thread, req.user); // eslint-disable-line no-await-in-loop
        if (access.canRead) {
          visible.push(thread);
        }
      }

      res.status(200).json(visible);
    });
  }

  show() {
    this.app.get('/threads/:id', authenticate, async (req, res) => {
      const { thread, access } = await this.getThread(req.params.id, req.user);
      if (!access.canRead) throw new AppError(403, 'Accès interdit');

      res.status(200).json(thread);
    });
  }

  update() {
    this.app.put('/threads/:id', authenticate, async (req, res) => {
      const { thread, access } = await this.getThread(req.params.id, req.user);
      if (!access.canModerate) throw new AppError(403, 'Accès interdit');

      thread.title = req.body.title;
      await thread.save();

      res.status(200).json(thread);
    });
  }

  remove() {
    this.app.delete('/threads/:id', authenticate, async (req, res) => {
      const { thread, access } = await this.getThread(req.params.id, req.user);
      if (!access.canModerate) throw new AppError(403, 'Accès interdit');

      // On supprime aussi les messages du fil
      await this.models.Message.deleteMany({ thread: thread.id });
      await thread.deleteOne();

      res.status(204).end();
    });
  }

  // -------------------------------------------------------------- Messages
  createMessage() {
    this.app.post('/threads/:id/messages', authenticate, async (req, res) => {
      const { thread, access } = await this.getThread(req.params.id, req.user);
      if (!access.canPost) throw new AppError(403, 'Vous n\'avez pas le droit de publier dans ce fil');

      const message = await this.models.Message.create({
        thread: thread.id,
        author: req.user.id,
        content: req.body.content
      });

      res.status(201).json(message);
    });
  }

  listMessages() {
    this.app.get('/threads/:id/messages', authenticate, async (req, res) => {
      const { thread, access } = await this.getThread(req.params.id, req.user);
      if (!access.canRead) throw new AppError(403, 'Accès interdit');

      const p = getPagination(req.query);
      const filter = { thread: thread.id };
      if (req.query.q) {
        filter.content = new RegExp(escapeRegex(req.query.q), 'i');
      }

      const messages = await this.models.Message.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit);
      const total = await this.models.Message.countDocuments(filter);

      res.status(200).json(pageResult(messages, total, p));
    });
  }

  showMessage() {
    this.app.get('/messages/:id', authenticate, async (req, res) => {
      const { message, access } = await this.getMessage(req.params.id, req.user);
      if (!access.canRead) throw new AppError(403, 'Accès interdit');

      res.status(200).json(message);
    });
  }

  updateMessage() {
    this.app.put('/messages/:id', authenticate, async (req, res) => {
      const { message } = await this.getMessage(req.params.id, req.user);

      // Seul l'auteur modifie son message
      if (!sameId(message.author, req.user.id)) {
        throw new AppError(403, 'Vous ne pouvez modifier que vos messages');
      }

      message.content = req.body.content;
      await message.save();

      res.status(200).json(message);
    });
  }

  removeMessage() {
    this.app.delete('/messages/:id', authenticate, async (req, res) => {
      const { message, access } = await this.getMessage(req.params.id, req.user);

      // L'auteur ou un modérateur (admin du groupe / organisateur)
      if (!sameId(message.author, req.user.id) && !access.canModerate) {
        throw new AppError(403, 'Accès interdit');
      }

      await message.deleteOne();
      res.status(204).end();
    });
  }

  // ----------------------------------------------------------- Commentaires
  listComments() {
    this.app.get('/messages/:id/comments', authenticate, async (req, res) => {
      const { message, access } = await this.getMessage(req.params.id, req.user);
      if (!access.canRead) throw new AppError(403, 'Accès interdit');

      res.status(200).json(message.comments);
    });
  }

  createComment() {
    this.app.post('/messages/:id/comments', authenticate, async (req, res) => {
      const { message, access } = await this.getMessage(req.params.id, req.user);
      if (!access.canComment) throw new AppError(403, 'Seuls les membres/participants peuvent commenter');

      message.comments.push({ author: req.user.id, content: req.body.content });
      await message.save();

      res.status(201).json(message.comments[message.comments.length - 1]);
    });
  }

  updateComment() {
    this.app.put('/messages/:id/comments/:commentId', authenticate, async (req, res) => {
      const { message } = await this.getMessage(req.params.id, req.user);

      const comment = message.comments.id(req.params.commentId);
      if (!comment) throw new AppError(404, 'Commentaire introuvable');
      if (!sameId(comment.author, req.user.id)) {
        throw new AppError(403, 'Vous ne pouvez modifier que vos commentaires');
      }

      comment.content = req.body.content;
      await message.save();

      res.status(200).json(comment);
    });
  }

  removeComment() {
    this.app.delete('/messages/:id/comments/:commentId', authenticate, async (req, res) => {
      const { message, access } = await this.getMessage(req.params.id, req.user);

      const comment = message.comments.id(req.params.commentId);
      if (!comment) throw new AppError(404, 'Commentaire introuvable');
      if (!sameId(comment.author, req.user.id) && !access.canModerate) {
        throw new AppError(403, 'Accès interdit');
      }

      message.comments.pull(req.params.commentId);
      await message.save();

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
    this.listComments();
    this.createComment();
    this.updateComment();
    this.removeComment();
  }
};

export default Threads;
