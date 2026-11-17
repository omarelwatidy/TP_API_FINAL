import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import config from '../config.mjs';
import {
  sameId, isIn, escapeRegex, pick, getPagination, pageResult,
  isAdmin, isOrganizer, isParticipant, getEvent, isGroupAdmin, isGroupMember
} from '../middleware/checks.mjs';

const FIELDS = [
  'name', 'description', 'startDate', 'endDate', 'location', 'coverPhoto',
  'visibility', 'shoppingListEnabled', 'ticketingEnabled'
];

const Events = class Events {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  // Vérifie que tous les ids correspondent à de vrais utilisateurs
  async usersExist(ids) {
    const count = await this.models.User.countDocuments({ _id: { $in: ids } });
    if (count !== ids.length) {
      throw new AppError(422, 'Un ou plusieurs utilisateurs sont introuvables');
    }
  }

  create() {
    this.app.post('/events', authenticate, async (req, res) => {
      const data = pick(req.body, FIELDS);

      // Le créateur est organisateur. On utilise des Set pour éviter les doublons.
      const organizers = new Set([String(req.user.id)]);
      const members = new Set();

      if (Array.isArray(req.body.organizers)) {
        req.body.organizers.forEach((id) => organizers.add(String(id)));
      }
      if (Array.isArray(req.body.members)) {
        req.body.members.forEach((id) => members.add(String(id)));
      }

      // Événement dans un groupe : tous les membres du groupe sont invités
      if (req.body.group) {
        const group = await this.models.Group.findById(req.body.group);
        if (!group) throw new AppError(404, 'Groupe introuvable');

        const allowed = isGroupAdmin(group, req.user)
          || (isGroupMember(group, req.user) && group.allowMembersToCreateEvents);
        if (!allowed) throw new AppError(403, 'Vous ne pouvez pas créer d\'événement dans ce groupe');

        data.group = group.id;
        group.members.forEach((id) => members.add(String(id)));
      }

      // Un organisateur n'est pas aussi un simple participant
      organizers.forEach((id) => members.delete(id));

      const event = new this.models.Event({
        ...data,
        organizers: [...organizers],
        members: [...members],
        createdBy: req.user.id
      });

      await event.validate(); // vérifie les champs avant de chercher les utilisateurs
      await this.usersExist([...organizers, ...members]);
      await event.save();

      res.status(201).json(event);
    });
  }

  searchEvents() {
    this.app.get('/events', authenticate, async (req, res) => {
      const p = getPagination(req.query);
      const uid = req.user.id;
      const conditions = [];

      // Public : visible par tous. Privé : seulement les invités et organisateurs.
      if (!isAdmin(req.user)) {
        conditions.push({ $or: [{ visibility: 'public' }, { organizers: uid }, { members: uid }] });
      }
      if (req.query.q) {
        const regex = new RegExp(escapeRegex(req.query.q), 'i');
        conditions.push({ $or: [{ name: regex }, { description: regex }] });
      }
      if (req.query.location) {
        conditions.push({ location: new RegExp(escapeRegex(req.query.location), 'i') });
      }
      if (req.query.from) {
        conditions.push({ startDate: { $gte: new Date(String(req.query.from)) } });
      }
      if (req.query.to) {
        conditions.push({ startDate: { $lte: new Date(String(req.query.to)) } });
      }
      if (req.query.visibility) {
        conditions.push({ visibility: String(req.query.visibility) });
      }
      if (req.query.group) {
        conditions.push({ group: String(req.query.group) });
      }
      if (req.query.mine === 'true') {
        conditions.push({ $or: [{ organizers: uid }, { members: uid }] });
      }
      const filter = conditions.length > 0 ? { $and: conditions } : {};

      const events = await this.models.Event.find(filter).sort({ startDate: 1 }).skip(p.skip).limit(p.limit);
      const total = await this.models.Event.countDocuments(filter);

      res.status(200).json(pageResult(events, total, p));
    });
  }

  show() {
    this.app.get('/events/:id', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);

      res.status(200).json({
        ...event.toJSON(),
        participantsCount: event.organizers.length + event.members.length
      });
    });
  }

  update() {
    this.app.put('/events/:id', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);
      if (!isOrganizer(event, req.user)) throw new AppError(403, 'Accès interdit');

      event.set(pick(req.body, FIELDS));
      await event.save();

      res.status(200).json(event);
    });
  }

  remove() {
    this.app.delete('/events/:id', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);
      if (!isOrganizer(event, req.user)) throw new AppError(403, 'Accès interdit');

      const { models } = this;

      // On supprime tout ce qui dépend de l'événement : fil, albums, sondages, billets, shopping list
      const threads = await models.Thread.find({ event: event.id });
      await models.Message.deleteMany({ thread: { $in: threads.map((t) => t._id) } });
      await models.Thread.deleteMany({ event: event.id });

      const albums = await models.Album.find({ event: event.id });
      await models.Photo.deleteMany({ album: { $in: albums.map((a) => a._id) } });
      await models.Album.deleteMany({ event: event.id });

      const polls = await models.Poll.find({ event: event.id });
      await models.PollAnswer.deleteMany({ poll: { $in: polls.map((p) => p._id) } });
      await models.Poll.deleteMany({ event: event.id });

      await models.TicketType.deleteMany({ event: event.id });
      await models.Ticket.deleteMany({ event: event.id });
      await models.ShoppingItem.deleteMany({ event: event.id });

      await event.deleteOne();

      res.status(204).end();
    });
  }

  // Rejoindre un événement public
  join() {
    this.app.post('/events/:id/join', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);

      if (event.visibility !== 'public') throw new AppError(403, 'Événement privé : invitation requise');
      if (isParticipant(event, req.user)) throw new AppError(409, 'Vous participez déjà à cet événement');

      event.members.push(req.user.id);
      await event.save();

      res.status(200).json(event);
    });
  }

  leave() {
    this.app.post('/events/:id/leave', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);

      if (!isParticipant(event, req.user)) throw new AppError(409, 'Vous ne participez pas à cet événement');

      if (isIn(event.organizers, req.user.id)) {
        // Un événement a toujours au moins un organisateur
        if (event.organizers.length === 1) {
          throw new AppError(409, 'Nommez un autre organisateur avant de quitter l\'événement');
        }
        event.organizers.pull(req.user.id);
      }
      event.members.pull(req.user.id);
      await event.save();

      res.status(200).json(event);
    });
  }

  addMember() {
    this.app.post('/events/:id/members', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);
      if (!isOrganizer(event, req.user)) throw new AppError(403, 'Accès interdit');

      const user = await this.models.User.findById(req.body.userId);
      if (!user) throw new AppError(404, 'Utilisateur introuvable');
      if (isParticipant(event, { id: user.id })) throw new AppError(409, 'Cet utilisateur participe déjà');

      event.members.push(user.id);
      await event.save();

      res.status(200).json(event);
    });
  }

  // Un organisateur retire un participant, ou un participant se retire lui-même
  removeMember() {
    this.app.delete('/events/:id/members/:userId', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);

      if (!isOrganizer(event, req.user) && !sameId(req.params.userId, req.user.id)) {
        throw new AppError(403, 'Accès interdit');
      }
      if (!isIn(event.members, req.params.userId)) throw new AppError(404, 'Ce participant est introuvable');

      event.members.pull(req.params.userId);
      await event.save();

      res.status(200).json(event);
    });
  }

  addOrganizer() {
    this.app.post('/events/:id/organizers', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);
      if (!isOrganizer(event, req.user)) throw new AppError(403, 'Accès interdit');

      const user = await this.models.User.findById(req.body.userId);
      if (!user) throw new AppError(404, 'Utilisateur introuvable');
      if (isIn(event.organizers, user.id)) throw new AppError(409, 'Cet utilisateur est déjà organisateur');

      // Le participant est promu organisateur
      event.members.pull(user.id);
      event.organizers.push(user.id);
      await event.save();

      res.status(200).json(event);
    });
  }

  removeOrganizer() {
    this.app.delete('/events/:id/organizers/:userId', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);
      if (!isOrganizer(event, req.user)) throw new AppError(403, 'Accès interdit');

      if (!isIn(event.organizers, req.params.userId)) {
        throw new AppError(404, 'Cet utilisateur n\'est pas organisateur');
      }
      if (event.organizers.length === 1) {
        throw new AppError(409, 'Un événement a toujours au moins un organisateur');
      }

      // Il redevient simple participant
      event.organizers.pull(req.params.userId);
      event.members.push(req.params.userId);
      await event.save();

      res.status(200).json(event);
    });
  }

  // Liens pour partager l'événement sur les réseaux sociaux
  share() {
    this.app.get('/events/:id/share', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);
      if (!isOrganizer(event, req.user)) throw new AppError(403, 'Accès interdit');

      // Possible seulement pour un événement public d'un groupe public
      const group = event.group ? await this.models.Group.findById(event.group) : null;
      if (event.visibility !== 'public' || !group || group.type !== 'public') {
        throw new AppError(409, 'Le partage est réservé aux événements publics d\'un groupe public');
      }

      const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
      const link = `${base}/events/${event.id}`;
      const url = encodeURIComponent(link);
      const title = encodeURIComponent(event.name);

      res.status(200).json({
        link,
        share: {
          facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
          twitter: `https://twitter.com/intent/tweet?url=${url}&text=${title}`,
          linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
          whatsapp: `https://wa.me/?text=${title}%20${url}`
        }
      });
    });
  }

  run() {
    this.create();
    this.searchEvents();
    this.show();
    this.update();
    this.remove();
    this.join();
    this.leave();
    this.addMember();
    this.removeMember();
    this.addOrganizer();
    this.removeOrganizer();
    this.share();
  }
};

export default Events;
