import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import { authLimiter } from '../middleware/rateLimit.mjs';
import {
  escapeRegex, pick, getPagination, pageResult, getEvent, isOrganizer
} from '../middleware/checks.mjs';

const Tickets = class Tickets {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  // La billetterie est ouverte à tout le monde : événement public avec billetterie activée
  async getPublicEvent(id) {
    const event = await this.models.Event.findById(id);
    if (!event || event.visibility !== 'public' || !event.ticketingEnabled) {
      throw new AppError(404, 'Billetterie introuvable');
    }
    return event;
  }

  // Cherche un type de billet. Réservé aux organisateurs de l'événement.
  async getTypeAsOrganizer(id, user) {
    const type = await this.models.TicketType.findById(id);
    if (!type) throw new AppError(404, 'Type de billet introuvable');

    const event = await getEvent(this.models, type.event, user);
    if (!isOrganizer(event, user)) throw new AppError(403, 'Réservé aux organisateurs');

    return type;
  }

  async getTicketAsOrganizer(id, user) {
    const ticket = await this.models.Ticket.findById(id);
    if (!ticket) throw new AppError(404, 'Billet introuvable');

    const event = await getEvent(this.models, ticket.event, user);
    if (!isOrganizer(event, user)) throw new AppError(403, 'Réservé aux organisateurs');

    return ticket;
  }

  // ---------------------------------------------------- Types de billets
  createType() {
    this.app.post('/ticket-types', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.body.event, req.user);
      if (!isOrganizer(event, req.user)) {
        throw new AppError(403, 'Seul un organisateur peut créer des billets');
      }
      if (event.visibility !== 'public' || !event.ticketingEnabled) {
        throw new AppError(409, 'La billetterie doit être activée sur un événement public (ticketingEnabled: true)');
      }

      const type = await this.models.TicketType.create({
        event: event.id,
        name: req.body.name,
        price: req.body.price,
        quantity: req.body.quantity
      });

      res.status(201).json(type);
    });
  }

  // Route publique : pas besoin d'être connecté
  listTypes() {
    this.app.get('/events/:id/ticket-types', async (req, res) => {
      const event = await this.getPublicEvent(req.params.id);
      const types = await this.models.TicketType.find({ event: event.id }).sort({ price: 1 });

      res.status(200).json(types);
    });
  }

  showType() {
    this.app.get('/ticket-types/:id', async (req, res) => {
      const type = await this.models.TicketType.findById(req.params.id);
      if (!type) throw new AppError(404, 'Type de billet introuvable');
      await this.getPublicEvent(type.event);

      res.status(200).json(type);
    });
  }

  updateType() {
    this.app.put('/ticket-types/:id', authenticate, async (req, res) => {
      const type = await this.getTypeAsOrganizer(req.params.id, req.user);

      // On ne peut pas descendre sous le nombre de billets déjà vendus
      if (req.body.quantity !== undefined && Number(req.body.quantity) < type.sold) {
        throw new AppError(422, `quantity ne peut pas être inférieure aux billets déjà vendus (${type.sold})`);
      }

      type.set(pick(req.body, ['name', 'price', 'quantity']));
      await type.save();

      res.status(200).json(type);
    });
  }

  removeType() {
    this.app.delete('/ticket-types/:id', authenticate, async (req, res) => {
      const type = await this.getTypeAsOrganizer(req.params.id, req.user);

      if (type.sold > 0) {
        throw new AppError(409, 'Des billets ont déjà été vendus pour ce type');
      }

      await type.deleteOne();
      res.status(204).end();
    });
  }

  // ----------------------------------------------------------- Billets
  // Achat ouvert aux personnes extérieures : pas besoin de compte
  buy() {
    this.app.post('/ticket-types/:id/tickets', authLimiter, async (req, res) => {
      const { TicketType, Ticket } = this.models;

      const type = await TicketType.findById(req.params.id);
      if (!type) throw new AppError(404, 'Type de billet introuvable');
      const event = await this.getPublicEvent(type.event);

      const ticket = new Ticket({
        event: event.id,
        ticketType: type.id,
        firstname: req.body.firstname,
        lastname: req.body.lastname,
        email: req.body.email,
        address: pick(req.body.address, ['street', 'zipCode', 'city', 'country'])
      });
      await ticket.validate(); // vérifie les données avant de réserver une place

      // Une seule place par personne et par événement
      const already = await Ticket.exists({ event: event.id, email: ticket.email });
      if (already) {
        throw new AppError(409, 'Cette personne possède déjà un billet pour cet événement');
      }

      // On réserve une place en une seule opération : même si plusieurs personnes achètent en
      // même temps, "sold" ne peut jamais dépasser "quantity".
      const reserved = await TicketType.findOneAndUpdate(
        { _id: type.id, $expr: { $lt: ['$sold', '$quantity'] } },
        { $inc: { sold: 1 } }
      );
      if (!reserved) {
        throw new AppError(409, 'Plus de billets disponibles pour ce type');
      }

      try {
        await ticket.save();
      } catch (err) {
        // Le billet n'a pas pu être créé : on rend la place
        await TicketType.updateOne({ _id: type.id }, { $inc: { sold: -1 } });
        if (err.code === 11000) {
          throw new AppError(409, 'Cette personne possède déjà un billet pour cet événement');
        }
        throw err;
      }

      res.status(201).json(ticket);
    });
  }

  listTickets() {
    this.app.get('/events/:id/tickets', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);
      if (!isOrganizer(event, req.user)) throw new AppError(403, 'Réservé aux organisateurs');

      const p = getPagination(req.query);
      const filter = { event: event.id };
      if (req.query.ticketType) {
        filter.ticketType = String(req.query.ticketType);
      }
      if (req.query.q) {
        const regex = new RegExp(escapeRegex(req.query.q), 'i');
        filter.$or = [{ firstname: regex }, { lastname: regex }, { email: regex }];
      }

      const tickets = await this.models.Ticket.find(filter).sort({ purchasedAt: -1 }).skip(p.skip).limit(p.limit);
      const total = await this.models.Ticket.countDocuments(filter);

      res.status(200).json(pageResult(tickets, total, p));
    });
  }

  showTicket() {
    this.app.get('/tickets/:id', authenticate, async (req, res) => {
      const ticket = await this.getTicketAsOrganizer(req.params.id, req.user);
      res.status(200).json(ticket);
    });
  }

  updateTicket() {
    this.app.put('/tickets/:id', authenticate, async (req, res) => {
      const ticket = await this.getTicketAsOrganizer(req.params.id, req.user);

      ticket.set(pick(req.body, ['firstname', 'lastname']));

      // On modifie seulement les champs d'adresse envoyés
      const address = pick(req.body.address, ['street', 'zipCode', 'city', 'country']);
      Object.keys(address).forEach((key) => {
        ticket.set(`address.${key}`, address[key]);
      });

      await ticket.save();
      res.status(200).json(ticket);
    });
  }

  removeTicket() {
    this.app.delete('/tickets/:id', authenticate, async (req, res) => {
      const ticket = await this.getTicketAsOrganizer(req.params.id, req.user);

      await ticket.deleteOne();
      // La place est de nouveau disponible
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
