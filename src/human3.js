/* =========================================================
   human3.js —— Human 3.0 四象限坐标（前端领域层 + #/map 视图）
   ---------------------------------------------------------
   · 4 象限 × 3 Traits = 12 格自评；所有读数、瓶颈、阻塞链、
     阶段、参考画像、最小有效剂量都是**确定性纯函数**，零 LLM。
   · 数据落在 localStorage 的 DB.human3（离线优先，不新增存储键）。
   · 自评坐标，不是测评：不显示分数 / 等级 / 百分比 / 诊断词。
   · 3D 实体化在 lab/human3d.html，通过 postMessage 单向接收数据；
     iframe 重载不会反过来写主站数据。
   · ES5、零依赖、file:// 可用。
   ========================================================= */
(function () {
  'use strict';

  var Q = ['mind', 'body', 'spirit', 'vocation'];
  var T = ['knowledge', 'experience', 'skill'];
  var QL = { mind: '心智', body: '身体', spirit: '精神', vocation: '使命' };
  var QSUB = {
    mind: '个人 · 内在　想清楚事情的能力',
    body: '个人 · 外在　身体与日常节奏',
    spirit: '集体 · 内在　与人的连接',
    vocation: '集体 · 外在　在做的事与去向'
  };
  var QCOLOR = { mind: '#9ff0ce', body: '#7fd8c0', spirit: '#b9e6ff', vocation: '#e8cf92' };
  var TL = { knowledge: '知识', experience: '经验', skill: '技能' };
  /* v9：12 格不再共用一套题干。每个象限按自己的语境各写 3 问 + 3 档，
     但三档仍严格对应 1「几乎没动过」/ 2「做过但没稳」/ 3「做起来不费力」，
     所以 readGrid / bottleneck / makeDose 等确定性规则完全不受影响。
     这是「自评坐标」而非量表：问的是具体做过什么，不问态度、不打分。 */
  var QPROMPT = {
    mind: {
      knowledge: {
        q: '这一块的道理，你能用自己的话讲一遍吗',
        o: ['只记得别人怎么说', '能说个大概，细节会卡', '能讲给外行听明白']
      },
      experience: {
        q: '最近有没有真的拿它来想一个决定',
        o: ['基本没用过', '试过一两次，没连起来', '遇到事会自然用它']
      },
      skill: {
        q: '把一个绕来绕去的问题拆清楚，费不费劲',
        o: ['一上来就乱', '顺的时候能拆，卡住就没招', '能按自己的顺序拆开']
      }
    },
    body: {
      knowledge: {
        q: '你清楚自己什么时候状态最好、什么会拖垮你吗',
        o: ['没留意过', '大概知道，说不准', '能说出具体规律']
      },
      experience: {
        q: '最近一周，作息吃饭活动有没有照着自己的节奏来',
        o: ['基本是乱的', '有几天做到了', '大体稳定']
      },
      skill: {
        q: '累过头之后把自己拉回来，费不费劲',
        o: ['一乱就整段崩掉', '得缓好几天', '知道怎么较快恢复']
      }
    },
    spirit: {
      knowledge: {
        q: '你能说清自己需要什么样的陪伴和多远的距离吗',
        o: ['说不上来', '有感觉但讲不清', '能具体说给别人']
      },
      experience: {
        q: '最近一个月，有没有一次不谈任务、只聊近况的对话',
        o: ['想不起来了', '有过一两次', '常有，也维持着']
      },
      skill: {
        q: '需要帮忙时开口，或不舒服时说边界，费不费劲',
        o: ['基本憋着', '得鼓起勇气，事后还反复想', '能自然地讲']
      }
    },
    vocation: {
      knowledge: {
        q: '你能说清手上这件事交付给谁、解决什么吗',
        o: ['只知道要做完', '大概知道，讲不完整', '一句话说得清']
      },
      experience: {
        q: '最近三个月，有没有完整做完并交出去一件事',
        o: ['都在半路', '做过一两件，没连成线', '持续在交付']
      },
      skill: {
        q: '卡住时换一种做法继续推，费不费劲',
        o: ['只会反复原地试', '换过，但判断不了哪种好', '有自己的一套试法']
      }
    }
  };
  var CHOICE = {
    knowledge: ['基本说不清', '能说个大概', '能讲给别人听'],
    experience: ['没怎么动过', '试过一两次', '一直在做'],
    skill: ['每次都要重新想', '顺的时候还行', '基本不费力']
  };
  /* 兼容旧数据 / 外部调用：统一读法改为 quadrant 优先 */
  function promptOf(q, t) { return (QPROMPT[q] && QPROMPT[q][t]) || { q: '', o: CHOICE[t] }; }
  function choiceOf(q, t) { var p = promptOf(q, t); return p.o || CHOICE[t]; }
  var QNOTES = {
    mind: ['现在怎么想', '最绕的地方', '想清楚了会怎样'],
    body: ['现在的节奏', '最先垮掉的是', '状态稳了会怎样'],
    spirit: ['现在和谁近', '最别扭的相处', '松弛了会怎样'],
    vocation: ['在做什么', '最常卡在哪一步', '推得动会怎样']
  };
  var NOTES = [
    { k: 'present', l: '现在是什么样' },
    { k: 'stuck', l: '最不满意什么' },
    { k: 'want', l: '变好了会怎样' }
  ];
  var QSELF = {
    mind: ['一团乱，说不清', '有方向，方法没稳', '想得清，也在往外扩'],
    body: ['作息乱，精力跟着散', '知道问题，还没稳住', '节奏基本在自己手里'],
    spirit: ['不太想联系谁', '想靠近，又怕麻烦人', '关系里比较自在'],
    vocation: ['不知道在往哪走', '有方向，做法还在试', '手上的事在推进']
  };
  var BEHAVIOR_Q = [
    { q: '最近三个月，这一块你实际做过什么', o: ['想改但没动', '试过一两次，没连起来', '有在持续做，也知道什么管用'] },
    { q: '遇到卡住时你通常', o: ['反复想 / 反复搜', '换过做法，还在试', '有一套自己的处理顺序'] },
    { q: '现在最像哪种状态', o: ['说不清哪里不对，就是烦', '方向有了，方法还没稳', '基本顺了，在往外扩'] }
  ];
  var PHASE_LABEL = { 1: '不和谐', 2: '不确定', 3: '发现' };

  /* 阻塞链：src 低会拖住 target；解锁链：src 高可以给 target 借力 */
  var BLOCKS = { body: 'spirit', mind: 'vocation', spirit: 'mind', vocation: 'body' };
  var UNLOCKS = [
    ['body', 'spirit'], ['body', 'mind'], ['mind', 'vocation'],
    ['mind', 'spirit'], ['vocation', 'body'], ['spirit', 'mind']
  ];
  var BLOCK_TEXT = {
    body_spirit: '没力气的时候，很多「不想联系谁」其实只是累了',
    mind_vocation: '看不清机会在哪，往往不是机会不存在',
    spirit_mind: '没人给反馈，一个人很容易停止修正自己的想法',
    vocation_body: '时间和钱都被占满时，照顾身体最先被挤掉'
  };
  var UNLOCK_TEXT = {
    body_spirit: '先把力气补回来，深一点的连接才有力气维系',
    body_mind: '睡够了、动一动，脑子会明显清爽',
    mind_vocation: '想清楚了，才看得见哪条路是自己的',
    mind_spirit: '先能觉察自己，才谈得上真正的亲密',
    vocation_body: '手头宽裕一点，才有余力照顾身体',
    spirit_mind: '有人接着，才敢质疑自己一直相信的东西'
  };

  /* 最小有效剂量：4 象限 × 3 阶段，动词开头 + 时间/次数/交付物 */
  var DOSE = {
    mind: [
      ['把这一块最说不清的一句话写下来，圈出哪部分是听说的', 15],
      ['每天挑一个自己做过的决定，写一句当时凭什么', 15],
      ['把这一块管用的做法讲给一位同学听，记下他问的问题', 20]
    ],
    body: [
      ['晚饭后走 15 分钟，回来记一句身体什么感觉', 15],
      ['连续 3 天固定同一个入睡时间，早上记一次起床状态', 20],
      ['把现在管用的作息写成 3 行，一周后照着核对一次', 15]
    ],
    spirit: [
      ['这一周约一位同学吃一次饭，只聊近况不聊任务', 30],
      ['每周给一位久没联系的人发一句具体的话，共 2 次', 15],
      ['把一次聊得舒服的对话记下来，写清当时你做了什么', 20]
    ],
    vocation: [
      ['找一件这周做完的小事，写清交付给谁、有没有用', 20],
      ['每周试一种不同的做法，记下哪一种少返工，共 2 次', 30],
      ['把手上在做的整理成一页，标出哪一步最常被卡住', 30]
    ]
  };
  var SUPPORT = {
    mind: '每天睡前用 3 行写下今天想明白的一件事',
    body: '晚饭后走 15 分钟，给思路留点空隙',
    spirit: '每周约一位同学一起做一次，有人同行更容易连起来',
    vocation: '把这周做成的一件小事写下来，看看它通向哪里'
  };
  var CAVEAT = '这是你自己标的坐标，不是结论，随时可以改。';

  /* ---------- 工具 ---------- */
  function B() { return window.__INNERSPACE_BRIDGE || {}; }
  function db() { var b = B(); return b.getDB ? b.getDB() : null; }
  function save() { var b = B(); if (b.save) b.save(); }
  function redraw() { var b = B(); if (b.render) b.render(); }
  function navigate(v) { var b = B(); if (b.go) b.go(v); }
  function notice(s) { var b = B(); if (b.toast) b.toast(s); }
  function esc(s) {
    var b = B();
    if (b.esc) return b.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return 'h3_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function dt(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }

  /* ---------- 领域规则（与 server human3.rules.js 等价） ---------- */
  function readGrid(grid) {
    var out = {}, i, j;
    for (i = 0; i < Q.length; i++) {
      var q = Q[i], cells = [];
      for (j = 0; j < T.length; j++) {
        var v = grid && grid[q] && grid[q][T[j]];
        if (v === 1 || v === 2 || v === 3) cells.push(v);
      }
      out[q] = cells.length === 3 ? (cells[0] + cells[1] + cells[2]) / 3 : null;
    }
    return out;
  }
  function bottleneck(grid) {
    var r = readGrid(grid), order = ['body', 'mind', 'spirit', 'vocation'], best = null;
    for (var i = 0; i < order.length; i++) {
      var q = order[i];
      if (r[q] === null) continue;
      if (best === null || r[q] < r[best] - 1e-9) best = q;
    }
    return best;
  }
  function blockedBy(grid, target) {
    var r = readGrid(grid), blocked = null, support = null, text = '', src, k, u;
    if (!target || r[target] === null) return { blockedBy: null, supportFrom: null, chainText: '' };
    for (src in BLOCKS) {
      if (!Object.prototype.hasOwnProperty.call(BLOCKS, src)) continue;
      if (BLOCKS[src] === target && r[src] !== null && r[src] < r[target] - 0.34) { blocked = src; break; }
    }
    for (k = 0; k < UNLOCKS.length; k++) {
      u = UNLOCKS[k];
      if (u[1] !== target || r[u[0]] === null) continue;
      if (!support || r[u[0]] > r[support]) support = u[0];
    }
    if (blocked) text = BLOCK_TEXT[blocked + '_' + target] || '';
    else if (support) text = UNLOCK_TEXT[support + '_' + target] || '';
    return { blockedBy: blocked, supportFrom: support, chainText: text };
  }
  function inferPhase(answers) {
    var c = [0, 0, 0], i, v, best = 1;
    for (i = 0; i < 3; i++) {
      v = answers && answers[i];
      if (v === 1 || v === 2 || v === 3) c[v - 1]++;
    }
    /* 众数；平票取较低阶段，宁可判早，不判早熟 */
    for (i = 1; i < 3; i++) if (c[i] > c[best - 1]) best = i + 1;
    return best;
  }
  function traitBalance(grid, q) {
    var g = (grid && grid[q]) || {}, k = g.knowledge, e = g.experience, s = g.skill;
    if (!(k && e && s)) return null;
    if (k >= e + 1 && k >= s + 1) return { text: '知道得不少，但还没怎么用过', ask: '带我走一遍你每天怎么用它的？' };
    if (e >= k + 1 && e >= s + 1) return { text: '做过不少，但说不清什么时候有效', ask: '哪一次做成了？当时和别的时候有什么不同？' };
    if (s >= k + 1) return { text: '做得顺，但说不清背后的道理', ask: '换个场景，你会怎么改？' };
    return null;
  }
  function archetype(grid) {
    var r = readGrid(grid), arr = [], i;
    for (i = 0; i < Q.length; i++) if (r[Q[i]] !== null) arr.push({ q: Q[i], v: r[Q[i]] });
    if (arr.length < 4) return { key: '', label: '还没标完', caveat: CAVEAT };
    arr.sort(function (a, b) { return a.v - b.v || Q.indexOf(a.q) - Q.indexOf(b.q); });
    var low = arr[0].q, high = arr[3].q;
    var TABLE = {
      mind_body: '先把日子过稳，再谈想明白', body_mind: '身子先动起来，思路跟着松',
      mind_spirit: '想得清楚，也在学着靠近人', spirit_mind: '有人同行，才敢多想一步',
      mind_vocation: '从想清楚到做出来', vocation_mind: '在做事里把问题想透',
      body_spirit: '力气回来了，连接才有余地', spirit_body: '被人接住，才顾得上自己',
      body_vocation: '把作息稳住，手上的事才推得动', vocation_body: '事情在推进，身体别掉队',
      spirit_vocation: '从关系里长出去向', vocation_spirit: '做事的路上重新学会相处'
    };
    var key = low + '_' + high;
    return { key: key, label: TABLE[key] || '四块都在慢慢长', caveat: CAVEAT };
  }
  function makeDose(o) {
    var b = o.bottleneck || 'body';
    var ph = (o.phases && o.phases[b]) || 1;
    var tpl = DOSE[b][ph - 1] || DOSE[b][0];
    var sup = (o.support_from && o.support_from !== b) ? o.support_from : null;
    if (!sup) {
      for (var i = 0; i < Q.length; i++) if (Q[i] !== b) { sup = Q[i]; break; }
    }
    var start = o.start_at || Date.now();
    return {
      action: tpl[0], minutes: tpl[1],
      support_from: sup, support: SUPPORT[sup],
      start_at: start,
      check_at: start + 7 * 86400000,
      review_at: start + 90 * 86400000,
      experiment_id: null
    };
  }
  function filled(grid) {
    var n = 0;
    for (var i = 0; i < Q.length; i++) for (var j = 0; j < T.length; j++) {
      var v = grid && grid[Q[i]] && grid[Q[i]][T[j]];
      if (v === 1 || v === 2 || v === 3) n++;
    }
    return n;
  }

  /* ---------- 数据结构 ---------- */
  function defaultDB() {
    return { schema: 1, current: null, assessments: [] };
  }
  function blankAssessment() {
    var a = {
      id: uid(), created_at: Date.now(), updated_at: Date.now(),
      grid: {}, phaseSelf: {}, behaviors: [null, null, null],
      levels: {}, phases: {}, notes: {},
      bottleneck: null, blocked_by: null, support_from: null,
      archetype: '', archetype_label: '', dose: null, status: 'draft'
    };
    for (var i = 0; i < Q.length; i++) {
      var q = Q[i];
      a.grid[q] = { knowledge: null, experience: null, skill: null };
      a.phaseSelf[q] = 1;
      a.notes[q] = { present: '', stuck: '', want: '' };
    }
    return a;
  }
  function normalize(a) {
    if (!a || typeof a !== 'object') return blankAssessment();
    for (var i = 0; i < Q.length; i++) {
      var q = Q[i];
      a.grid = a.grid || {}; a.grid[q] = a.grid[q] || {};
      for (var j = 0; j < T.length; j++) {
        var v = a.grid[q][T[j]];
        if (!(v === 1 || v === 2 || v === 3)) a.grid[q][T[j]] = null;
      }
      a.phaseSelf = a.phaseSelf || {};
      if (!(a.phaseSelf[q] === 1 || a.phaseSelf[q] === 2 || a.phaseSelf[q] === 3)) a.phaseSelf[q] = 1;
      a.notes = a.notes || {}; a.notes[q] = a.notes[q] || {};
      for (var k = 0; k < NOTES.length; k++) {
        a.notes[q][NOTES[k].k] = String(a.notes[q][NOTES[k].k] || '').slice(0, 40);
      }
    }
    if (!Array.isArray(a.behaviors) || a.behaviors.length !== 3) a.behaviors = [null, null, null];
    a.levels = a.levels || {}; a.phases = a.phases || {};
    return a;
  }
  function ensure() {
    var d = db(); if (!d) return null;
    if (!d.human3 || typeof d.human3 !== 'object') d.human3 = defaultDB();
    var h = d.human3;
    if (!Array.isArray(h.assessments)) h.assessments = [];
    for (var i = 0; i < h.assessments.length; i++) h.assessments[i] = normalize(h.assessments[i]);
    var cur = null;
    for (i = 0; i < h.assessments.length; i++) if (h.assessments[i].id === h.current) cur = h.assessments[i];
    if (!cur) {
      if (!h.assessments.length) h.assessments.push(blankAssessment());
      cur = h.assessments[h.assessments.length - 1];
      h.current = cur.id;
      save();
    }
    return h;
  }
  function current() {
    var h = ensure(); if (!h) return null;
    for (var i = 0; i < h.assessments.length; i++) if (h.assessments[i].id === h.current) return h.assessments[i];
    return null;
  }
  function recalc(a) {
    var r = readGrid(a.grid), g = inferPhase(a.behaviors), i, q;
    for (i = 0; i < Q.length; i++) {
      q = Q[i];
      /* levels 只用于内部推导，不展示、不写成等级标签 */
      a.levels[q] = r[q] === null ? 1 : (r[q] < 1.7 ? 1 : (r[q] < 2.5 ? 2 : 3));
      a.phases[q] = Math.min(g, a.phaseSelf[q] || 1);
    }
    a.bottleneck = bottleneck(a.grid);
    var chain = blockedBy(a.grid, a.bottleneck);
    a.blocked_by = chain.blockedBy;
    a.support_from = chain.supportFrom;
    a.chain_text = chain.chainText;
    var ar = archetype(a.grid);
    a.archetype = ar.key;
    a.archetype_label = ar.label;
    if (filled(a.grid) === 12) {
      var keep = a.dose && a.dose.experiment_id ? a.dose.experiment_id : null;
      a.dose = makeDose({ bottleneck: a.bottleneck, phases: a.phases, support_from: a.support_from });
      a.dose.experiment_id = keep;
      a.status = keep ? 'dosed' : 'report';
    } else {
      a.dose = null; a.status = 'draft';
    }
    a.updated_at = Date.now();
    return a;
  }

  /* ---------- 3D 数据通道 ---------- */
  /* 把象限专属文案一起推给 3D 蛛网：聚焦面板显示的必须是用户刚才答过的那句话 */
  function modelExtras() {
    var choices = {}, prompts = {}, notes = {}, self = {}, qi, ti;
    for (qi = 0; qi < Q.length; qi++) {
      var q = Q[qi];
      choices[q] = {}; prompts[q] = {};
      for (ti = 0; ti < T.length; ti++) {
        var t = T[ti], pr = promptOf(q, t);
        choices[q][t] = choiceOf(q, t);
        prompts[q][t] = pr.q;
      }
      notes[q] = QNOTES[q]; self[q] = QSELF[q];
    }
    return { choices: choices, prompts: prompts, notes: notes, self: self,
      subtitles: QSUB, colors: QCOLOR, traitLabels: TL, labels: QL };
  }
  function model(a) {
    a = a || current();
    if (!a) return null;
    var demo = filled(a.grid) === 0;
    if (demo) {
      var g = {
        mind: { knowledge: 2, experience: 1, skill: 2 },
        body: { knowledge: 3, experience: 1, skill: 1 },
        spirit: { knowledge: 2, experience: 2, skill: 1 },
        vocation: { knowledge: 1, experience: 1, skill: 2 }
      };
      return {
        schema: 1, demo: true, grid: g,
        phases: { mind: 2, body: 1, spirit: 2, vocation: 1 },
        levels: { mind: 2, body: 1, spirit: 2, vocation: 1 },
        bottleneck: 'vocation', blocked_by: 'mind', support_from: 'body',
        labels: QL, colors: QCOLOR, traitLabels: TL,
        extras: modelExtras()
      };
    }
    return {
      schema: 1, demo: false, grid: a.grid,
      phases: a.phases, levels: a.levels,
      bottleneck: a.bottleneck, blocked_by: a.blocked_by,
      support_from: a.support_from, archetype_label: a.archetype_label,
      dose: a.dose ? { action: a.dose.action, support: a.dose.support } : null,
      labels: QL, colors: QCOLOR, traitLabels: TL,
      extras: modelExtras()
    };
  }
  function pushFrame() {
    var f = document.getElementById('h3-frame');
    if (!f || !f.contentWindow) return;
    try { f.contentWindow.postMessage({ type: 'h3:data', payload: model() }, '*'); } catch (e) { /* 跨域/未就绪时静默 */ }
  }
  function frameCmd(cmd) {
    var f = document.getElementById('h3-frame');
    if (!f || !f.contentWindow) return;
    try { f.contentWindow.postMessage({ type: 'h3:cmd', cmd: cmd }, '*'); } catch (e) { /* 忽略 */ }
  }

  /* ---------- 报告 / 罗盘 ---------- */
  function compassHtml(a) {
    var r = readGrid(a.grid), s = '<div class="h3-compass" id="h3-compass">';
    s += '<div class="h3-compass-ring"></div><div class="h3-compass-core">此刻</div>';
    for (var i = 0; i < Q.length; i++) {
      var q = Q[i], v = r[q];
      var len = v === null ? 10 : (18 + (v - 1) * 26);
      s += '<div class="h3-spoke h3-spoke-' + q + '" style="--len:' + len.toFixed(0) + 'px;--c:' + QCOLOR[q] + '">' +
        '<i></i><span>' + QL[q] + '</span></div>';
    }
    s += '</div>';
    return s;
  }
  function progressHtml(a) {
    var n = filled(a.grid);
    return '<div class="h3-progress" id="h3-progress">' +
      '<div class="h3-progress-bar"><i style="width:' + (n / 12 * 100).toFixed(1) + '%"></i></div>' +
      '<span class="tiny dim">' + (n === 12 ? '12 格都标好了' : '还差 ' + (12 - n) + ' 格') + ' · 你自己标的，随时可以改</span>' +
      '</div>';
  }
  function reportHtml(a) {
    var h = '<div class="h3-report-head"><span class="step-label">你的坐标报告</span>' +
      '<span class="tiny dim">自评，不是测评</span></div>';
    if (filled(a.grid) < 12) {
      h += '<div class="h3-empty"><b>还差 ' + (12 - filled(a.grid)) + ' 格</b>' +
        '<p class="small mt8">把 12 格标完，才会给出「最费劲的那一块」和一件下周能做的小事。不标完也没关系，草稿一直留在本机。</p></div>';
      return h;
    }
    var bq = a.bottleneck, bal = traitBalance(a.grid, bq);
    h += '<div class="h3-report-main">';
    h += '<div class="h3-find"><span class="tiny dim">最费劲的那一块</span>' +
      '<b style="color:' + QCOLOR[bq] + '">' + QL[bq] + '</b>' +
      '<p class="small">' + esc(QSUB[bq]) + '</p></div>';
    h += '<div class="h3-chain"><span class="tiny dim">' + (a.blocked_by ? '可能是被它拖住的' : '可以借点力的是') + '</span>' +
      '<b>' + QL[a.blocked_by || a.support_from || bq] + (a.blocked_by ? ' → ' + QL[bq] : ' → ' + QL[bq]) + '</b>' +
      '<p class="small">' + esc(a.chain_text || '先照顾最费劲的那一块就好。') + '</p></div>';
    h += '</div>';
    if (bal) {
      h += '<div class="h3-ask"><span class="tiny dim">这一格有点偏</span><p class="small">' +
        esc(bal.text) + '。<em>' + esc(bal.ask) + '</em></p></div>';
    }
    h += '<div class="h3-arch"><span class="tiny dim">参考画像</span>' +
      '<div class="h3-arch-row"><input id="h3-arch-input" data-h3-arch="1" maxlength="30" value="' + esc(a.archetype_label) + '" aria-label="参考画像，可修改">' +
      '<span class="tiny dim">' + esc(CAVEAT) + '</span></div></div>';

    if (a.dose) {
      h += '<div class="h3-dose"><div class="h3-dose-head"><span class="step-label">最小有效剂量</span>' +
        '<span class="tiny dim">先做这一件，不用平均用力</span></div>';
      h += '<div class="h3-dose-item"><i></i><div><b>' + esc(a.dose.action) + '</b>' +
        '<span class="tiny dim">每天约 ' + a.dose.minutes + ' 分钟 · 今天就能做第一步</span></div></div>';
      h += '<div class="h3-dose-item support"><i></i><div><b>' + esc(a.dose.support) + '</b>' +
        '<span class="tiny dim">从' + QL[a.dose.support_from] + '借来的支撑动作</span></div></div>';
      h += '<div class="h3-dose-meta tiny dim">7 天小复查 ' + dt(a.dose.check_at) + ' · 90 天复查 ' + dt(a.dose.review_at) + '</div>';
      h += '<div class="h3-dose-btns">';
      if (a.dose.experiment_id) {
        h += '<button class="btn quiet" data-act="h3:openexp">已放进这周的小实验 ✓</button>';
      } else {
        h += '<button class="btn primary" data-act="h3:exp">放进这周的小实验 →</button>';
      }
      h += '<button class="btn quiet" data-act="h3:refine">让做法更贴合我写的</button>';
      h += '</div><p class="tiny dim mt8" id="h3-refine-note"></p></div>';
    }
    return h;
  }

  /* ---------- 视图 ---------- */
  function cardHtml(a, q) {
    var s = '<div class="card soft h3-card" data-q="' + q + '">';
    s += '<div class="h3-card-head"><span class="h3-card-dot" style="background:' + QCOLOR[q] + '"></span>' +
      '<div><h3>' + QL[q] + '</h3><span class="tiny dim">' + esc(QSUB[q]) + '</span></div></div>';
    for (var j = 0; j < T.length; j++) {
      var t = T[j], pr = promptOf(q, t), opts = choiceOf(q, t);
      s += '<div class="h3-trait"><div class="h3-trait-q"><b>' + TL[t] + '</b><span class="tiny dim">' + esc(pr.q) + '</span></div>' +
        '<div class="h3-opts" role="radiogroup" aria-label="' + QL[q] + TL[t] + '">';
      for (var v = 1; v <= 3; v++) {
        var on = a.grid[q][t] === v;
        s += '<button type="button" class="h3-opt' + (on ? ' on' : '') + '" data-h3-cell="1" data-act="h3:cell" data-q="' + q + '" data-t="' + t + '" data-v="' + v + '" aria-pressed="' + on + '">' +
          '<i></i><span>' + esc(opts[v - 1]) + '</span></button>';
      }
      s += '</div></div>';
    }
    s += '<div class="h3-notes">';
    for (var k = 0; k < NOTES.length; k++) {
      var n = NOTES[k], lab = (QNOTES[q] && QNOTES[q][k]) || n.l;
      s += '<label class="h3-note"><span>' + esc(lab) + '</span>' +
        '<input type="text" maxlength="40" data-h3-note="1" data-q="' + q + '" data-k="' + n.k + '" value="' + esc(a.notes[q][n.k]) + '" placeholder="选填，40 字内"></label>';
    }
    s += '</div>';
    s += '<div class="h3-self"><span class="tiny dim">这一块现在更像</span><div class="h3-self-opts">';
    var states = QSELF[q] || QSELF.mind;
    for (var p = 1; p <= 3; p++) {
      s += '<button type="button" class="h3-chip' + (a.phaseSelf[q] === p ? ' on' : '') + '" data-h3-phase="1" data-act="h3:phase" data-q="' + q + '" data-v="' + p + '">' +
        esc(states[p - 1]) + '</button>';
    }
    s += '</div></div></div>';
    return s;
  }
  function behaviorHtml(a) {
    var s = '<div class="card soft h3-behavior"><div class="h3-report-head"><span class="step-label">再问三件只关于事实的事</span>' +
      '<span class="tiny dim">用来判断现在走到哪一步，不问态度</span></div>';
    for (var i = 0; i < BEHAVIOR_Q.length; i++) {
      var b = BEHAVIOR_Q[i];
      s += '<div class="h3-bq"><p class="small">' + (i + 1) + '. ' + esc(b.q) + '</p><div class="h3-bq-opts">';
      for (var v = 1; v <= 3; v++) {
        s += '<button type="button" class="h3-chip' + (a.behaviors[i] === v ? ' on' : '') + '" data-h3-behavior="1" data-act="h3:behavior" data-i="' + i + '" data-v="' + v + '">' + esc(b.o[v - 1]) + '</button>';
      }
      s += '</div></div>';
    }
    var g = inferPhase(a.behaviors);
    s += '<p class="tiny dim mt8">当前读到的是「' + PHASE_LABEL[g] + '」这一段；平票时按较早的一段算，不急着往前判。</p></div>';
    return s;
  }
  /* 进这张地图时，让背景银河粒子的形态跟着「最费劲的那一块」走：
     particles.js 的四形态与四象限一一对应，静默切换不额外激起涟漪 */
  function syncParticles(a) {
    try {
      var P = window.INNERSCAPE_PARTICLES;
      if (!P || typeof P.setShape !== 'function') return;
      var idx = Q.indexOf(a.bottleneck);
      P.setShape(idx < 0 ? 0 : idx, true);
    } catch (e) { /* 粒子层不可用时不影响坐标功能 */ }
  }

  function render() {
    var a = recalc(current() || blankAssessment());
    syncParticles(a);
    var h = '';
    /* v10：这一页不再是主站里单独列出的「人生坐标」板块，
       而是 3D 实验室的 12 格自评页；顶部直接给回到实验室的入口。 */
    h += '<div class="topbar"><div class="brand"><span class="dot"></span>卡点 · 12 格自评</div>' +
      '<div><a class="btn quiet" href="lab/hand3d.html?mode=web">去 3D 实验室 ↗</a>' +
      '<button class="ghost" data-act="nav" data-to="landing">← 回到开头</button></div></div>';

    h += '<div class="h3-hero card soft reveal">';
    h += '<div class="eyebrow"><i></i>3D 实验室 · 标准四象限坐标图</div>';
    h += '<h1 class="mt12">把你此刻的样子，<br>标进坐标里。</h1>';
    h += '<p class="hero-sub mt12">心智 / 身体 / 精神 / 使命，各标三格。12 个读数会在 3D 实验室里拼成' +
      '一张标准笛卡尔四象限统计图——每个点落在哪、哪一块还空着，都由你刚才标的决定。这是自评坐标，不是测评。</p>';
    h += '<div class="h3-stage"><iframe id="h3-frame" src="lab/human3d.html?embed=1" title="标准四象限坐标统计图 3D 视图" loading="lazy" allow="camera"></iframe>' +
      '<div class="h3-stage-fallback">正在拼坐标图…</div></div>';
    h += '<div class="h3-stage-bar">';
    h += '<span class="tiny dim">横轴 个人 ↔ 集体 · 纵轴 外在 ↔ 内在 · 点某一块看这三格 · 实验室里还能用手势</span>';
    h += '<div><button class="btn quiet" data-act="h3:frame" data-v="spin">转 / 停</button>' +
      '<button class="btn quiet" data-act="h3:frame" data-v="reset">复位</button>' +
      '<a class="btn quiet" href="lab/hand3d.html?mode=web">进入 3D 实验室 ↗</a></div>';
    h += '</div>';
    h += compassHtml(a);
    h += progressHtml(a);
    h += '</div>';

    h += '<div class="h3-lede mt28"><span class="step-label">12 格 · 每个象限问自己的事</span>' +
      '<span class="tiny dim">心智问拆问题 / 身体问节奏 / 精神问相处 / 使命问交付 · 三档都是「没动过 → 做过没稳 → 不费力」</span></div>';
    h += '<div class="h3-grid mt12">';
    for (var i = 0; i < Q.length; i++) h += cardHtml(a, Q[i]);
    h += '</div>';
    h += behaviorHtml(a);
    h += '<div class="card soft h3-report mt20" id="h3-report">' + reportHtml(a) + '</div>';

    h += '<div class="card flat mt20 h3-dist">';
    h += '<div class="h3-report-head"><span class="step-label">看看别人标在哪</span>' +
      '<span class="tiny dim">只有你点「加入」才会上传结构化坐标，不传任何文字</span></div>';
    h += '<div id="h3-dist-body" class="tiny dim">默认不上传。点一下才会向本地后端请求匿名分布。</div>';
    h += '<div class="btn-row mt12"><button class="btn quiet" data-act="h3:dist">刷新分布</button>' +
      '<button class="btn quiet" data-act="h3:join">加入匿名分布</button></div>';
    h += '</div>';

    h += '<div class="h3-foot mt28"><p class="tiny dim">' + esc(CAVEAT) + ' 这里不打分、不排等级、不做心理或医学判断；' +
      '所有读数只用来把「我过得不好」拆成可以逐项处理的一张单子。</p>' +
      '<div class="btn-row mt12"><button class="btn quiet" data-act="h3:new">重新标一次</button>' +
      '<button class="linkbtn muted-link" data-act="h3:reset">清空当前坐标</button></div></div>';
    return h;
  }

  /* ---------- 局部刷新（不重建 iframe，不抢输入焦点） ---------- */
  function refresh() {
    var a = current(); if (!a) return;
    recalc(a); save();
    var rep = document.getElementById('h3-report');
    if (rep) rep.innerHTML = reportHtml(a);
    var pr = document.getElementById('h3-progress');
    if (pr) pr.outerHTML = progressHtml(a);
    var cp = document.getElementById('h3-compass');
    if (cp) cp.outerHTML = compassHtml(a);
    var cells = document.querySelectorAll('[data-h3-cell]');
    for (var i = 0; i < cells.length; i++) {
      var d = cells[i].dataset;
      var on = a.grid[d.q] && a.grid[d.q][d.t] === Number(d.v);
      cells[i].className = 'h3-opt' + (on ? ' on' : '');
      cells[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var phases = document.querySelectorAll('[data-h3-phase]');
    for (i = 0; i < phases.length; i++) {
      phases[i].className = 'h3-chip' + (a.phaseSelf[phases[i].dataset.q] === Number(phases[i].dataset.v) ? ' on' : '');
    }
    var bh = document.querySelectorAll('[data-h3-behavior]');
    for (i = 0; i < bh.length; i++) {
      bh[i].className = 'h3-chip' + (a.behaviors[Number(bh[i].dataset.i)] === Number(bh[i].dataset.v) ? ' on' : '');
    }
    pushFrame();
  }

  /* ---------- 动作分发 ---------- */
  function addAssessment() {
    var h = ensure(); if (!h) return;
    var a = blankAssessment();
    h.assessments.push(a);
    /* 上限 12：优先淘汰未建实验的旧草稿 */
    while (h.assessments.length > 12) {
      var cut = -1;
      for (var i = 0; i < h.assessments.length - 1; i++) {
        if (!h.assessments[i].dose || !h.assessments[i].dose.experiment_id) { cut = i; break; }
      }
      h.assessments.splice(cut >= 0 ? cut : 0, 1);
    }
    h.current = a.id; save();
  }
  function createExperiment(a) {
    var b = B();
    if (!b.human3Experiment) { notice('本机实验模块还没就绪'); return; }
    var id = b.human3Experiment(a.dose.action, a.dose.support, a.dose.minutes);
    if (!id) { notice('没有建成实验，坐标已保留'); return; }
    a.dose.experiment_id = id; a.status = 'dosed'; save();
    notice('已放进这周的小实验，随时可以回去记一次');
    if (b.track) b.track('human3_dose_to_experiment', { quadrant: a.bottleneck });
    refresh();
  }
  function refine(a) {
    var api = window.INNERSPACE_API;
    var note = document.getElementById('h3-refine-note');
    if (!api || !api.isEnabled || !api.isEnabled() || !api.human3) {
      if (note) note.textContent = '当前是纯离线模式，已经用的是规则引擎给的做法。';
      return;
    }
    var free = [];
    for (var i = 0; i < Q.length; i++) {
      var n = a.notes[Q[i]];
      for (var k = 0; k < NOTES.length; k++) if (n[NOTES[k].k]) free.push(n[NOTES[k].k]);
    }
    if (note) note.textContent = '正在整理…';
    api.human3.actions({
      free_text: free.join('；').slice(0, 480),
      bottleneck: a.bottleneck,
      phase: a.phases[a.bottleneck] || 1,
      dose: a.dose.action,
      support: a.dose.support
    }).then(function (d) {
      var items = (d && d.items) || [];
      if (!items.length) { if (note) note.textContent = '没有生成新做法，保留原来这一条。'; return; }
      a.dose.action = items[0].d;
      if (items[1]) a.dose.support = items[1].d;
      save(); refresh();
      var nn = document.getElementById('h3-refine-note');
      if (nn) nn.textContent = '已按你写的话改过，随时可以继续改回去。';
    }).catch(function () {
      var nn = document.getElementById('h3-refine-note');
      if (nn) nn.textContent = '模型没接上，已经用的是规则引擎给的做法。';
    });
  }
  function showDist() {
    var box = document.getElementById('h3-dist-body');
    if (!box) return;
    var api = window.INNERSPACE_API;
    if (!api || !api.isEnabled || !api.isEnabled() || !api.human3) {
      box.innerHTML = '当前是纯离线模式，没有可看的分布。你的坐标仍然只在这台设备上。';
      return;
    }
    box.textContent = '正在读取…';
    api.human3.distribution().then(function (d) {
      var el = document.getElementById('h3-dist-body'); if (!el) return;
      if (!d || !d.available) { el.textContent = d && d.reason ? d.reason : '样本还太少，暂时不展示分布（避免对上号）。'; return; }
      var s = '<div class="h3-dist-bars">';
      for (var i = 0; i < Q.length; i++) {
        var q = Q[i], n = Number(d.quadrants && d.quadrants[q] || 0);
        var w = d.total ? Math.round(n / d.total * 100) : 0;
        s += '<div class="h3-dist-row"><span>' + QL[q] + '</span>' +
          '<div class="h3-dist-track"><i style="width:' + w + '%;background:' + QCOLOR[q] + '"></i></div>' +
          '<b>' + n + '</b></div>';
      }
      s += '</div><p class="tiny dim mt8">共 ' + d.total + ' 份匿名坐标 · 只统计「最费劲的那一块」，不含任何文字或个人标识。</p>';
      el.innerHTML = s;
    }).catch(function () {
      var el = document.getElementById('h3-dist-body'); if (el) el.textContent = '没读到分布，本机坐标不受影响。';
    });
  }
  function joinDist() {
    var api = window.INNERSPACE_API;
    var box = document.getElementById('h3-dist-body');
    if (!api || !api.isEnabled || !api.isEnabled() || !api.human3) {
      if (box) box.textContent = '需要先在右下角「云同步」里登录，才会上传匿名坐标。';
      return;
    }
    var a = current(); if (!a || filled(a.grid) < 12) { notice('先把 12 格标完'); return; }
    var r = readGrid(a.grid);
    api.human3.submitAssessment({
      id: a.id, bottleneck: a.bottleneck, blocked_by: a.blocked_by,
      phases: a.phases, grid: a.grid, created_at: a.created_at
    }).then(function () { if (box) box.textContent = '已加入匿名分布，谢谢。文字一个字都没上传。'; showDist(); })
      .catch(function (e) { if (box) box.textContent = '没能加入：' + esc(e && e.message || '稍后再试'); });
  }

  function action(act, d) {
    var a = current(); if (!a && act !== 'reset') return;
    switch (act) {
      case 'cell':
        if (a.grid[d.q] && T.indexOf(d.t) >= 0) { a.grid[d.q][d.t] = Number(d.v) || null; refresh(); }
        break;
      case 'phase':
        a.phaseSelf[d.q] = Number(d.v) || 1; refresh(); break;
      case 'behavior':
        a.behaviors[Number(d.i)] = Number(d.v) || null; refresh(); break;
      case 'frame': frameCmd(d.v || 'spin'); break;
      case 'exp': if (a.dose) createExperiment(a); break;
      case 'openexp': navigate('experiment'); break;
      case 'refine': if (a.dose) refine(a); break;
      case 'new': addAssessment(); redraw(); notice('新的一张坐标，旧的那份还在'); break;
      case 'reset':
        if (!window.confirm('清空当前这张坐标？其它记录和已建的实验不会动。')) return;
        { var h = ensure(); if (h) { h.assessments = h.assessments.filter(function (x) { return x.id !== h.current; }); h.current = null; save(); } }
        redraw(); break;
      case 'dist': showDist(); break;
      case 'join': joinDist(); break;
      case 'navmap': navigate('map'); break;
      case 'remind': {
        var d0 = db();
        if (d0 && d.key) {
          d0.remind = d0.remind || {};
          d0.remind[d.key] = Date.now();
          save(); redraw();
        }
        break;
      }
    }
  }

  /* ---------- 输入委托 ---------- */
  function onInput(ev) {
    var el = ev.target;
    if (!el || !el.dataset) return;
    var a = current(); if (!a) return;
    if (el.dataset.h3Note) {
      var q = el.dataset.q, k = el.dataset.k;
      if (a.notes[q]) { a.notes[q][k] = String(el.value || '').slice(0, 40); saveSoon(); }
    } else if (el.dataset.h3Arch) {
      a.archetype_label = String(el.value || '').slice(0, 30); saveSoon();
    }
  }
  var _timer = null;
  function saveSoon() {
    if (_timer) return;
    _timer = setTimeout(function () { _timer = null; save(); }, 150);
  }

  /* ---------- iframe 请求数据 ---------- */
  function onMessage(ev) {
    var m = ev && ev.data;
    if (!m || m.type !== 'h3:request-data') return;
    pushFrame();
  }

  document.addEventListener('input', onInput, false);
  document.addEventListener('change', onInput, false);
  window.addEventListener('message', onMessage, false);
  /* iframe 加载完成后再推一次，避免早于监听器注册 */
  window.addEventListener('load', function () { setTimeout(pushFrame, 60); setTimeout(pushFrame, 420); }, false);

  window.HUMAN3 = {
    QUADRANTS: Q, TRAITS: T, LABELS: QL,
    QPROMPT: QPROMPT, QNOTES: QNOTES, QSELF: QSELF,
    promptOf: promptOf, choiceOf: choiceOf, modelExtras: modelExtras,
    defaultDB: defaultDB, normalize: normalize,
    readGrid: readGrid, bottleneck: bottleneck, blockedBy: blockedBy,
    inferPhase: inferPhase, traitBalance: traitBalance, archetype: archetype,
    makeDose: makeDose, filled: filled,
    ensure: ensure, current: current, recalc: recalc, model: model,
    render: render, action: action, refresh: refresh, pushFrame: pushFrame
  };
})();
