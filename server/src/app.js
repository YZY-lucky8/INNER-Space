import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';

import { env } from './config/env.js';
import { logger } from './shared/logger.js';
import { requestContext } from './middleware/request-context.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './shared/http.js';

import healthRoutes from './features/health/health.routes.js';
import authRoutes from './features/auth/auth.routes.js';
import syncRoutes from './features/sync/sync.routes.js';
import diagnoseRoutes from './features/diagnose/diagnose.routes.js';
import forumRoutes from './features/forum/forum.routes.js';
import human3Routes from './features/human3/human3.routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../src');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // 安全头。前端是 5623 行单文件内联脚本，暂不具备 nonce 化条件，
  // 因此 CSP 显式留空；其余安全头照常启用。前端模块化后应重新开启。
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
  }));

  app.use(cors({
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  }));

  app.use(requestContext);
  app.use(express.json({ limit: '256kb', strict: true }));
  app.use(cookieParser());

  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 400,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path === '/ready',
    handler: (_req, res) => res.status(429).json({
      ok: false,
      error: { code: 'RATE_LIMITED', message: '操作太频繁，请稍后再试' },
      requestId: res.locals.requestId || '-',
    }),
  }));

  // 静态托管现有前端：同源访问时 API 不需要跨域，双击 file:// 仍可纯离线运行。
  app.use(express.static(webRoot, {
    index: 'index.html',
    dotfiles: 'deny',
    setHeaders(res, filePath) {
      if (/\.html?$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  app.use(healthRoutes);
  app.use(authRoutes);
  app.use(syncRoutes);
  app.use(diagnoseRoutes);
  app.use(forumRoutes);
  app.use(human3Routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.info('app.created', { webRoot, corsOrigins: env.corsOrigins.length });
  return app;
}
