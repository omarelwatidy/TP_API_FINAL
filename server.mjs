import fs from 'node:fs';
import https from 'node:https';
import express from 'express';
import mongoose from 'mongoose';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';

import config from './config.mjs';
import registerModels from './models/index.mjs';
import routes from './controllers/routes.mjs';
import { globalLimiter } from './middleware/rateLimit.mjs';
import { notFound, errorHandler } from './middleware/errorHandler.mjs';

const Server = class Server {
  constructor() {
    this.app = express();
    this.config = config;
  }

  async dbConnect() {
    this.connect = await mongoose.createConnection(this.config.mongodb).asPromise();
    this.models = registerModels(this.connect);

    this.connect.on('error', (err) => {
      console.error(`[ERROR] api dbConnect() -> ${err.message}`);
    });
    this.connect.on('disconnected', () => {
      console.log('[DISCONNECTED] api dbConnect() -> mongodb disconnected');
    });

    process.on('SIGINT', async () => {
      await this.connect.close();
      console.log('[CLOSE] api dbConnect() -> mongodb closed');
      process.exit(0);
    });
  }

  security() {
    this.app.disable('x-powered-by');
    this.app.use(helmet());

    const { allowedOrigins } = this.config;
    this.app.use(cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Origin non autorisée par CORS'));
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));

    this.app.use(globalLimiter);
  }

  middleware() {
    this.app.use(compression());
    this.app.use(express.urlencoded({ extended: false, limit: '10kb' }));
    this.app.use(express.json({ limit: '10kb' }));
  }

  routes() {
    Object.values(routes).forEach((Controller) => new Controller(this.app, this.models));

    this.app.use(notFound);
    this.app.use(errorHandler);
  }

  listen() {
    const options = {
      key: fs.readFileSync(this.config.sslKey),
      cert: fs.readFileSync(this.config.sslCert)
    };

    https.createServer(options, this.app).listen(this.config.port, () => {
      console.log(`[START] API en HTTPS sur https://localhost:${this.config.port}`);
    });
  }

  async run() {
    try {
      await this.dbConnect();
      this.security();
      this.middleware();
      this.routes();
      this.listen();
    } catch (err) {
      console.error(`[ERROR] Server -> ${err.message}`);
      process.exit(1);
    }
  }
};

export default Server;
