import AppError from '../middleware/AppError.mjs';

export const findOr404 = async (query, label = 'Ressource') => {
  const doc = await query;
  if (!doc) {
    throw new AppError(404, `${label} introuvable`);
  }
  return doc;
};

export const allow = (condition, message = 'Accès interdit') => {
  if (!condition) {
    throw new AppError(403, message);
  }
};

export const sameId = (a, b) => String(a?._id ?? a) === String(b?._id ?? b);
export const includesId = (list = [], id) => list.some((item) => sameId(item, id));
export const uniqueIds = (list = []) => [...new Set(list.map((item) => String(item?._id ?? item)))];

export const pick = (obj = {}, keys) => Object.fromEntries(
  keys.filter((key) => obj[key] !== undefined).map((key) => [key, obj[key]])
);

export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const paginate = (q = {}) => {
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

export const pageOf = (data, total, { page, limit }) => ({
  data,
  pagination: { page, limit, total, pages: Math.ceil(total / limit) }
});
