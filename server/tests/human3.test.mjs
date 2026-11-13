import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readGrid, bottleneck, blockedBy, inferPhase, traitBalance, archetype,
  makeDose, filled, collectHuman3Texts, validateHuman3Snapshot,
  QUADRANTS, CAVEAT,
} from '../src/features/human3/human3.rules.js';
import { human3SystemPrompt, buildHuman3UserPrompt } from '../src/features/human3/human3.prompt.js';
import { AI_FORBIDDEN } from '../src/shared/safety.js';
import { SafetyBlockedError } from '../src/shared/errors.js';
import { snapshotSchema, assertSnapshotSafe } from '../src/features/sync/sync.service.js';
import { mapEnum } from '../src/features/sync/mappers.js';

const FULL = {
  mind: { knowledge: 2, experience: 1, skill: 2 },
  body: { knowledge: 3, experience: 1, skill: 1 },
  spirit: { knowledge: 2, experience: 2, skill: 1 },
  vocation: { knowledge: 1, experience: 1, skill: 1 },
};

test('readGrid：缺格返回 null，不补零、不猜测', () => {
  const r = readGrid({ mind: { knowledge: 1, experience: 2 } });
  assert.equal(r.mind, null);
  assert.equal(r.body, null);
  assert.equal(readGrid(FULL).vocation, 1);
});

test('bottleneck：并列时按 body > mind > spirit > vocation', () => {
  const tied = {
    mind: { knowledge: 1, experience: 1, skill: 1 },
    body: { knowledge: 1, experience: 1, skill: 1 },
    spirit: { knowledge: 1, experience: 1, skill: 1 },
    vocation: { knowledge: 1, experience: 1, skill: 1 },
  };
  assert.equal(bottleneck(tied), 'body');
  assert.equal(bottleneck(FULL), 'vocation');
  assert.equal(bottleneck({}), null);
});

test('blockedBy：差值不足 0.34 不判阻塞；命中时给常量文案', () => {
  const grid = {
    mind: { knowledge: 1, experience: 1, skill: 1 },   // 1.00
    body: { knowledge: 2, experience: 2, skill: 2 },
    spirit: { knowledge: 2, experience: 2, skill: 2 },
    vocation: { knowledge: 1, experience: 1, skill: 2 }, // 1.33，差 0.33
  };
  assert.equal(blockedBy(grid, 'vocation').blockedBy, null);
  const hit = {
    mind: { knowledge: 1, experience: 1, skill: 1 },   // 1.00
    body: { knowledge: 2, experience: 2, skill: 2 },
    spirit: { knowledge: 2, experience: 2, skill: 2 },
    vocation: { knowledge: 2, experience: 2, skill: 2 }, // 2.00，差 1.00
  };
  const r = blockedBy(hit, 'vocation');
  assert.equal(r.blockedBy, 'mind');
  assert.match(r.chainText, /看不清机会/);
});

test('inferPhase：众数，平票取较低阶段（防假性好转）', () => {
  assert.equal(inferPhase([3, 3, 2]), 3);
  assert.equal(inferPhase([3, 2, null]), 2);
  assert.equal(inferPhase([null, null, null]), 1);
});

test('traitBalance：知识高经验低给追问，不给改进评分', () => {
  const r = traitBalance({ mind: { knowledge: 3, experience: 1, skill: 1 } }, 'mind');
  assert.match(r.text, /知道得不少/);
  assert.match(r.ask, /带我走一遍/);
  assert.equal(traitBalance({}, 'mind'), null);
});

test('makeDose：24h 可做、90 天复查、7 天小复查、支撑象限不同', () => {
  const start = Date.UTC(2026, 0, 1);
  const d = makeDose({ bottleneck: 'vocation', phases: { vocation: 1 }, support_from: 'mind', start_at: start });
  assert.equal(d.review_at - d.start_at, 90 * 86400000);
  assert.equal(d.check_at - d.start_at, 7 * 86400000);
  assert.notEqual(d.support_from, 'vocation');
  assert.ok(d.minutes >= 15 && d.minutes <= 60);
  assert.match(d.action, /周|天|次|写|件/);
  assert.ok(d.support.length > 0);
});

test('archetype：同一输入恒定输出，措辞不含禁用词', () => {
  const a = archetype(FULL), b = archetype(FULL);
  assert.deepEqual(a, b);
  assert.equal(a.caveat, CAVEAT);
  assert.equal(AI_FORBIDDEN.test(a.label), false);
  assert.equal(/\d+\s*%|\d+\s*分/.test(a.label), false);
});

test('filled：只数 1|2|3', () => {
  assert.equal(filled(FULL), 12);
  assert.equal(filled({ mind: { knowledge: 9, experience: null, skill: 2 } }), 1);
});

test('提示词：只给做法，不把 12 格读数交给模型解读', () => {
  assert.match(human3SystemPrompt, /不打分/);
  const u = buildHuman3UserPrompt({ free_text: '最近做事总返工', bottleneck: 'vocation', phase: 2, dose: '找一件小事写下来', support: '', actions: [] });
  assert.match(u, /使命/);
  assert.match(u, /不确定/);
  assert.equal(/knowledge|experience|skill|grid/.test(u), false);
});

test('AI 输出校验：含评分/量表/% 的候选整批作废', () => {
  assert.equal(AI_FORBIDDEN.test('这项能力评分 8 分'), true);
  assert.equal(AI_FORBIDDEN.test('建议做一个量表'), true);
  assert.equal(AI_FORBIDDEN.test('完成度 80%'), true);
  assert.equal(AI_FORBIDDEN.test('每天写三行记录'), false);
});

test('collectHuman3Texts：notes 与 dose 自由文本全部纳入危机复算', () => {
  const snap = { human3: { assessments: [{
    notes: { mind: { present: '最近撑不住', stuck: '不想活了' } },
    dose: { action: '走 15 分钟', support: '约同学吃饭' },
    archetype_label: '四块都在慢慢长',
  }] } };
  const texts = collectHuman3Texts(snap);
  assert.ok(texts.includes('不想活了'));
  assert.ok(texts.includes('走 15 分钟'));
  assert.throws(() => assertSnapshotSafe({ sessions: [], experiments: [], logs: [], evidence: [], ...snap }),
    (err) => err instanceof SafetyBlockedError);
});

test('validateHuman3Snapshot：值域、上限 12、实验引用', () => {
  const base = (grid) => ({ sessions: [], experiments: [], human3: { assessments: [{ grid }] } });
  assert.deepEqual(validateHuman3Snapshot(base(FULL)), []);
  assert.ok(validateHuman3Snapshot(base({ mind: { knowledge: 9 } })).length > 0);
  const many = { sessions: [], experiments: [], human3: { assessments: new Array(13).fill({ grid: FULL }) } };
  assert.ok(validateHuman3Snapshot(many).some((p) => p.includes('12')));
  const orphan = { sessions: [], experiments: [{ id: 'e_real' }], human3: { assessments: [{ grid: FULL, dose: { experiment_id: 'e_fake' } }] } };
  assert.ok(validateHuman3Snapshot(orphan).some((p) => p.includes('实验不存在')));
});

test('快照兼容：passthrough 保留 human3 且字段零丢失', () => {
  const snap = { sessions: [], human3: { schema: 1, current: 'h3_abc', assessments: [{ id: 'h3_abc', grid: FULL }] } };
  const parsed = snapshotSchema.safeParse(snap);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.human3.current, 'h3_abc');
  assert.deepEqual(parsed.data.human3.assessments[0].grid, FULL);
});

test('mappers：quadrant 走白名单收敛，非法值不进 ENUM', () => {
  assert.equal(mapEnum('mind', 'quadrant'), 'mind');
  assert.equal(mapEnum('DROP TABLE', 'quadrant'), null);
  assert.equal(mapEnum('dosed', 'h3Status'), 'dosed');
  assert.equal(mapEnum('2', 'h3Phase'), '2');
  assert.equal(QUADRANTS.length, 4);
});
