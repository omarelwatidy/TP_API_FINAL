import { rateLimit } from 'express-rate-limit';
import config from '../config.mjs';

const handler = (req, res) => {
  res.status(429).json({ code: 429, message: 'Trop de requêtes, réessayez plus tard' });
};

// 100 requêtes / heure / IP sur toute l'API (configurable)
export const globalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.rateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler
});

// Plus strict sur login/register/achat de billet (anti brute-force) : 10 / 15 min
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler
});
