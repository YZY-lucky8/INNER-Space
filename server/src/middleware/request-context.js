import { randomUUID } from 'node:crypto';
import { logger } from '../shared/logger.js';

/** 请求 ID 贯穿日志与响应；结构化记录每个请求，不记录请求体 */
export function requestContext(req, res, next) {
  const requestId = req.get('x-request-id') || randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  const started = Date.now();

  res.on('finish', () => {
    logger.info('http.request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - started,
    });
  });

  logger.runWith({ requestId }, () => next());
}
