import AppError from './AppError.mjs';

// Compare deux ids (ObjectId ou texte)
export const sameId = (a, b) => String(a) === String(b);

// Vrai si l'id est dans la liste
export const isIn = (list, id) => list.some((item) => sameId(item, id));

// Protège les recherches avec une expression régulière
export const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Garde seulement les champs autorisés du body (évite qu'un utilisateur envoie "role: admin")
export const pick = (body, fields) => {
  const result = {};
  if (body && typeof body === 'object') {
    fields.forEach((field) => {
      if (body[field] !== undefined) {
        result[field] = body[field];
      }
    });
  }
  return result;
};

// ?page=2&limit=10
export const getPagination = (query) => {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);

  if (!page || page < 1) page = 1;
  if (!limit || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  return { page, limit, skip: (page - 1) * limit };
};

export const pageResult = (data, total, p) => ({
  data,
  pagination: { page: p.page, limit: p.limit, total, pages: Math.ceil(total / p.limit) }
});

// ---------------------------------------------------------------- Événements
export const isAdmin = (user) => user.role === 'admin';

export const isOrganizer = (event, user) => isAdmin(user) || isIn(event.organizers, user.id);

export const isParticipant = (event, user) => isIn(event.organizers, user.id) || isIn(event.members, user.id);

// Cherche l'événement. Un événement privé est introuvable pour ceux qui ne sont pas invités.
export const getEvent = async (models, id, user) => {
  const event = await models.Event.findById(id);
  if (!event) {
    throw new AppError(404, 'Événement introuvable');
  }
  const canSee = event.visibility === 'public' || isParticipant(event, user) || isAdmin(user);
  if (!canSee) {
    throw new AppError(404, 'Événement introuvable');
  }
  return event;
};

// ------------------------------------------------------------------- Groupes
export const isGroupAdmin = (group, user) => isAdmin(user) || isIn(group.admins, user.id);

export const isGroupMember = (group, user) => isIn(group.members, user.id);

// Un groupe secret est introuvable pour ceux qui n'en sont pas membres
export const getGroup = async (models, id, user) => {
  const group = await models.Group.findById(id);
  if (!group) {
    throw new AppError(404, 'Groupe introuvable');
  }
  const canSee = group.type !== 'secret' || isGroupMember(group, user) || isAdmin(user);
  if (!canSee) {
    throw new AppError(404, 'Groupe introuvable');
  }
  return group;
};
