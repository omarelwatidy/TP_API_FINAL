import bcrypt from 'bcryptjs';
import AppError from '../middleware/AppError.mjs';
import { signToken } from '../middleware/auth.mjs';
import { authLimiter } from '../middleware/rateLimit.mjs';

// 8 caractères minimum, avec une minuscule, une majuscule et un chiffre
export const isStrongPassword = (password) => typeof password === 'string'
  && /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);

const passwordError = [{
  field: 'password',
  message: 'password : 8 caractères min, avec majuscule, minuscule et chiffre'
}];

const Auth = class Auth {
  constructor(app, models) {
    this.app = app;
    this.User = models.User;

    this.run();
  }

  register() {
    this.app.post('/auth/register', authLimiter, async (req, res) => {
      const {
        firstname, lastname, email, password, age, city, avatar
      } = req.body;

      if (!isStrongPassword(password)) {
        throw new AppError(422, 'Données invalides', passwordError);
      }

      // On ne prend que les champs autorisés : impossible de se donner le rôle admin
      const hash = await bcrypt.hash(password, 12);
      const user = await this.User.create({
        firstname, lastname, email, password: hash, age, city, avatar
      });

      res.status(201).json(user);
    });
  }

  login() {
    this.app.post('/auth/login', authLimiter, async (req, res) => {
      const { email, password } = req.body;

      // On vérifie que ce sont bien des textes (évite les injections du type { "$gt": "" })
      if (typeof email !== 'string' || typeof password !== 'string') {
        throw new AppError(422, 'Données invalides');
      }

      const user = await this.User.findOne({ email: email.toLowerCase().trim() }).select('+password');
      const ok = user ? await bcrypt.compare(password, user.password) : false;

      // Même message si l'email n'existe pas ou si le mot de passe est faux
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
