import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import { verifyOrigin } from './middlewares/auth.js';
import { apiLimiter, sanitizeBody } from './middlewares/security.js';
import { router } from './routes/index.js';

export function createApp() {
  const app = express();

  // Render / Vercel sit behind a proxy; needed for correct client IPs in rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.allowedOrigins.includes(origin)),
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(sanitizeBody);
  app.use(verifyOrigin);
  if (env.NODE_ENV !== 'test') app.use(morgan(env.isProduction ? 'combined' : 'dev'));

  app.get('/', (_req, res) => {
    res.json({ name: 'Doctor Tracker API', docs: '/api/health' });
  });
  app.use('/api', apiLimiter, router);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
