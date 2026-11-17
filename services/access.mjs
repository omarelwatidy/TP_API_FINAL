import AppError from '../middleware/AppError.mjs';
import { findOr404, includesId } from './helpers.mjs';

export const isSiteAdmin = (user) => user.role === 'admin';

// ------------------------------------------------------------ Événements
export const isEventOrganizer = (event, user) => isSiteAdmin(user) || includesId(event.organizers, user.id);

export const isEventParticipant = (event, user) => includesId(event.organizers, user.id)
  || includesId(event.members, user.id);

export const canViewEvent = (event, user) => event.visibility === 'public'
  || isEventParticipant(event, user)
  || isSiteAdmin(user);

// Un événement privé "n'existe pas" pour qui n'y est pas invité
export const loadEvent = async (models, id, user) => {
  const event = await findOr404(models.Event.findById(id), 'Événement');
  if (!canViewEvent(event, user)) {
    throw new AppError(404, 'Événement introuvable');
  }
  return event;
};

// --------------------------------------------------------------- Groupes
export const isGroupAdmin = (group, user) => isSiteAdmin(user) || includesId(group.admins, user.id);
export const isGroupMember = (group, user) => includesId(group.members, user.id);

export const canSeeGroup = (group, user) => group.type !== 'secret'
  || isGroupMember(group, user)
  || isSiteAdmin(user);

export const loadGroup = async (models, id, user) => {
  const group = await findOr404(models.Group.findById(id), 'Groupe');
  if (!canSeeGroup(group, user)) {
    throw new AppError(404, 'Groupe introuvable');
  }
  return group;
};

// ------------------------------------------------------- Fils de discussion
export const threadAccess = async (models, thread, user) => {
  if (thread.group) {
    const group = await loadGroup(models, thread.group, user);
    const admin = isGroupAdmin(group, user);
    const member = isGroupMember(group, user);
    return {
      canRead: group.type === 'public' || member || admin,
      canPost: admin || (member && group.allowMembersToPost),
      canComment: admin || member,
      canModerate: admin
    };
  }

  const event = await loadEvent(models, thread.event, user);
  const organizer = isEventOrganizer(event, user);
  const participant = isEventParticipant(event, user);
  return {
    canRead: organizer || participant,
    canPost: organizer || participant,
    canComment: organizer || participant,
    canModerate: organizer
  };
};
