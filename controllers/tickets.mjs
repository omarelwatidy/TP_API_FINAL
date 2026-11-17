import { body, query } from 'express-validator';
import validate from '../middleware/validate.mjs';
import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import { authLimiter } from '../middleware/rateLimit.mjs';
import {
  findOr404, allow, pick, escapeRegex, paginate, pageOf
} from '../services/helpers.mjs';
import { loadEvent, isEventOrganizer } from '../services/access.mjs';
import {
  text, number, email, idParam, idBody, idQuery, pagination
} from '../services/rules.mjs';

const Tickets = class Tickets {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  // Billetterie accessible à tout le monde : événement public avec billetterie activée
  async publicTicketedEvent(id) {
    const event = await this.models.Event.findById(id);
    if (!event || event.visibility !== 'public' || !event.ticketingEnabled) {
      throw new AppError(404, 'Billetterie introuvable');
    }
    return event;
  }

  async loadType(id, user) {
    const type = await findOr404(this.models.TicketType.findById(id), 'Type de billet');
    const event = await loadEvent(this.models, type.event, user);
    allow(isEventOrganizer(event, user), 'Réservé aux organisateurs');
    return { type, event };
  }

  async loadTicket(id, user) {
    const ticket = await findOr404(this.models.Ticket.findById(id), 'Billet');
    const event = await loadEvent(this.models, ticket.event, user);
    allow(isEventOrganizer(event, user), 'Réservé aux organisateurs');
    return { ticket, event };
  }

  // ------------------------------------------------------------ Types de billets
  createType() {
    const rules = () => [
      idBody('event'),
      text('name', { min: 2, max: 100 }),
      number('price', { min: 0 }),
      body('quantity').isInt({ min: 1 }).withMessage('quantity : entier >= 1').toInt()
    ];

    this.app.post('/ticket-types', authenticate, rules(), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.body.event, req.user);
      allow(isEventOrganizer(event, req.user), 'Seul un organisateur peut créer des billets');

      if (event.visibility !== 'public' || !event.ticketingEnabled) {
        throw new AppError(409, 'La billetterie doit être activée sur un événement public (ticketingEnabled: true)');
      }
      const type = await this.models.TicketType.create(pick(req.body, ['event', 'name', 'price', 'quantity']));
      res.status(201).json(type);
    });
  }

  listTypes() {
    this.app.get('/events/:id/ticket-types', idParam(), validate, async (req, res) => {
      const event = await this.publicTicketedEvent(req.params.id);
      const types = await this.models.TicketType.find({ event: event.id }).sort({ price: 1 });
      res.status(200).json(types);
    });
  }

  showType() {
    this.app.get('/ticket-types/:id', idParam(), validate, async (req, res) => {
      const type = await findOr404(this.models.TicketType.findById(req.params.id), 'Type de billet');
      await this.publicTicketedEvent(type.event);
      res.status(200).json(type);
    });
  }

  updateType() {
    const rules = () => [
      text('name', { min: 2, max: 100, optional: true }),
      number('price', { min: 0, optional: true }),
      body('quantity').optional().isInt({ min: 1 }).withMessage('quantity : entier >= 1').toInt()
    ];

    this.app.put('/ticket-types/:id', authenticate, idParam(), rules(), validate, async (req, res) => {
      const { type } = await this.loadType(req.params.id, req.user);

      if (req.body.quantity !== undefined && req.body.quantity < type.sold) {
        throw new AppError(422, `quantity ne peut pas être inférieure aux billets déjà vendus (${type.sold})`);
      }
      type.set(pick(req.body, ['name', 'price', 'quantity']));
      await type.save();
      res.status(200).json(type);
    });
  }

  removeType() {
    this.app.delete('/ticket-types/:id', authenticate, idParam(), validate, async (req, res) => {
      const { type } = await this.loadType(req.params.id, req.user);

      if (type.sold > 0) {
        throw new AppError(409, 'Des billets ont déjà été vendus pour ce type');
      }
      await type.deleteOne();
      res.status(204).end();
    });
  }

  // ------------------------------------------------------------------- Billets
  // Achat ouvert aux personnes extérieures (pas de compte nécessaire)
  buy() {
    const rules = () => [
      text('firstname', { min: 1, max: 50 }),
      text('lastname', { min: 1, max: 50 }),
      email(),
      body('address').isObject().withMessage('address : objet attendu'),
      text('address.street', { min: 2, max: 200 }),
      text('address.zipCode', { min: 2, max: 20 }),
      text('address.city', { min: 2, max: 100 }),
      text('address.country', { min: 2, max: 100 })
    ];

    this.app.post('/ticket-types/:id/tickets', authLimiter, idParam(), rules(), validate, async (req, res) => {
      const { TicketType, Ticket } = this.models;
      const type = await findOr404(TicketType.findById(req.params.id), 'Type de billet');
      const event = await this.publicTicketedEvent(type.event);
      const { firstname, lastname, email: mail } = req.body;

      // 1 seul billet par personne et par événement
      if (await Ticket.exists({ event: event.id, email: mail })) {
        throw new AppError(409, 'Cette personne possède déjà un billet pour cet événement');
      }

      // Réservation atomique d'une place : impossible de dépasser la quantité, même en requêtes simultanées
      const reserved = await TicketType.findOneAndUpdate(
        { _id: type.id, $expr: { $lt: ['$sold', '$quantity'] } },
        { $inc: { sold: 1 } },
        { returnDocument: 'after' }
      );
      if (!reserved) {
        throw new AppError(409, 'Plus de billets disponibles pour ce type');
      }

      try {
        const ticket = await Ticket.create({
          event: event.id,
          ticketType: type.id,
          firstname,
          lastname,
          email: mail,
          address: pick(req.body.address, ['street', 'zipCode', 'city', 'country'])
        });
        res.status(201).json(ticket);
      } catch (err) {
        await TicketType.updateOne({ _id: type.id }, { $inc: { sold: -1 } }); // on rend la place
        if (err.code === 11000) {
          throw new AppError(409, 'Cette personne possède déjà un billet pour cet événement');
        }
        throw err;
      }
    });
  }

  listTickets() {
    const rules = () => [...pagination, idQuery('ticketType', true), query('q').optional().isString().isLength({ max: 100 })];

    this.app.get('/events/:id/tickets', authenticate, idParam(), rules(), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);
      allow(isEventOrganizer(event, req.user), 'Réservé aux organisateurs');

      const p = paginate(req.query);
      const filter = { event: event.id };
      if (req.query.ticketType) {
        filter.ticketType = req.query.ticketType;
      }
      if (req.query.q) {
        const re = new RegExp(escapeRegex(req.query.q), 'i');
        filter.$or = [{ firstname: re }, { lastname: re }, { email: re }];
      }

      const [tickets, total] = await Promise.all([
        this.models.Ticket.find(filter).sort({ purchasedAt: -1 }).skip(p.skip).limit(p.limit),
        this.models.Ticket.countDocuments(filter)
      ]);
      res.status(200).json(pageOf(tickets, total, p));
    });
  }

  showTicket() {
    this.app.get('/tickets/:id', authenticate, idParam(), validate, async (req, res) => {
      const { ticket } = await this.loadTicket(req.params.id, req.user);
      res.status(200).json(ticket);
    });
  }

  updateTicket() {
    const rules = () => [
      text('firstname', { min: 1, max: 50, optional: true }),
      text('lastname', { min: 1, max: 50, optional: true }),
      text('address.street', { min: 2, max: 200, optional: true }),
      text('address.zipCode', { min: 2, max: 20, optional: true }),
      text('address.city', { min: 2, max: 100, optional: true }),
      text('address.country', { min: 2, max: 100, optional: true })
    ];

    this.app.put('/tickets/:id', authenticate, idParam(), rules(), validate, async (req, res) => {
      const { ticket } = await this.loadTicket(req.params.id, req.user);

      ticket.set(pick(req.body, ['firstname', 'lastname']));
      Object.entries(pick(req.body.address, ['street', 'zipCode', 'city', 'country']))
        .forEach(([key, value]) => ticket.set(`address.${key}`, value));
      await ticket.save();
      res.status(200).json(ticket);
    });
  }

  removeTicket() {
    this.app.delete('/tickets/:id', authenticate, idParam(), validate, async (req, res) => {
      const { ticket } = await this.loadTicket(req.params.id, req.user);

      await ticket.deleteOne();
      await this.models.TicketType.updateOne({ _id: ticket.ticketType }, { $inc: { sold: -1 } });
      res.status(204).end();
    });
  }

  run() {
    this.createType();
    this.listTypes();
    this.showType();
    this.updateType();
    this.removeType();
    this.buy();
    this.listTickets();
    this.showTicket();
    this.updateTicket();
    this.removeTicket();
  }
};

export default Tickets;
