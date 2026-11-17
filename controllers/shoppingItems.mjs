import { body } from 'express-validator';
import validate from '../middleware/validate.mjs';
import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import {
  findOr404, allow, pick, sameId, escapeRegex, paginate, pageOf
} from '../services/helpers.mjs';
import { loadEvent, isEventOrganizer, isEventParticipant } from '../services/access.mjs';
import {
  text, date, idParam, pagination, search
} from '../services/rules.mjs';

const fieldRules = (optional) => [
  text('name', { min: 1, max: 100, optional }),
  (optional ? body('quantity').optional() : body('quantity'))
    .isInt({ min: 1, max: 10000 })
    .withMessage('quantity : entier >= 1')
    .toInt(),
  date('arrivalTime', optional)
];

const duplicate = (err) => {
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

  async loadItem(id, user) {
    const item = await findOr404(this.models.ShoppingItem.findById(id), 'Élément');
    const event = await loadEvent(this.models, item.event, user);
    return { item, event };
  }

  create() {
    this.app.post('/events/:id/shopping-items', authenticate, idParam(), fieldRules(false), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);
      allow(isEventParticipant(event, req.user), 'Réservé aux participants de l\'événement');

      if (!event.shoppingListEnabled) {
        throw new AppError(409, 'La shopping list n\'est pas activée (shoppingListEnabled: true)');
      }
      try {
        const item = await this.models.ShoppingItem.create({
          ...pick(req.body, ['name', 'quantity', 'arrivalTime']),
          event: event.id,
          user: req.user.id
        });
        res.status(201).json(item);
      } catch (err) {
        duplicate(err);
      }
    });
  }

  list() {
    this.app.get('/events/:id/shopping-items', authenticate, idParam(), pagination, search, validate, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);
      allow(isEventParticipant(event, req.user) || isEventOrganizer(event, req.user));

      const p = paginate(req.query);
      const filter = { event: event.id };
      if (req.query.q) {
        filter.name = new RegExp(escapeRegex(req.query.q), 'i');
      }
      const [items, total] = await Promise.all([
        this.models.ShoppingItem.find(filter).sort({ arrivalTime: 1 }).skip(p.skip).limit(p.limit),
        this.models.ShoppingItem.countDocuments(filter)
      ]);
      res.status(200).json(pageOf(items, total, p));
    });
  }

  show() {
    this.app.get('/shopping-items/:id', authenticate, idParam(), validate, async (req, res) => {
      const { item, event } = await this.loadItem(req.params.id, req.user);
      allow(isEventParticipant(event, req.user) || isEventOrganizer(event, req.user));
      res.status(200).json(item);
    });
  }

  update() {
    this.app.put('/shopping-items/:id', authenticate, idParam(), fieldRules(true), validate, async (req, res) => {
      const { item, event } = await this.loadItem(req.params.id, req.user);
      allow(sameId(item.user, req.user.id) || isEventOrganizer(event, req.user));

      item.set(pick(req.body, ['name', 'quantity', 'arrivalTime']));
      try {
        await item.save();
        res.status(200).json(item);
      } catch (err) {
        duplicate(err);
      }
    });
  }

  remove() {
    this.app.delete('/shopping-items/:id', authenticate, idParam(), validate, async (req, res) => {
      const { item, event } = await this.loadItem(req.params.id, req.user);
      allow(sameId(item.user, req.user.id) || isEventOrganizer(event, req.user));

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
