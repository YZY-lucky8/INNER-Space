import assert from 'node:assert/strict';
import test from 'node:test';
import { SafetyBlockedError, assertSafe, detectCrisis } from '../src/core.js';

test('关键词通道命中自伤表达', () => {
  const r = detectCrisis('最近一直在想自杀这件事');
  assert.equal(r.hit, true);
  assert.equal(r.channel, 'keyword');
});

test('规则通道：持续负面 + 绝对化', () => {
  assert.equal(detectCrisis('我彻底绝望了').hit, true);
  assert.equal(detectCrisis('很痛苦而且永远都不会好').channel, 'rule');
});

test('规则通道：持续负面 + 功能受损', () => {
  assert.equal(detectCrisis('撑不住，长期失眠').hit, true);
});

test('正常文本与空串不误报', () => {
  assert.equal(detectCrisis('这周换了做法，产出还是没变化').hit, false);
  assert.equal(detectCrisis('').hit, false);
  assert.equal(detectCrisis(null).hit, false);
});

test('assertSafe 命中时抛类型化错误并带转介资源', () => {
  assert.throws(() => assertSafe('不想活了', 'forum'), (err) => {
    assert.ok(err instanceof SafetyBlockedError);
    assert.equal(err.status, 422);
    assert.equal(err.code, 'SAFETY_BLOCKED');
    assert.ok(err.details.resources.some((s) => s.includes('12356')));
    return true;
  });
});
