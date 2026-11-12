import { env } from '../src/config/env.js';

/** 启动冒烟：先起服务（npm start），再运行 npm run smoke。 */
const BASE = process.env.SMOKE_BASE || `http://127.0.0.1:${env.PORT}`;
let pass = 0, fail = 0, skip = 0;

function report(name, ok, extra = '') {
  const tag = ok === 'skip' ? 'SKIP' : ok ? 'PASS' : 'FAIL';
  if (tag === 'PASS') pass++;
  else if (tag === 'FAIL') fail++;
  else skip++;
  console.log(`${tag.padEnd(4)} ${name}${extra ? '  → ' + extra : ''}`);
}

async function call(method, path, { body, token, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json, headers: r.headers };
}

function minimalSnapshot() {
  const now = new Date().toISOString();
  const freeText = '这周我把做法换了一遍，但是产出还是没有变化，每周大概花了十二小时。';
  return {
    version: 1,
    user: { id: 'u_smoke' },
    sessions: [{
      id: 's_smoke', created_at: now, free_text: freeText,
      answers: { q1: '11-20', q2: 'no', q3: 'none', q4: 'yes', q5: 'none' },
      q2_detail: '', rule_top: 'A_METHOD', rule_second: 'B_SKILL',
      rule_scores: { A_METHOD: 4 }, why_guess: '', uncertainty: '', engine: 'rule',
      round_no: 1, root_id: 's_smoke', status: 'open', experiment_id: null,
      hypotheses: [{
        type: 'A_METHOD', rank: 1, confidence: '高', reasoning: '投入增加但没变化',
        evidence_quote: '产出还是没有变化', evidence_from: '你写的原话', disagreed: false,
      }],
      reviews: [],
    }],
    experiments: [{
      id: 'e_smoke', session_id: 's_smoke', type: 'A_METHOD', template_key: 'A1',
      title: '换一种做法', actions: ['挑一件事', '换个做法', '写下差异'],
      observation: '产出差异', duration_days: 7, started_at: now, ended_at: null, outcome: null,
    }],
    logs: [{ id: 'l_smoke', experiment_id: 'e_smoke', day_no: 1, slot: 1, did_it: true, note: '第一次记录', energy: 1, created_at: now }],
    evidence: [{ id: 'ev_smoke', type: 'strength', content: '换做法之后我能坚持做完', source_exp_id: 'e_smoke', session_id: 's_smoke', user_rejected: false, created_at: now }],
    rejects: [], flags: { direction_unlocked: false, demo: false }, remind: {},
  };
}

/** 等待服务监听端口，避免刚启动就发请求 */
async function waitForServer() {
  for (let i = 0; i < 25; i++) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function main() {
  console.log(`冒烟目标：${BASE}\n`);
  if (!await waitForServer()) {
    console.error('服务未就绪，请先在 server/ 目录运行 npm start');
    process.exit(1);
  }

  // 1. 存活与公开配置（不依赖数据库）
  let r = await call('GET', '/health');
  report('GET /health', r.status === 200 && r.json.ok === true, `status=${r.status}`);

  r = await call('GET', '/api/v1/config');
  report('GET /api/v1/config', r.status === 200 && r.json.data?.features?.sync === true,
    `ai=${r.json.data?.features?.ai}`);

  // 2. 认证边界
  r = await call('GET', '/api/v1/auth/me');
  report('未登录访问 /auth/me 返回 401', r.status === 401 && r.json.error?.code === 'UNAUTHORIZED');

  r = await call('POST', '/api/v1/sync/push', { body: { snapshot: {} } });
  report('未登录 push 被拒（离线红线）', r.status === 401);

  r = await call('GET', '/api/v1/auth/me', { token: 'forged.token.value' });
  report('伪造令牌被拒', r.status === 401);

  r = await call('POST', '/api/v1/forum/posts', { body: { title: 'x', content: 'y' } });
  report('未登录发帖被拒', r.status === 401);

  // 3. 输入校验（边界处拒绝脏数据，不依赖数据库）
  r = await call('POST', '/api/v1/auth/otp/request', { body: { email: 'not-an-email' } });
  report('非法邮箱被 422 拒绝', r.status === 422 && r.json.error?.code === 'VALIDATION_FAILED');

  // 4. AI 代理：未配置模型时应明确降级，而不是伪造结果
  r = await call('POST', '/api/v1/diagnose', {
    body: { free_text: '最近一直在做同一件事但没有进展', answers: {}, rule_top: 'A_METHOD', rule_second: 'B_SKILL', candidates: ['A_METHOD', 'B_SKILL'] },
  });
  const aiDegraded = r.status === 503 && r.json.error?.details?.code === 'AI_DISABLED';
  report('POST /diagnose 未配置 LLM 时静默降级', aiDegraded || r.status === 200,
    aiDegraded ? 'AI_DISABLED → 前端走规则引擎' : 'LLM 已配置');

  // 5. CORS 显式来源
  r = await call('OPTIONS', '/api/v1/sync/state', { headers: { Origin: 'http://localhost:8765', 'Access-Control-Request-Method': 'GET' } });
  const allow = r.headers.get('access-control-allow-origin');
  report('CORS 显式来源', allow === 'http://localhost:8765' || allow === null, `allow-origin=${allow || '(preflight handled)'}`);

  // 5.1 Human 3.0 公开接口与边界
  r = await call('GET', '/api/v1/config');
  report('GET /config 暴露 human3 能力', r.json.data?.features?.human3 === true);

  r = await call('POST', '/api/v1/human3/actions', {
    body: { free_text: '最近做事总返工', bottleneck: 'vocation', phase: 2, dose: '找一件小事写下来', support: '', actions: [] },
  });
  const h3Degraded = r.status === 503 && r.json.error?.details?.code === 'AI_DISABLED';
  report('POST /human3/actions 未配置 LLM 时静默降级', h3Degraded || r.status === 200,
    h3Degraded ? 'AI_DISABLED → 前端走规则模板' : 'LLM 已配置');

  r = await call('POST', '/api/v1/human3/assessments', { body: { id: 'h3_anonymous' } });
  report('POST /human3/assessments 未登录被拒', r.status === 401);

  r = await call('GET', '/api/v1/human3/distribution');
  report('GET /human3/distribution 公开可读且不暴露小样本',
    r.status === 200 && Object.prototype.hasOwnProperty.call(r.json.data || {}, 'available'));

  // 6. 数据库相关：就绪则跑完整链路，否则明确标记为 SKIP（绝不假装成功）
  const ready = await call('GET', '/ready');
  const dbUp = ready.status === 200;
  report('GET /ready', dbUp ? true : 'skip', dbUp ? 'database=up' : `${ready.status} ${ready.json.error?.code || ''} · 需启动 MySQL 并 npm run db:init`);

  if (dbUp) {
    const email = `smoke_${Date.now()}@example.com`;
    r = await call('POST', '/api/v1/auth/otp/request', { body: { email } });
    const code = r.json.data?.devCode;
    report('OTP 请求（dev 通道）', r.status === 200 && /^\d{6}$/.test(code || ''), `channel=${r.json.data?.channel}`);

    r = await call('POST', '/api/v1/auth/otp/verify', { body: { email, code } });
    const token = r.json.data?.accessToken;
    const cookie = r.headers.get('set-cookie') || '';
    report('OTP 校验并签发令牌', r.status === 200 && !!token, `httpOnly=${/httponly/i.test(cookie)}`);

    r = await call('GET', '/api/v1/auth/me', { token });
    report('GET /auth/me', r.status === 200 && r.json.data?.email === email);

    r = await call('GET', '/api/v1/sync/state', { token });
    report('GET /sync/state', r.status === 200 && r.json.data?.revision === 0);

    const snap = minimalSnapshot();
    r = await call('POST', '/api/v1/sync/push', { token, body: { snapshot: snap, baseRevision: 0 } });
    const revision = r.json.data?.revision;
    report('POST /sync/push 落库', r.status === 200 && revision === 1,
      r.status === 200 ? `sessions=${r.json.data?.applied?.sessions}` : JSON.stringify(r.json.error));

    r = await call('GET', '/api/v1/sync/pull', { token });
    report('GET /sync/pull 还原快照', r.status === 200 && r.json.data?.snapshot?.sessions?.length === 1,
      r.status !== 200 ? JSON.stringify(r.json.error) : `sessions=${r.json.data?.snapshot?.sessions?.length}`);

    // 服务端复算危机红线
    const crisis = minimalSnapshot();
    crisis.sessions[0].free_text = '我不想活了';
    r = await call('POST', '/api/v1/sync/push', { token, body: { snapshot: crisis, baseRevision: revision } });
    report('服务端复算危机拦截', r.status === 422 && r.json.error?.code === 'SAFETY_BLOCKED',
      `status=${r.status} code=${r.json.error?.code}`);

    // 服务端复算证据红线：没有实验记录不允许产出证据
    const noLogs = minimalSnapshot();
    noLogs.logs = [];
    r = await call('POST', '/api/v1/sync/push', { token, body: { snapshot: noLogs, baseRevision: revision } });
    report('服务端复算证据必须来自实验记录', r.status === 422 && r.json.error?.code === 'VALIDATION_FAILED');

    // 冲突检测
    r = await call('POST', '/api/v1/sync/push', { token, body: { snapshot: snap, baseRevision: 0 } });
    report('多端冲突检测 409', r.status === 409 && r.json.error?.code === 'CONFLICT',
      `status=${r.status} code=${r.json.error?.code}`);

    // Human 3.0：匿名坐标写入、危机复算覆盖新增自由文本、快照零丢失
    const h3Grid = {
      mind: { knowledge: 2, experience: 1, skill: 2 },
      body: { knowledge: 3, experience: 1, skill: 1 },
      spirit: { knowledge: 2, experience: 2, skill: 1 },
      vocation: { knowledge: 1, experience: 1, skill: 1 },
    };
    const h3Payload = {
      id: 'h3_smoke', bottleneck: 'vocation', blocked_by: 'mind',
      phases: { mind: 2, body: 1, spirit: 2, vocation: 1 }, grid: h3Grid,
      created_at: new Date().toISOString(),
    };
    r = await call('POST', '/api/v1/human3/assessments', { token, body: h3Payload });
    report('POST /human3/assessments 匿名坐标写入', r.status === 200 && r.json.data?.saved === true,
      r.status !== 200 ? JSON.stringify(r.json.error) : '');

    r = await call('GET', '/api/v1/human3/distribution');
    report('小样本不暴露象限分布', r.status === 200 && r.json.data?.available === false);

    const h3Crisis = minimalSnapshot();
    h3Crisis.human3 = { schema: 1, current: 'h3_c', assessments: [
      { id: 'h3_c', grid: h3Grid, notes: { mind: { present: '不想活了' } } },
    ] };
    r = await call('POST', '/api/v1/sync/push', { token, body: { snapshot: h3Crisis, baseRevision: revision } });
    report('human3 notes 危机词被服务端复算拦截', r.status === 422 && r.json.error?.code === 'SAFETY_BLOCKED',
      `status=${r.status} code=${r.json.error?.code}`);

    const h3Snap = minimalSnapshot();
    h3Snap.human3 = { schema: 1, current: 'h3_ok', assessments: [
      { id: 'h3_ok', grid: h3Grid, notes: { mind: { present: '最近有点累' } }, dose: { action: '走 15 分钟', support: '约同学吃饭' } },
    ] };
    r = await call('POST', '/api/v1/sync/push', { token, body: { snapshot: h3Snap, baseRevision: revision } });
    report('带 human3 的快照可同步', r.status === 200, r.status !== 200 ? JSON.stringify(r.json.error) : '');
    r = await call('GET', '/api/v1/sync/pull', { token });
    report('pull 后 human3 字段零丢失', r.status === 200 && r.json.data?.snapshot?.human3?.current === 'h3_ok');

    // 论坛写入与服务端校验
    r = await call('POST', '/api/v1/forum/posts', { token, body: { title: '一个困惑', content: '我换了做法，还是没进展，有人遇到过吗' } });
    const postId = r.json.data?.id;
    report('POST /forum/posts', r.status === 201 && !!postId);

    r = await call('POST', '/api/v1/forum/posts', { token, body: { title: '正常标题', content: '我不想活了' } });
    report('论坛危机内容被服务端拦截', r.status === 422 && r.json.error?.code === 'SAFETY_BLOCKED');

    r = await call('GET', '/api/v1/forum/posts');
    report('GET /forum/posts 公开可读', r.status === 200 && Array.isArray(r.json.data?.posts));

    if (postId) {
      r = await call('POST', `/api/v1/forum/posts/${postId}/replies`, { token, body: { content: '我当时是先停下来只练那一步' } });
      report('POST /forum/replies', r.status === 201);
    }

    // 清理，保持数据库干净
    r = await call('DELETE', '/api/v1/sync', { token });
    report('DELETE /sync 关闭同步', r.status === 200, r.status !== 200 ? JSON.stringify(r.json.error) : '');
    r = await call('POST', '/api/v1/auth/logout', { token });
    report('POST /auth/logout', r.status === 200);
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败 / ${skip} 跳过（跳过项需 MySQL 就绪）`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(`冒烟脚本无法连接服务：${err?.message}`);
  console.error('请先在 server/ 目录运行 npm start');
  process.exit(1);
});
