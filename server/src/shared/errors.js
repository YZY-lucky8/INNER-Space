/**
 * 类型化错误体系。
 * 客户端永远只看到 { ok:false, error:{ code, message, details? } }，
 * 堆栈与内部信息只进服务端日志。
 */
export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', expose = true, details, cause } = {}) {
    super(message, { cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.expose = expose;
    this.details = details;
    this.operational = true;
  }

  toJSON() {
    const body = { code: this.code, message: this.expose ? this.message : '服务暂时不可用，请稍后再试' };
    if (this.expose && this.details) body.details = this.details;
    return body;
  }
}

export class BadRequestError extends AppError {
  constructor(message = '请求参数不合法', details) {
    super(message, { status: 400, code: 'BAD_REQUEST', details });
  }
}

export class ValidationError extends AppError {
  constructor(message = '提交的内容不符合要求', details) {
    super(message, { status: 422, code: 'VALIDATION_FAILED', details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = '登录状态已失效，请重新登录') {
    super(message, { status: 401, code: 'UNAUTHORIZED' });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = '没有权限执行这个操作') {
    super(message, { status: 403, code: 'FORBIDDEN' });
  }
}

export class NotFoundError extends AppError {
  constructor(message = '没有找到这条记录') {
    super(message, { status: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = '云端数据与本机不一致', details) {
    super(message, { status: 409, code: 'CONFLICT', details });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = '操作太频繁，请稍后再试') {
    super(message, { status: 429, code: 'RATE_LIMITED' });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = '服务暂时不可用', details) {
    super(message, { status: 503, code: 'SERVICE_UNAVAILABLE', details });
  }
}

export class DatabaseUnavailableError extends AppError {
  constructor(cause) {
    super('数据库尚未就绪，请先启动 MySQL 并执行 npm run db:init', {
      status: 503,
      code: 'DB_UNAVAILABLE',
      expose: true,
      cause,
    });
  }
}

/** 危机信号命中：不落原文、不写库，统一返回 422 + 转介资源 */
export class SafetyBlockedError extends AppError {
  constructor(channel) {
    super('这段内容先不发布。如果你现在很难受，建议直接联系下面这些渠道。', {
      status: 422,
      code: 'SAFETY_BLOCKED',
      details: {
        channel,
        resources: ['全国心理援助热线 12356', '北京心理危机研究与干预中心 010-82951332', '学校心理健康教育中心'],
      },
    });
  }
}
