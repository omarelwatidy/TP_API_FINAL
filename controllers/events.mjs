import { query } from 'express-validator';
import validate from '../middleware/validate.mjs';
import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import config from '../config.mjs';
import {
  findOr404, allow, pick, uniqueIds, includesId, sameId, escapeRegex, paginate, pageOf
} from '../services/helpers.mjs';
import {
  loadEvent, isEventOrganizer, isEventParticipant, isGroupAdmin, isGroupMember, isSiteAdmin
} from '../services/access.mjs';
import { deleteEventContent } from '../services/cascade.mjs';
import {
  text, url, date, bool, choice, idParam, idBody, idList, idQuery, pagination, search
} from '../services/rules.mjs';

const FIELDS = [
  'name', 'description', 'startDate', 'endDate', 'location', 'coverPhoto', 'visibility',
  'shoppingListEnabled', 'ticketingEnabled'
];

const fieldRules = (optional) => [
  text('name', { min: 3, max: 100, optional }),
  text('description', { min: 0, max: 5000, optional: true }),
  date('startDate', optional),
  date('endDate', optional),
  text('location', { min: 2, max: 300, optional }),
  url('coverPhoto'),
  choice('visibility', ['public', 'private']),
  bool('shoppingListEnabled'),
  bool('ticketingEnabled')
];

const createRules = () => [
  ...fieldRules(false),
  ...idList('organizers'),
  ...idList('members'),
  idBody('group', true)
];

const Events = class Events {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  async ensureUsersExist(ids) {
    const count = await this.models.User.countDocuments({ _id: { $in: ids } });
    if (count !== ids.length) {
      throw new AppError(422, 'Un ou plusieurs utilisateurs sont introuvables');
    }
  }

  create() {
    this.app.post('/events', authenticate, createRules(), validate, async (req, res) => {
      const { Event, Group } = this.models;
      const data = pick(req.body, FIELDS);
      let members = req.body.members || [];
      const organizers = uniqueIds([req.user.id, ...(req.body.organizers || [])]);

      if (req.body.group) {
        const group = await findOr404(Group.findById(req.body.group), 'Groupe');
        const allowed = isGroupAdmin(group, req.user)
          || (isGroupMember(group, req.user) && group.allowMembersToCreateEvents);
        allow(allowed, 'Vous ne pouvez pas créer d\'événement dans ce groupe');

        data.group = group.id;
        // Invitation de tous les membres du groupe en un clic
        members = [...members, ...group.members];
      }

      members = uniqueIds(members).filter((id) => !organizers.includes(id));
      await this.ensureUsersExist([...organizers, ...members]);

      const event = await Event.create({
        ...data, organizers, members, createdBy: req.user.id
      });
      res.status(201).json(event);
    });
  }

  searchEvents() {
    const rules = [
      ...pagination,
      search,
      query('location').optional().isString().isLength({ max: 100 }),
      query('from').optional().isISO8601(),
      query('to').optional().isISO8601(),
      query('visibility').optional().isIn(['public', 'private']),
      query('mine').optional().isBoolean(),
      idQuery('group', true)
    ];

    this.app.get('/events', authenticate, rules, validate, async (req, res) => {
      const { Event } = this.models;
      const p = paginate(req.query);
      const uid = req.user.id;
      const and = [];

      if (!isSiteAdmin(req.user)) {
        and.push({ $or: [{ visibility: 'public' }, { organizers: uid }, { members: uid }] });
      }
      if (req.query.q) {
        const re = new RegExp(escapeRegex(req.query.q), 'i');
        and.push({ $or: [{ name: re }, { description: re }] });
      }
      if (req.query.location) {
        and.push({ location: new RegExp(escapeRegex(req.query.location), 'i') });
      }
      if (req.query.from) {
        and.push({ startDate: { $gte: new Date(req.query.from) } });
      }
      if (req.query.to) {
        and.push({ startDate: { $lte: new Date(req.query.to) } });
      }
      if (req.query.visibility) {
        and.push({ visibility: req.query.visibility });
      }
      if (req.query.group) {
        and.push({ group: req.query.group });
      }
      if (req.query.mine === 'true') {
        and.push({ $or: [{ organizers: uid }, { members: uid }] });
      }
      const filter = and.length ? { $and: and } : {};

      const [events, total] = await Promise.all([
        Event.find(filter).sort({ startDate: 1 }).skip(p.skip).limit(p.limit),
        Event.countDocuments(filter)
      ]);

      res.status(200).json(pageOf(events, total, p));
    });
  }

  show() {
    this.app.get('/events/:id', authenticate, idParam(), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);
      res.status(200).json({
        ...event.toJSON(),
        participantsCount: event.organizers.length + event.members.length
      });
    });
  }

  update() {
    this.app.put('/events/:id', authenticate, idParam(), fieldRules(true), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);
      allow(isEventOrganizer(event, req.user));

      event.set(pick(req.body, FIELDS));
      await event.save();
      res.status(200).json(event);
    });
  }

  remove() {
    this.app.delete('/events/:id', authenticate, idParam(), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);
      allow(isEventOrganizer(event, req.user));

      await deleteEventContent(this.models, event.id);
      await event.deleteOne();
      res.status(204).end();
    });
  }

  join() {
    this.app.post('/events/:id/join', authenticate, idParam(), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);
      allow(event.visibility === 'public', 'Événement privé : invitation requise');

      if (isEventParticipant(event, req.user)) {
        throw new AppError(409, 'Vous participez déjà à cet événement');
      }
      event.members.push(req.user.id);
      await event.save();
      res.status(200).json(event);
    });
  }

  leave() {
    this.app.post('/events/:id/leave', authenticate, idParam(), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);

      if (!isEventParticipant(event, req.user)) {
        throw new AppError(409, 'Vous ne participez pas à cet événement');
      }
      if (includesId(event.organizers, req.user.id)) {
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
    this.app.post('/events/:id/members', authenticate, idParam(), idBody('userId'), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);
      allow(isEventOrganizer(event, req.user));
      await this.ensureUsersExist([req.body.userId]);

      if (isEventParticipant(event, { id: req.body.userId })) {
        throw new AppError(409, 'Cet utilisateur participe déjà');
      }
      event.members.push(req.body.userId);
      await event.save();
      res.status(200).json(event);
    });
  }

  // Un organisateur retire un participant, ou un participant se retire
  removeMember() {
    this.app.delete('/events/:id/members/:userId', authenticate, idParam(), idParam('userId'), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);
      allow(isEventOrganizer(event, req.user) || sameId(req.params.userId, req.user.id));

      if (!includesId(event.members, req.params.userId)) {
        throw new AppError(404, 'Ce participant est introuvable');
      }
      event.members.pull(req.params.userId);
      await event.save();
      res.status(200).json(event);
    });
  }

  addOrganizer() {
    this.app.post('/events/:id/organizers', authenticate, idParam(), idBody('userId'), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);
      allow(isEventOrganizer(event, req.user));
      await this.ensureUsersExist([req.body.userId]);

      if (includesId(event.organizers, req.body.userId)) {
        throw new AppError(409, 'Cet utilisateur est déjà organisateur');
      }
      event.members.pull(req.body.userId);
      event.organizers.push(req.body.userId);
      await event.save();
      res.status(200).json(event);
    });
  }

  removeOrganizer() {
    this.app.delete('/events/:id/organizers/:userId', authenticate, idParam(), idParam('userId'), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);
      allow(isEventOrganizer(event, req.user));

      if (!includesId(event.organizers, req.params.userId)) {
        throw new AppError(404, 'Cet utilisateur n\'est pas organisateur');
      }
      if (event.organizers.length === 1) {
        throw new AppError(409, 'Un événement a toujours au moins un organisateur');
      }
      event.organizers.pull(req.params.userId);
      event.members.push(req.params.userId); // rétrogradé en simple participant
      await event.save();
      res.status(200).json(event);
    });
  }

  // Liens de partage vers les réseaux sociaux (événement public d'un groupe public)
  share() {
    this.app.get('/events/:id/share', authenticate, idParam(), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);
      allow(isEventOrganizer(event, req.user));

      const group = event.group ? await this.models.Group.findById(event.group) : null;
      if (event.visibility !== 'public' || !group || group.type !== 'public') {
        throw new AppError(409, 'Le partage est réservé aux événements publics d\'un groupe public');
      }

      const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
      const link = `${base}/events/${event.id}`;
      const u = encodeURIComponent(link);
      const t = encodeURIComponent(event.name);

      res.status(200).json({
        link,
        share: {
          facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
          twitter: `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
          linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
          whatsapp: `https://wa.me/?text=${t}%20${u}`
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
