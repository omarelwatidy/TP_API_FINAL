import { body, param, query } from 'express-validator';

const start = (chain, optional) => (optional ? chain.optional() : chain);

export const text = (field, { min = 1, max = 255, optional = false } = {}) => start(body(field), optional)
  .isString().withMessage(`${field} doit être du texte`).bail()
  .trim()
  .isLength({ min, max })
  .withMessage(`${field} : ${min} à ${max} caractères`)
  .escape();

export const url = (field, optional = true) => start(body(field), optional)
  .isURL({ protocols: ['http', 'https'], require_protocol: true })
  .withMessage(`${field} : URL http(s) attendue`);

export const date = (field, optional = false) => start(body(field), optional)
  .isISO8601().withMessage(`${field} : date ISO 8601 attendue (ex: 2026-12-31T20:00:00Z)`)
  .toDate();

export const bool = (field) => body(field).optional()
  .isBoolean().withMessage(`${field} : booléen attendu`)
  .toBoolean();

export const number = (field, { min, max, optional = false } = {}) => start(body(field), optional)
  .isFloat({ min, max }).withMessage(`${field} : nombre valide attendu`)
  .toFloat();

export const choice = (field, values, optional = true) => start(body(field), optional)
  .isIn(values).withMessage(`${field} : ${values.join(' | ')}`);

export const email = (optional = false) => start(body('email'), optional)
  .isEmail().withMessage('email invalide')
  .normalizeEmail();

export const strongPassword = (optional = false) => start(body('password'), optional)
  .isString()
  .isStrongPassword({
    minLength: 8, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 0
  })
  .withMessage('password : 8 caractères min, avec majuscule, minuscule et chiffre');

export const idParam = (name = 'id') => param(name).isMongoId().withMessage(`${name} invalide`);

export const idBody = (field, optional = false) => start(body(field), optional)
  .isMongoId().withMessage(`${field} : identifiant invalide`);

export const idList = (field) => [
  body(field).optional().isArray({ max: 200 }).withMessage(`${field} : tableau attendu`),
  body(`${field}.*`).isMongoId().withMessage(`${field} : identifiants invalides`)
];

export const idQuery = (field, optional = false) => start(query(field), optional)
  .isMongoId().withMessage(`${field} : identifiant invalide`);

export const pagination = [
  query('page').optional().isInt({ min: 1 }).withMessage('page : entier >= 1'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit : entier entre 1 et 100')
];

export const search = query('q').optional().isString().isLength({ max: 100 })
  .withMessage('q : texte de 100 caractères max');
