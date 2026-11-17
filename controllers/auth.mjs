import bcrypt from 'bcryptjs';
import { body } from 'express-validator';
import validate from '../middleware/validate.mjs';
import AppError from '../middleware/AppError.mjs';
import { signToken } from '../middleware/auth.mjs';
import { authLimiter } from '../middleware/rateLimit.mjs';
import {
  text, url, email, strongPassword
} from '../services/rules.mjs';

const registerRules = () => [
  text('firstname', { min: 2, max: 50 }),
  text('lastname', { min: 2, max: 50 }),
  email(),
  strongPassword(),
  body('age').optional().isInt({ min: 0, max: 120 }).withMessage('age : entier entre 0 et 120').toInt(),
  text('city', { max: 100, optional: true }),
  url('avatar')
];

const loginRules = () => [
  email(),
  body('password').isString().notEmpty().withMessage('password requis')
];

const Auth = class Auth {
  constructor(app, models) {
    this.app = app;
    this.User = models.User;

    this.run();
  }

  register() {
    this.app.post('/auth/register', authLimiter, registerRules(), validate, async (req, res) => {
      const {
        firstname, lastname, email: mail, password, age, city, avatar
      } = req.body; // liste blanche : impossible de s'attribuer le rôle admin

      const hash = await bcrypt.hash(password, 12);
      const user = await this.User.create({
        firstname, lastname, email: mail, password: hash, age, city, avatar
      });

      res.status(201).json(user);
    });
  }

  login() {
    this.app.post('/auth/login', authLimiter, loginRules(), validate, async (req, res) => {
      const { email: mail, password } = req.body;

      const user = await this.User.findOne({ email: mail }).select('+password');
      const ok = user ? await bcrypt.compare(password, user.password) : false;

      if (!ok) {
        throw new AppError(401, 'Identifiants invalides');
      }

      res.status(200).json({ token: signToken(user) });
    });
  }

  run() {
    this.register();
    this.login();
  }
};

export default Auth;
