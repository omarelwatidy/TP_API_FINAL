import { query } from 'express-validator';
import validate from '../middleware/validate.mjs';
import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import {
  findOr404, allow, pick, includesId, sameId, escapeRegex, paginate, pageOf
} from '../services/helpers.mjs';
import {
  loadGroup, isGroupAdmin, isGroupMember, isSiteAdmin
} from '../services/access.mjs';
import { deleteThreadsWhere } from '../services/cascade.mjs';
import {
  text, url, bool, choice, idParam, idBody, pagination, search
} from '../services/rules.mjs';

const FIELDS = ['name', 'description', 'icon', 'coverPhoto', 'type', 'allowMembersToPost', 'allowMembersToCreateEvents'];

const fieldRules = (optional) => [
  text('name', { min: 2, max: 100, optional }),
  text('description', { min: 0, max: 2000, optional: true }),
  url('icon'),
  url('coverPhoto'),
  choice('type', ['public', 'private', 'secret']),
  bool('allowMembersToPost'),
  bool('allowMembersToCreateEvents')
];

const Groups = class Groups {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  // Un groupe privé n'est montré en détail qu'à ses membres
  view(group, user) {
    if (group.type === 'public' || isGroupMember(group, user) || isSiteAdmin(user)) {
      return group.toJSON();
    }
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      icon: group.icon,
      coverPhoto: group.coverPhoto,
      type: group.type,
      membersCount: group.members.length
    };
  }

  async ensureUserExists(id) {
    await findOr404(this.models.User.exists({ _id: id }), 'Utilisateur');
  }

  create() {
    this.app.post('/groups', authenticate, fieldRules(false), validate, async (req, res) => {
      const group = await this.models.Group.create({
        ...pick(req.body, FIELDS),
        admins: [req.user.id],
        members: [req.user.id]
      });
      res.status(201).json(group);
    });
  }

  searchGroups() {
    const rules = [...pagination, search, query('type').optional().isIn(['public', 'private', 'secret'])];

    this.app.get('/groups', authenticate, rules, validate, async (req, res) => {
      const { Group } = this.models;
      const p = paginate(req.query);
      const and = [];

      if (!isSiteAdmin(req.user)) {
        and.push({ $or: [{ type: { $in: ['public', 'private'] } }, { members: req.user.id }] });
      }
      if (req.query.q) {
        and.push({ name: new RegExp(escapeRegex(req.query.q), 'i') });
      }
      if (req.query.type) {
        and.push({ type: req.query.type });
      }
      const filter = and.length ? { $and: and } : {};

      const [groups, total] = await Promise.all([
        Group.find(filter).sort({ name: 1 }).skip(p.skip).limit(p.limit),
        Group.countDocuments(filter)
      ]);

      res.status(200).json(pageOf(groups.map((g) => this.view(g, req.user)), total, p));
    });
  }

  show() {
    this.app.get('/groups/:id', authenticate, idParam(), validate, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user);
      res.status(200).json(this.view(group, req.user));
    });
  }

  update() {
    this.app.put('/groups/:id', authenticate, idParam(), fieldRules(true), validate, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user);
      allow(isGroupAdmin(group, req.user));

      group.set(pick(req.body, FIELDS));
      await group.save();
      res.status(200).json(group);
    });
  }

  remove() {
    this.app.delete('/groups/:id', authenticate, idParam(), validate, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user);
      allow(isGroupAdmin(group, req.user));

      await deleteThreadsWhere(this.models, { group: group.id });
      await this.models.Event.updateMany({ group: group.id }, { $unset: { group: '' } });
      await group.deleteOne();

      res.status(204).end();
    });
  }

  join() {
    this.app.post('/groups/:id/join', authenticate, idParam(), validate, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user);
      allow(group.type === 'public', 'Ce groupe fonctionne sur invitation');

      if (isGroupMember(group, req.user)) {
        throw new AppError(409, 'Vous êtes déjà membre');
      }
      group.members.push(req.user.id);
      await group.save();
      res.status(200).json(group);
    });
  }

  addMember() {
    this.app.post('/groups/:id/members', authenticate, idParam(), idBody('userId'), validate, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user);
      allow(isGroupAdmin(group, req.user));
      await this.ensureUserExists(req.body.userId);

      if (includesId(group.members, req.body.userId)) {
        throw new AppError(409, 'Cet utilisateur est déjà membre');
      }
      group.members.push(req.body.userId);
      await group.save();
      res.status(200).json(group);
    });
  }

  // Un admin retire un membre, ou un membre quitte le groupe
  removeMember() {
    this.app.delete('/groups/:id/members/:userId', authenticate, idParam(), idParam('userId'), validate, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user);
      const { userId } = req.params;
      allow(isGroupAdmin(group, req.user) || sameId(userId, req.user.id));

      if (!includesId(group.members, userId)) {
        throw new AppError(404, 'Cet utilisateur n\'est pas membre');
      }
      if (includesId(group.admins, userId) && group.admins.length === 1) {
        throw new AppError(409, 'Nommez un autre administrateur avant de quitter le groupe');
      }
      group.members.pull(userId);
      group.admins.pull(userId);
      await group.save();
      res.status(200).json(group);
    });
  }

  addAdmin() {
    this.app.post('/groups/:id/admins', authenticate, idParam(), idBody('userId'), validate, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user);
      allow(isGroupAdmin(group, req.user));
      await this.ensureUserExists(req.body.userId);

      if (includesId(group.admins, req.body.userId)) {
        throw new AppError(409, 'Cet utilisateur est déjà administrateur');
      }
      if (!includesId(group.members, req.body.userId)) {
        group.members.push(req.body.userId);
      }
      group.admins.push(req.body.userId);
      await group.save();
      res.status(200).json(group);
    });
  }

  removeAdmin() {
    this.app.delete('/groups/:id/admins/:userId', authenticate, idParam(), idParam('userId'), validate, async (req, res) => {
      const group = await loadGroup(this.models, req.params.id, req.user);
      allow(isGroupAdmin(group, req.user));

      if (!includesId(group.admins, req.params.userId)) {
        throw new AppError(404, 'Cet utilisateur n\'est pas administrateur');
      }
      if (group.admins.length === 1) {
        throw new AppError(409, 'Un groupe a toujours au moins un administrateur');
      }
      group.admins.pull(req.params.userId);
      await group.save();
      res.status(200).json(group);
    });
  }

  run() {
    this.create();
    this.searchGroups();
    this.show();
    this.update();
    this.remove();
    this.join();
    this.addMember();
    this.removeMember();
    this.addAdmin();
    this.removeAdmin();
  }
};

export default Groups;
