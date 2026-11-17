import bcrypt from 'bcryptjs';
import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import {
  sameId, escapeRegex, pick, getPagination, pageResult, isAdmin
} from '../middleware/checks.mjs';
import { isStrongPassword } from './auth.mjs';

const Users = class Users {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  // L'email n'est visible que par la personne elle-même et par un admin
  view(user, me) {
    const json = user.toJSON();
    if (!sameId(user.id, me.id) && !isAdmin(me)) {
      delete json.email;
    }
    return json;
  }

  searchUsers() {
    this.app.get('/users', authenticate, async (req, res) => {
      const p = getPagination(req.query);
      const filter = {};

      if (req.query.q) {
        const regex = new RegExp(escapeRegex(req.query.q), 'i');
        filter.$or = [{ firstname: regex }, { lastname: regex }];
      }
      if (req.query.city) {
        filter.city = new RegExp(escapeRegex(req.query.city), 'i');
      }

      const users = await this.models.User.find(filter)
        .sort({ lastname: 1, firstname: 1 })
        .skip(p.skip)
        .limit(p.limit);
      const total = await this.models.User.countDocuments(filter);

      res.status(200).json(pageResult(users.map((u) => this.view(u, req.user)), total, p));
    });
  }

  show() {
    this.app.get('/users/:id', authenticate, async (req, res) => {
      const user = await this.models.User.findById(req.params.id);
      if (!user) throw new AppError(404, 'Utilisateur introuvable');

      res.status(200).json(this.view(user, req.user));
    });
  }

  update() {
    this.app.put('/users/:id', authenticate, async (req, res) => {
      // On modifie son propre compte (un admin peut modifier tous les comptes)
      if (!sameId(req.params.id, req.user.id) && !isAdmin(req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      const user = await this.models.User.findById(req.params.id);
      if (!user) throw new AppError(404, 'Utilisateur introuvable');

      user.set(pick(req.body, ['firstname', 'lastname', 'email', 'age', 'city', 'avatar']));

      if (req.body.password !== undefined) {
        if (!isStrongPassword(req.body.password)) {
          throw new AppError(422, 'Données invalides', [{
            field: 'password',
            message: 'password : 8 caractères min, avec majuscule, minuscule et chiffre'
          }]);
        }
        user.password = await bcrypt.hash(req.body.password, 12);
      }

      // Seul un admin peut changer le rôle
      if (req.body.role !== undefined && isAdmin(req.user)) {
        user.role = req.body.role;
      }

      await user.save();
      res.status(200).json(user);
    });
  }

  remove() {
    this.app.delete('/users/:id', authenticate, async (req, res) => {
      if (!sameId(req.params.id, req.user.id) && !isAdmin(req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      const user = await this.models.User.findByIdAndDelete(req.params.id);
      if (!user) throw new AppError(404, 'Utilisateur introuvable');

      // On retire l'utilisateur des événements et des groupes
      const id = req.params.id;
      await this.models.Event.updateMany({}, { $pull: { members: id, organizers: id } });
      await this.models.Group.updateMany({}, { $pull: { members: id, admins: id } });

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
