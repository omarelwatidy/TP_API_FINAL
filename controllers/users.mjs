import bcrypt from 'bcryptjs';
import { body, query } from 'express-validator';
import validate from '../middleware/validate.mjs';
import { authenticate } from '../middleware/auth.mjs';
import {
  findOr404, allow, paginate, pageOf, escapeRegex, pick, sameId
} from '../services/helpers.mjs';
import { isSiteAdmin } from '../services/access.mjs';
import {
  text, url, email, strongPassword, idParam, pagination, search
} from '../services/rules.mjs';

const updateRules = () => [
  text('firstname', { min: 2, max: 50, optional: true }),
  text('lastname', { min: 2, max: 50, optional: true }),
  email(true),
  strongPassword(true),
  body('age').optional().isInt({ min: 0, max: 120 }).withMessage('age : entier entre 0 et 120').toInt(),
  text('city', { max: 100, optional: true }),
  url('avatar'),
  body('role').optional().isIn(['user', 'admin']).withMessage('role : user | admin')
];

const Users = class Users {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  // L'email n'est visible que par la personne concernée et par un admin
  view(user, me) {
    const json = user.toJSON();
    if (!sameId(user, me.id) && !isSiteAdmin(me)) {
      delete json.email;
    }
    return json;
  }

  searchUsers() {
    const rules = [...pagination, search, query('city').optional().isString().isLength({ max: 100 })];

    this.app.get('/users', authenticate, rules, validate, async (req, res) => {
      const { User } = this.models;
      const p = paginate(req.query);
      const filter = {};

      if (req.query.q) {
        const re = new RegExp(escapeRegex(req.query.q), 'i');
        filter.$or = [{ firstname: re }, { lastname: re }];
      }
      if (req.query.city) {
        filter.city = new RegExp(escapeRegex(req.query.city), 'i');
      }

      const [users, total] = await Promise.all([
        User.find(filter).sort({ lastname: 1, firstname: 1 }).skip(p.skip).limit(p.limit),
        User.countDocuments(filter)
      ]);

      res.status(200).json(pageOf(users.map((u) => this.view(u, req.user)), total, p));
    });
  }

  show() {
    this.app.get('/users/:id', authenticate, idParam(), validate, async (req, res) => {
      const user = await findOr404(this.models.User.findById(req.params.id), 'Utilisateur');
      res.status(200).json(this.view(user, req.user));
    });
  }

  update() {
    this.app.put('/users/:id', authenticate, idParam(), updateRules(), validate, async (req, res) => {
      allow(sameId(req.params.id, req.user.id) || isSiteAdmin(req.user));

      const user = await findOr404(this.models.User.findById(req.params.id), 'Utilisateur');
      user.set(pick(req.body, ['firstname', 'lastname', 'email', 'age', 'city', 'avatar']));

      if (req.body.password) {
        user.password = await bcrypt.hash(req.body.password, 12);
      }
      if (req.body.role && isSiteAdmin(req.user)) {
        user.role = req.body.role;
      }

      await user.save();
      res.status(200).json(user);
    });
  }

  remove() {
    this.app.delete('/users/:id', authenticate, idParam(), validate, async (req, res) => {
      allow(sameId(req.params.id, req.user.id) || isSiteAdmin(req.user));

      const { User, Event, Group } = this.models;
      await findOr404(User.findByIdAndDelete(req.params.id), 'Utilisateur');

      await Event.updateMany({}, { $pull: { members: req.params.id, organizers: req.params.id } });
      await Group.updateMany({}, { $pull: { members: req.params.id, admins: req.params.id } });

      res.status(204).end();
    });
  }

  run() {
    this.searchUsers();
    this.show();
    this.update();
    this.remove();
  }
};

export default Users;
