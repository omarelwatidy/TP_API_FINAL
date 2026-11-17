import jwt from 'jsonwebtoken';
import config from '../config.mjs';
import AppError from './AppError.mjs';

// Crée le token envoyé à l'utilisateur quand il se connecte
export const signToken = (user) => jwt.sign(
  { sub: String(user._id), role: user.role },
  config.jwtSecret,
  { algorithm: 'HS256', expiresIn: config.jwtExpiresIn }
);

// Vérifie le token de l'en-tête "Authorization: Bearer <token>"
export const authenticate = (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'Token manquant'));
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Token expiré' : 'Token invalide';
    return next(new AppError(401, message));
  }
};
