import { ZodError } from 'zod';
import { AppError, ValidationError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

/** 全局错误处理：客户端只看到规范化结构，绝不返回堆栈或内部细节 */
export function errorHandler(err, _req, res, _next) {
  let error = err;

  if (err instanceof ZodError) {
    error = new ValidationError('提交的内容不符合要求', {
      fields: err.issues.map((i) => ({ field: i.path.join('.'), rule: i.code })),
    });
  } else if (!(err instanceof AppError)) {
    logger.error('unhandled_error', {
      name: err?.name,
      message: err?.message,
      stack: err?.stack?.split('\n').slice(0, 5).join(' | '),
    });
    error = new AppError('服务内部错误', { status: 500, code: 'INTERNAL_ERROR', expose: false });
  } else if (err.status >= 500) {
    logger.error('app_error', { code: err.code, message: err.message });
  }

  return res.status(error.status).json({
    ok: false,
    error: error.toJSON(),
    requestId: res.locals.requestId || '-',
  });
}
