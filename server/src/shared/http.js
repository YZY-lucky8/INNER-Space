/**
 * 统一响应结构与异步控制器包装。
 * 成功：{ ok:true, data, requestId }
 * 失败：{ ok:false, error:{code,message,details?}, requestId }
 */
export function ok(res, data = null, status = 200) {
  return res.status(status).json({ ok: true, data, requestId: res.locals.requestId || '-' });
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function notFoundHandler(req, res) {
  return res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: '没有这个接口' },
    requestId: res.locals.requestId || '-',
  });
}
