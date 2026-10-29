import { ValidationError } from '../shared/errors.js';

/**
 * 所有输入在边界处校验，绝不信任客户端数据。
 * 失败时只回传字段路径，不回传字段值（避免原文出现在日志/响应中）。
 */
export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const fields = result.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        rule: i.code,
      }));
      return next(new ValidationError('提交的内容不符合要求', { fields }));
    }
    req.body = result.data;
    return next();
  };
}

export function validateParams(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params ?? {});
    if (!result.success) return next(new ValidationError('地址参数不合法'));
    req.params = result.data;
    return next();
  };
}
