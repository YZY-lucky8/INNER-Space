import http from 'node:http';
import { createApp } from './app.js';
import { env } from './core.js';
import { logger } from './core.js';
import { closePool } from './core.js';

const app = createApp();
const server = http.createServer(app);

server.on('clientError', (err, socket) => {
  if (!socket.writableEnded) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  logger.warn('http.client_error', { message: err?.message });
});

server.listen(env.PORT, () => {
  logger.info('server.started', {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    llmEnabled: env.llmEnabled,
    url: `http://localhost:${env.PORT}/`,
  });
  for (const w of env.warnings) logger.warn('config.warning', { message: w });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server.shutdown_started', { signal });
  server.close(async () => {
    try { await closePool(); } catch (err) { logger.error('db.close_failed', { message: err?.message }); }
    logger.info('server.shutdown_complete');
    process.exit(0);
  });
  // 兜底：长连接未断开时最多等 10 秒
  setTimeout(() => {
    logger.warn('server.shutdown_forced');
    process.exit(0);
  }, 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('unhandled_rejection', { message: String(reason) }));
process.on('uncaughtException', (err) => {
  logger.error('uncaught_exception', { message: err?.message, stack: err?.stack?.split('\n')[0] });
  void shutdown('uncaughtException');
});
