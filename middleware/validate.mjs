import { validationResult } from 'express-validator';

export default (req, res, next) => {
  const result = validationResult(req);

  if (result.isEmpty()) {
    return next();
  }

  return res.status(422).json({
    code: 422,
    message: 'Données invalides',
    errors: result.array().map((e) => ({ field: e.path, message: e.msg }))
  });
};
