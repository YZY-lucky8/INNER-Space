import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapQ5, mapConfidence, mapStatus, mapOutcome, mapNextAction,
  mapEvidenceType, mapEngine, toDatetime, jsonOr, enumOrNull,
} from '../src/features/sync/mappers.js';

test('q5 前端 cant 映射为 unreachable，非法值收敛为 null', () => {
  assert.equal(mapQ5('cant'), 'unreachable');
  assert.equal(mapQ5('yes'), 'reachable');
  assert.equal(mapQ5('none'), 'none');
  assert.equal(mapQ5(' hacked '), null);
});

test('置信度中英文双向收敛', () => {
  assert.equal(mapConfidence('高'), 'high');
  assert.equal(mapConfidence('中'), 'medium');
  assert.equal(mapConfidence('低'), 'low');
  assert.equal(mapConfidence('high'), 'high');
  assert.equal(mapConfidence('99%'), 'low');
});

test('状态 / 结果 / 下一步 / 证据类型 / 引擎白名单', () => {
  assert.equal(mapStatus('running'), 'open');
  assert.equal(mapStatus('converged'), 'converged');
  assert.equal(mapOutcome('confirm'), 'confirmed');
  assert.equal(mapOutcome('refute'), 'refuted');
  assert.equal(mapOutcome('bad'), null);
  assert.equal(mapNextAction('new'), 'new_session');
  assert.equal(mapEvidenceType('interest'), 'interest');
  assert.equal(mapEvidenceType('边界'), 'boundary');
  assert.throws(() => mapEvidenceType('unknown'));
  assert.equal(mapEngine('bogus'), 'rule');
});

test('时间统一为 MySQL DATETIME 字面量', () => {
  assert.match(toDatetime('2026-11-15T03:00:00.000Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.match(toDatetime(1763175600000), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.match(toDatetime('not-a-date'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('JSON 列永远返回合法 JSON', () => {
  assert.deepEqual(JSON.parse(jsonOr({ a: 1 }, {})), { a: 1 });
  assert.equal(jsonOr(undefined, []), '[]');
  assert.equal(jsonOr('not json', {}), '{}');
  assert.equal(enumOrNull('20+', ['0-3', '4-10', '11-20', '20+']), '20+');
});
