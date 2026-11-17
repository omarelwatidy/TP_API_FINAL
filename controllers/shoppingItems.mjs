import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import {
  sameId, escapeRegex, pick, getPagination, pageResult, getEvent, isOrganizer, isParticipant
} from '../middleware/checks.mjs';

const FIELDS = ['name', 'quantity', 'arrivalTime'];

// Index unique : quelqu'un apporte déjà cet objet pour cet événement
const handleDuplicate = (err) => {
  if (err.code === 11000) {
    throw new AppError(409, 'Cet objet est déjà apporté par quelqu\'un pour cet événement');
  }
  throw err;
};

const ShoppingItems = class ShoppingItems {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  async getItem(id, user) {
    const item = await this.models.ShoppingItem.findById(id);
    if (!item) throw new AppError(404, 'Élément introuvable');

    const event = await getEvent(this.models, item.event, user);
    return { item, event };
  }

  create() {
    this.app.post('/events/:id/shopping-items', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);
      if (!isParticipant(event, req.user)) {
        throw new AppError(403, 'Réservé aux participants de l\'événement');
      }
      if (!event.shoppingListEnabled) {
        throw new AppError(409, 'La shopping list n\'est pas activée (shoppingListEnabled: true)');
      }

      try {
        const item = await this.models.ShoppingItem.create({
          ...pick(req.body, FIELDS),
          event: event.id,
          user: req.user.id
        });
        res.status(201).json(item);
      } catch (err) {
        handleDuplicate(err);
      }
    });
  }

  list() {
    this.app.get('/events/:id/shopping-items', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.params.id, req.user);
      if (!isParticipant(event, req.user) && !isOrganizer(event, req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      const p = getPagination(req.query);
      const filter = { event: event.id };
      if (req.query.q) {
        filter.name = new RegExp(escapeRegex(req.query.q), 'i');
      }

      const items = await this.models.ShoppingItem.find(filter).sort({ arrivalTime: 1 }).skip(p.skip).limit(p.limit);
      const total = await this.models.ShoppingItem.countDocuments(filter);

      res.status(200).json(pageResult(items, total, p));
    });
  }

  show() {
    this.app.get('/shopping-items/:id', authenticate, async (req, res) => {
      const { item, event } = await this.getItem(req.params.id, req.user);
      if (!isParticipant(event, req.user) && !isOrganizer(event, req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      res.status(200).json(item);
    });
  }

  update() {
    this.app.put('/shopping-items/:id', authenticate, async (req, res) => {
      const { item, event } = await this.getItem(req.params.id, req.user);

      // Celui qui l'apporte ou un organisateur
      if (!sameId(item.user, req.user.id) && !isOrganizer(event, req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      item.set(pick(req.body, FIELDS));
      try {
        await item.save();
        res.status(200).json(item);
      } catch (err) {
        handleDuplicate(err);
      }
    });
  }

  remove() {
    this.app.delete('/shopping-items/:id', authenticate, async (req, res) => {
      const { item, event } = await this.getItem(req.params.id, req.user);

      if (!sameId(item.user, req.user.id) && !isOrganizer(event, req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      await item.deleteOne();
      res.status(204).end();
    });
  }

  run() {
    this.create();
    this.list();
    this.show();
    this.update();
    this.remove();
  }
};

export default ShoppingItems;
