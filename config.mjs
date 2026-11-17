import 'dotenv/config';

['MONGODB_URI', 'JWT_SECRET'].forEach((name) => {
  if (!process.env[name]) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
});

if (process.env.JWT_SECRET.length < 16) {
  throw new Error('JWT_SECRET est trop court (16 caractères minimum)');
}

export default {
  type: process.argv[2] === 'production' ? 'production' : 'development',
  port: Number(process.env.PORT) || 3000,
  mongodb: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  sslKey: process.env.SSL_KEY || './certs/key.pem',
  sslCert: process.env.SSL_CERT || './certs/cert.pem',
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 100,
  publicUrl: process.env.PUBLIC_URL || ''
};
