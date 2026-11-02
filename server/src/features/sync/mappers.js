/** 前端 localStorage 对象 → MySQL 字段的映射。所有枚举都做白名单收敛，绝不直接把客户端值塞进 ENUM 列。 */

const ENUMS = {
  q1: ['0-3', '4-10', '11-20', '20+'],
  q2: ['yes', 'no', 'unclear'],
  q3: ['none', 'once', 'multiple'],
  q4: ['yes', 'no', 'unclear'],
  q5: ['yes', 'reachable', 'unreachable', 'none'],
  engine: ['rule', 'ai', 'hybrid'],
  status: ['open', 'converged', 'abandoned', 'referred'],
  confidence: ['low', 'medium', 'high'],
  outcome: ['confirmed', 'refuted', 'inconclusive'],
  nextAction: ['continue', 'new_session', 'graduated', 'referred'],
  evidenceType: ['interest', 'strength', 'value', 'energy', 'boundary'],
  /* Human 3.0：新枚举一律白名单收敛，绝不把客户端值直接写进 ENUM 列 */
  quadrant: ['mind', 'body', 'spirit', 'vocation'],
  h3Status: ['draft', 'report', 'dosed', 'reviewing', 'archived'],
  h3Phase: ['1', '2', '3'],
};

export function enumOrNull(value, allowed) {
  const v = String(value ?? '').trim();
  return allowed.includes(v) ? v : null;
}

/** 前端用 '0-3' 等，与 DB ENUM 一致；q5 的 'cant' 要翻译 */
export function mapQ5(v) {
  if (v === 'cant') return 'unreachable';
  if (v === 'yes') return 'reachable';
  return enumOrNull(v, ENUMS.q5);
}

/** 规则诊断给中文置信度，AI 精修链路可能给英文 */
export function mapConfidence(v) {
  const zh = { 低: 'low', 中: 'medium', 高: 'high' };
  return zh[v] || enumOrNull(v, ENUMS.confidence) || 'low';
}

/** 前端有 running / paused 等中间态，DB 只保留四类终态 */
export function mapStatus(v) {
  if (v === 'converged' || v === 'abandoned' || v === 'referred') return v;
  return 'open';
}

export function mapOutcome(v) {
  const aliases = { confirm: 'confirmed', refute: 'refuted', unclear: 'inconclusive', none: 'inconclusive' };
  return aliases[v] || enumOrNull(v, ENUMS.outcome);
}

export function mapNextAction(v) {
  const aliases = { new: 'new_session', graduate: 'graduated' };
  return aliases[v] || enumOrNull(v, ENUMS.nextAction);
}

export function mapEvidenceType(v) {
  const aliases = { 兴趣: 'interest', 优势: 'strength', 价值观: 'value', 能量: 'energy', 边界: 'boundary' };
  const out = aliases[v] || enumOrNull(v, ENUMS.evidenceType);
  if (!out) throw new Error('unknown_evidence_type');
  return out;
}

export const mapEngine = (v) => enumOrNull(v, ENUMS.engine) || 'rule';
export const mapEnum = (v, key) => enumOrNull(v, ENUMS[key]);

/** 前端 now() 可能是 ISO 字符串或毫秒数；统一成 MySQL DATETIME 字面量 */
export function toDatetime(value) {
  if (value == null || value === '') return new Date().toISOString().slice(0, 19).replace('T', ' ');
  let d;
  if (typeof value === 'number') d = new Date(value < 1e11 ? value * 1000 : value);
  else if (typeof value === 'string') {
    const normalized = /^\d+$/.test(value) ? Number(value) : value.replace(' ', 'T');
    d = new Date(normalized);
  } else d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** JSON 列必须是合法 JSON，不能直接塞 undefined / 空串 */
export function jsonOr(value, fallback) {
  if (value == null) return JSON.stringify(fallback);
  if (typeof value === 'string') {
    try { JSON.parse(value); return value; } catch { return JSON.stringify(fallback); }
  }
  try { return JSON.stringify(value); } catch { return JSON.stringify(fallback); }
}

export const truncate = (value, max) => String(value ?? '').slice(0, max);
export const asId = (value) => String(value ?? '').slice(0, 64);
