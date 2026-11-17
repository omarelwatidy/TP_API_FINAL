import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import {
  sameId, isIn, escapeRegex, pick, getPagination, pageResult,
  isAdmin, isGroupAdmin, isGroupMember, getGroup
} from '../middleware/checks.mjs';

const FIELDS = ['name', 'description', 'icon', 'coverPhoto', 'type', 'allowMembersToPost', 'allowMembersToCreateEvents'];

const Groups = class Groups {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  // Un groupe privé n'est montré en détail qu'à ses membres
  view(group, user) {
    if (group.type === 'public' || isGroupMember(group, user) || isAdmin(user)) {
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

  // Le créateur devient administrateur et membre
  create() {
    this.app.post('/groups', authenticate, async (req, res) => {
      const group = await this.models.Group.create({
        ...pick(req.body, FIELDS),
        admins: [req.user.id],
        members: [req.user.id]
      });

      res.status(201).json(group);
    });
  }

  searchGroups() {
    this.app.get('/groups', authenticate, async (req, res) => {
      const p = getPagination(req.query);
      const conditions = [];

      // Les groupes secrets sont visibles seulement par leurs membres
      if (!isAdmin(req.user)) {
        conditions.push({ $or: [{ type: { $in: ['public', 'private'] } }, { members: req.user.id }] });
      }
      if (req.query.q) {
        conditions.push({ name: new RegExp(escapeRegex(req.query.q), 'i') });
      }
      if (req.query.type) {
        conditions.push({ type: String(req.query.type) });
      }
      const filter = conditions.length > 0 ? { $and: conditions } : {};

      const groups = await this.models.Group.find(filter).sort({ name: 1 }).skip(p.skip).limit(p.limit);
      const total = await this.models.Group.countDocuments(filter);

      res.status(200).json(pageResult(groups.map((g) => this.view(g, req.user)), total, p));
    });
  }

  show() {
    this.app.get('/groups/:id', authenticate, async (req, res) => {
      const group = await getGroup(this.models, req.params.id, req.user);
      res.status(200).json(this.view(group, req.user));
    });
  }

  update() {
    this.app.put('/groups/:id', authenticate, async (req, res) => {
      const group = await getGroup(this.models, req.params.id, req.user);
      if (!isGroupAdmin(group, req.user)) throw new AppError(403, 'Accès interdit');

      group.set(pick(req.body, FIELDS));
      await group.save();

      res.status(200).json(group);
    });
  }

  remove() {
    this.app.delete('/groups/:id', authenticate, async (req, res) => {
      const group = await getGroup(this.models, req.params.id, req.user);
      if (!isGroupAdmin(group, req.user)) throw new AppError(403, 'Accès interdit');

      // On supprime le fil de discussion du groupe et ses messages
      const threads = await this.models.Thread.find({ group: group.id });
      const threadIds = threads.map((t) => t._id);
      await this.models.Message.deleteMany({ thread: { $in: threadIds } });
      await this.models.Thread.deleteMany({ group: group.id });

      // Les événements du groupe restent, mais ne sont plus liés au groupe
      await this.models.Event.updateMany({ group: group.id }, { $unset: { group: '' } });
      await group.deleteOne();

      res.status(204).end();
    });
  }

  // Rejoindre un groupe public
  join() {
    this.app.post('/groups/:id/join', authenticate, async (req, res) => {
      const group = await getGroup(this.models, req.params.id, req.user);

      if (group.type !== 'public') throw new AppError(403, 'Ce groupe fonctionne sur invitation');
      if (isGroupMember(group, req.user)) throw new AppError(409, 'Vous êtes déjà membre');

      group.members.push(req.user.id);
      await group.save();

      res.status(200).json(group);
    });
  }

  addMember() {
    this.app.post('/groups/:id/members', authenticate, async (req, res) => {
      const group = await getGroup(this.models, req.params.id, req.user);
      if (!isGroupAdmin(group, req.user)) throw new AppError(403, 'Accès interdit');

      const { userId } = req.body;
      const user = await this.models.User.findById(userId);
      if (!user) throw new AppError(404, 'Utilisateur introuvable');
      if (isIn(group.members, user.id)) throw new AppError(409, 'Cet utilisateur est déjà membre');

      group.members.push(user.id);
      await group.save();

      res.status(200).json(group);
    });
  }

  // Un admin retire un membre, ou un membre quitte le groupe
  removeMember() {
    this.app.delete('/groups/:id/members/:userId', authenticate, async (req, res) => {
      const group = await getGroup(this.models, req.params.id, req.user);
      const { userId } = req.params;

      if (!isGroupAdmin(group, req.user) && !sameId(userId, req.user.id)) {
        throw new AppError(403, 'Accès interdit');
      }
      if (!isIn(group.members, userId)) throw new AppError(404, 'Cet utilisateur n\'est pas membre');
      if (isIn(group.admins, userId) && group.admins.length === 1) {
        throw new AppError(409, 'Nommez un autre administrateur avant de quitter le groupe');
      }

      group.members.pull(userId);
      group.admins.pull(userId);
      await group.save();

      res.status(200).json(group);
    });
  }

  addAdmin() {
    this.app.post('/groups/:id/admins', authenticate, async (req, res) => {
      const group = await getGroup(this.models, req.params.id, req.user);
      if (!isGroupAdmin(group, req.user)) throw new AppError(403, 'Accès interdit');

      const user = await this.models.User.findById(req.body.userId);
      if (!user) throw new AppError(404, 'Utilisateur introuvable');
      if (isIn(group.admins, user.id)) throw new AppError(409, 'Cet utilisateur est déjà administrateur');

      // Un administrateur est aussi membre du groupe
      if (!isIn(group.members, user.id)) {
        group.members.push(user.id);
      }
      group.admins.push(user.id);
      await group.save();

      res.status(200).json(group);
    });
  }

  removeAdmin() {
    this.app.delete('/groups/:id/admins/:userId', authenticate, async (req, res) => {
      const group = await getGroup(this.models, req.params.id, req.user);
      if (!isGroupAdmin(group, req.user)) throw new AppError(403, 'Accès interdit');

      if (!isIn(group.admins, req.params.userId)) {
        throw new AppError(404, 'Cet utilisateur n\'est pas administrateur');
      }
      // Un groupe a toujours au moins un administrateur
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
