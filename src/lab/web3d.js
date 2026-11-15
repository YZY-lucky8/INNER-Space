/* =========================================================
   web3d.js —— 人生坐标 · 标准四象限统计图（共享渲染器）
   ---------------------------------------------------------
   v10：从「12 轴粒子蛛网」改为「标准笛卡尔四象限统计图」。
   · x 轴 个人 ← → 集体，y 轴 外在 ← → 内在；
     象限 I 精神 / II 心智 / III 身体 / IV 使命（标准数学象限编号）。
   · 图纸骨架（均匀方格 / 次格线 / 十字主轴与箭头 / 1–3 刻度 /
     轴标题 / 象限编号 / 四角括号 / 图注）由 CanvasTexture 精确绘制，
     与 group 一起 billboard 正对相机，刻度文字永不变形。
   · 数据全部由 THREE.Points 粒子拼接：12 个读数 → 4 组折线 +
     数据点簇 + 折线下方的面积点阵；未标的格留虚位。
   · 保留 WEB 对外 API 契约，两个宿主（hand3d / human3d）与手势管线不破。
   · 普通 script + 全局 THREE，零外部依赖，file:// 可用；只读个人数据。
   · 不显示总分、百分比、等级：读数只映射成坐标位置与粒子密度。
   ========================================================= */
(function () {
  'use strict';

  var Q = ['mind', 'body', 'spirit', 'vocation'];
  var T = ['knowledge', 'experience', 'skill'];
  var QL = { mind: '心智', body: '身体', spirit: '精神', vocation: '使命' };
  var TL = { knowledge: '知识', experience: '经验', skill: '技能' };
  var QSUB = {
    mind: '象限 II · 个人·内在　想清楚事情的能力',
    body: '象限 III · 个人·外在　身体与日常节奏',
    spirit: '象限 I · 集体·内在　与人的连接',
    vocation: '象限 IV · 集体·外在　在做的事与去向'
  };
  var HEX = { mind: 0x9ff0ce, body: 0x7fd8c0, spirit: 0xb9e6ff, vocation: 0xe8cf92 };
  /* 每个象限在标准笛卡尔坐标里的位置、罗马编号、标签锚点 */
  var QPOS = {
    mind:     { sx: -1, sy:  1, num: 'II',  nx: -2.12, ny:  2.86 },
    body:     { sx: -1, sy: -1, num: 'III', nx: -2.12, ny: -2.86 },
    spirit:   { sx:  1, sy:  1, num: 'I',   nx:  2.12, ny:  2.86 },
    vocation: { sx:  1, sy: -1, num: 'IV',  nx:  2.12, ny: -2.86 }
  };
  var FALLBACK_CHOICE = {
    knowledge: ['只记得别人怎么说', '能说个大概', '能讲给别人听'],
    experience: ['没怎么动过', '试过一两次', '一直在做'],
    skill: ['每次都要重新想', '顺的时候还行', '基本不费力']
  };
  var R = 3.0;                 /* 1 档 = 1 个世界单位，刻度 1 / 2 / 3 */
  var TAU = Math.PI * 2;
  var XS_LEFT = [-2.55, -1.75, -0.95], XS_RIGHT = [0.95, 1.75, 2.55];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hex2css(h) { return '#' + h.toString(16).padStart(6, '0'); }

  /* 问卷措辞优先取主站的 human3.js（同一份表，不重复维护）。 */
  function extras() {
    try {
      if (window.HUMAN3 && typeof window.HUMAN3.modelExtras === 'function') {
        return window.HUMAN3.modelExtras();
      }
    } catch (e) { /* 忽略 */ }
    var ch = {}, pr = {}, q, t;
    for (q = 0; q < 4; q++) {
      ch[Q[q]] = {}; pr[Q[q]] = {};
      for (t = 0; t < 3; t++) {
        ch[Q[q]][T[t]] = FALLBACK_CHOICE[T[t]];
        pr[Q[q]][T[t]] = TL[T[t]] + '这一格';
      }
    }
    return { choices: ch, prompts: pr, subtitles: QSUB, colors: {}, traitLabels: TL, labels: QL };
  }

  /* 独立打开实验室时，草稿可能还没被主站 recalc 过：本地按同一套确定性规则
     补出瓶颈 / 阻塞 / 借力，保证图上两条链照样画得出来。 */
  function derive(grid) {
    var r = {}, i, j, q, cells, v;
    for (i = 0; i < 4; i++) {
      q = Q[i]; cells = [];
      for (j = 0; j < 3; j++) {
        v = grid[q] && grid[q][T[j]];
        if (v === 1 || v === 2 || v === 3) cells.push(v);
      }
      r[q] = cells.length === 3 ? (cells[0] + cells[1] + cells[2]) / 3 : null;
    }
    var order = ['body', 'mind', 'spirit', 'vocation'], best = null;
    for (i = 0; i < 4; i++) {
      q = order[i];
      if (r[q] === null) continue;
      if (best === null || r[q] < r[best] - 1e-9) best = q;
    }
    if (!best) return { bottleneck: null, blocked_by: null, support_from: null };
    var BLOCKS = { body: 'spirit', mind: 'vocation', spirit: 'mind', vocation: 'body' };
    var UNLOCKS = [['body', 'spirit'], ['body', 'mind'], ['mind', 'vocation'],
      ['mind', 'spirit'], ['vocation', 'body'], ['spirit', 'mind']];
    var blocked = null, support = null;
    for (q in BLOCKS) {
      if (BLOCKS[q] === best && r[q] !== null && r[q] < r[best] - 0.34) { blocked = q; break; }
    }
    for (i = 0; i < UNLOCKS.length; i++) {
      var u = UNLOCKS[i];
      if (u[1] !== best || r[u[0]] === null) continue;
      if (!support || r[u[0]] > r[support]) support = u[0];
    }
    return { bottleneck: best, blocked_by: blocked, support_from: support };
  }

  /* ---------- 从 localStorage 读一份坐标（独立打开实验室时用） ---------- */
  function localModel() {
    try {
      var raw = localStorage.getItem('kadian_db_v1');
      if (!raw) return null;
      var d = JSON.parse(raw);
      var h = d && d.human3;
      if (!h || !Array.isArray(h.assessments) || !h.assessments.length) return null;
      var a = null;
      for (var i = 0; i < h.assessments.length; i++) if (h.assessments[i].id === h.current) a = h.assessments[i];
      a = a || h.assessments[h.assessments.length - 1];
      if (!a || !a.grid) return null;
      var n = 0;
      for (var qi = 0; qi < 4; qi++) for (var ti = 0; ti < 3; ti++) {
        var v = a.grid[Q[qi]] && a.grid[Q[qi]][T[ti]];
        if (v === 1 || v === 2 || v === 3) n++;
      }
      if (!n) return null;
      var drv = derive(a.grid);
      return {
        schema: 1, demo: false, grid: a.grid,
        phases: a.phases || {}, levels: a.levels || {},
        bottleneck: a.bottleneck || drv.bottleneck,
        blocked_by: a.blocked_by || drv.blocked_by,
        support_from: a.support_from || drv.support_from,
        archetype_label: a.archetype_label || '',
        extras: extras()
      };
    } catch (e) { return null; }
  }
  function demoModel() {
    return {
      schema: 1, demo: true,
      grid: {
        mind: { knowledge: 2, experience: 1, skill: 2 },
        body: { knowledge: 3, experience: 1, skill: 1 },
        spirit: { knowledge: 2, experience: 2, skill: 1 },
        vocation: { knowledge: 1, experience: 1, skill: 2 }
      },
      phases: { mind: 2, body: 1, spirit: 2, vocation: 1 },
      bottleneck: 'vocation', blocked_by: 'mind', support_from: 'body',
      extras: extras()
    };
  }

  /* ---------- 标准笛卡尔统计图纸（CanvasTexture，随 group 一起 billboard） ----------
     世界坐标 [-3.8, 3.8] → canvas [0, S]；所有刻度、文字、发丝线都在这里精确绘制，
     保证这是一张「能当数学统计图读」的图纸，而不是一圈装饰性的蛛丝。 */
  function makeChartPaper(THREE) {
    var S = 1600, cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    var c = cv.getContext('2d');
    function X(v) { return (v + 3.8) / 7.6 * S; }
    function Y(v) { return (3.8 - v) / 7.6 * S; }
    var i, k, v, major;

    c.clearRect(0, 0, S, S);
    /* 图纸底色：中心极淡的一层墨绿，四周退到透明 */
    var bg = c.createRadialGradient(S * .5, S * .5, 0, S * .5, S * .5, S * .72);
    bg.addColorStop(0, 'rgba(16,46,35,.34)');
    bg.addColorStop(1, 'rgba(6,20,16,.04)');
    c.fillStyle = bg; c.fillRect(0, 0, S, S);

    /* 均匀方格：每 1 档一条主格线，每 0.5 档一条次格线 */
    for (k = -6; k <= 6; k++) {
      v = k * .5; major = (k % 2 === 0);
      c.strokeStyle = major ? 'rgba(191,230,211,.17)' : 'rgba(191,230,211,.055)';
      c.lineWidth = major ? 1.7 : 1;
      c.beginPath(); c.moveTo(X(v), Y(3.35)); c.lineTo(X(v), Y(-3.35)); c.stroke();
      c.beginPath(); c.moveTo(X(-3.35), Y(v)); c.lineTo(X(3.35), Y(v)); c.stroke();
    }

    /* 十字主轴 + 标准箭头 */
    c.strokeStyle = 'rgba(191,230,211,.50)'; c.lineWidth = 2.6;
    c.beginPath(); c.moveTo(X(-3.55), Y(0)); c.lineTo(X(3.55), Y(0)); c.stroke();
    c.beginPath(); c.moveTo(X(0), Y(-3.55)); c.lineTo(X(0), Y(3.55)); c.stroke();
    c.fillStyle = 'rgba(191,230,211,.66)';
    function arrow(px, py, dx, dy) {
      c.beginPath();
      c.moveTo(px + dx * 17, py + dy * 17);
      c.lineTo(px - dy * 7 - dx * 4, py + dx * 7 - dy * 4);
      c.lineTo(px + dy * 7 - dx * 4, py - dx * 7 - dy * 4);
      c.closePath(); c.fill();
    }
    arrow(X(3.55), Y(0), 1, 0);
    arrow(X(0), Y(3.55), 0, -1);

    /* 刻度短线 + 1 / 2 / 3 数字（标尺，不是个人得分） */
    c.font = '500 21px "IBM Plex Mono","SFMono-Regular",Menlo,Consolas,monospace';
    c.fillStyle = 'rgba(191,230,211,.66)';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (i = -3; i <= 3; i++) {
      if (i === 0) continue;
      c.strokeStyle = 'rgba(191,230,211,.52)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(X(i), Y(0) - 8); c.lineTo(X(i), Y(0) + 8); c.stroke();
      c.fillText(String(Math.abs(i)), X(i), Y(0) + 31);
      c.beginPath(); c.moveTo(X(0) - 8, Y(i)); c.lineTo(X(0) + 8, Y(i)); c.stroke();
      c.fillText(String(Math.abs(i)), X(0) - 30, Y(i));
    }
    c.font = 'italic 500 23px Georgia,serif';
    c.fillText('O', X(0) - 26, Y(0) + 25);

    /* 轴标题：把 Human 3.0 的两条分类轴写成数学轴名 */
    c.font = '600 22px "Songti SC","STSong","Noto Serif CJK SC","SimSun",serif';
    c.fillStyle = 'rgba(159,240,206,.80)';
    c.textAlign = 'left';  c.fillText('← 个人  PERSONAL', X(-3.32), Y(0) - 34);
    c.textAlign = 'right'; c.fillText('COLLECTIVE  集体 →', X(3.32), Y(0) - 34);
    c.textAlign = 'center';
    c.fillText('内在 INNER', X(0) + 108, Y(3.28) - 6);
    c.fillText('外在 OUTER', X(0) + 108, Y(-3.28) + 6);

    /* 标准数学象限编号 I / II / III / IV */
    c.font = '600 25px "IBM Plex Mono","SFMono-Regular",Menlo,Consolas,monospace';
    c.fillStyle = 'rgba(191,230,211,.40)';
    c.textAlign = 'right'; c.fillText('II',  X(-3.30), Y(3.28));
    c.textAlign = 'left';  c.fillText('I',   X(3.30),  Y(3.28));
    c.textAlign = 'right'; c.fillText('III', X(-3.30), Y(-3.28));
    c.textAlign = 'left';  c.fillText('IV',  X(3.30),  Y(-3.28));

    /* 四角括号：档案式发丝线，给统计图一个明确的画框 */
    var m = 26, L = 62;
    c.strokeStyle = 'rgba(159,240,206,.34)'; c.lineWidth = 2;
    [[m, m, 1, 1], [S - m, m, -1, 1], [m, S - m, 1, -1], [S - m, S - m, -1, -1]].forEach(function (p) {
      c.beginPath();
      c.moveTo(p[0] + p[2] * L, p[1]); c.lineTo(p[0], p[1]); c.lineTo(p[0], p[1] + p[3] * L);
      c.stroke();
    });

    /* 图注：顶部标题 / 底部口径 */
    c.font = '500 19px "IBM Plex Mono","SFMono-Regular",Menlo,Consolas,monospace';
    c.fillStyle = 'rgba(191,230,211,.52)';
    c.textAlign = 'left';   c.fillText('HUMAN 3.0 / FOUR-QUADRANT PLOT', 44, 48);
    c.textAlign = 'right';  c.fillText('SELF-MAPPED · NOT A TEST', S - 44, 48);
    c.font = '500 18px "Songti SC","STSong","Noto Serif CJK SC","SimSun",serif';
    c.fillStyle = 'rgba(191,230,211,.42)';
    c.textAlign = 'center';
    c.fillText('刻度 1 几乎没动过 · 2 做过但没稳 · 3 做起来不费力　｜　这是你自己标的坐标，不是结论，随时可以改', S / 2, S - 44);

    var tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  /* ---------- 创建统计图 ---------- */
  function create(opts) {
    var THREE = opts.THREE || window.THREE;
    var scene = opts.scene, camera = opts.camera;
    var lowEnd = !!opts.lowEnd;
    var group = new THREE.Group();
    scene.add(group);

    /* 图纸平面：在粒子层之后，随 group 一起 billboard */
    var paperTex = makeChartPaper(THREE);
    var paper = new THREE.Mesh(
      new THREE.PlaneGeometry(7.6, 7.6),
      new THREE.MeshBasicMaterial({ map: paperTex, transparent: true, opacity: .96,
        depthWrite: false, side: THREE.DoubleSide })
    );
    paper.position.z = -.10;
    paper.renderOrder = 0;
    group.add(paper);

    var P = [], CAP = 6000;
    var _col = new Float32Array(CAP * 3), _siz = new Float32Array(CAP),
        _alp = new Float32Array(CAP), _phs = new Float32Array(CAP), _aq = new Float32Array(CAP);
    var pos, col, siz, alp, phs, aq;
    var geo, mat, points;
    var Vcur = new Float32Array(12), Vtgt = new Float32Array(12);
    var DX = new Float32Array(12), DY = new Float32Array(12);
    var model = null, focusQ = -1, firstApply = true;
    var ex = extras();
    var chainFrom = -1, chainTo = -1, chainSup = -1, bottleneckQ = -1;

    function rgb(hex) { var c = new THREE.Color(hex); return [c.r, c.g, c.b]; }
    function add(k, a, u, v, q, hex, size, alpha, seed) {
      var c = rgb(hex === undefined ? 0x8fd8bc : hex), idx = P.length;
      P.push({ k: k, a: a, u: u, v: v, q: q, seed: seed || Math.random() * TAU });
      _col[idx * 3] = c[0]; _col[idx * 3 + 1] = c[1]; _col[idx * 3 + 2] = c[2];
      _siz[idx] = size; _alp[idx] = alpha;
      _aq[idx] = q === null || q === undefined ? -2 : q;
      _phs[idx] = Math.random() * TAU;
    }

    /* 0 · 图纸网格点阵：让「统计图本身」也由粒子参与，而非只有贴图 */
    var gk, gv, gn, gi, gu, gdir;
    for (gk = -6; gk <= 6; gk++) {
      gv = gk * .5; gn = (gk % 2 === 0) ? 52 : 26;
      for (gi = 0; gi < gn; gi++) {
        gu = -3.35 + (gi + .5) / gn * 6.70;
        var gc = (gk % 2 === 0) ? 0x8fc7ac : 0x6fae94;
        var ga = (gk % 2 === 0) ? .19 : .075;
        add(0, 0, gv, gu, -2, gc, (gk % 2 === 0) ? 1.00 : .72, ga);   /* 横线 */
        add(0, 1, gv, gu, -2, gc, (gk % 2 === 0) ? 1.00 : .72, ga);   /* 纵线 */
      }
    }
    /* 1 · 十字主轴上的亮粒子 */
    for (gi = 0; gi < 168; gi++) {
      gu = -3.5 + (gi + .5) / 168 * 7.0;
      add(1, 0, gu, 0, -2, 0xbfe6d3, 1.15, .30);
      add(1, 1, gu, 0, -2, 0xbfe6d3, 1.15, .30);
    }
    /* 2/3/4 · 数据：4 象限 × 2 段折线 + 12 个数据点簇 + 折线下方面积点阵 */
    var q, j, seg, u2, vv, nn;
    for (q = 0; q < 4; q++) {
      for (j = 0; j < 2; j++) {
        seg = q * 2 + j;
        for (nn = 0; nn < 46; nn++) {
          add(2, seg, (nn + .5) / 46, 0, q, HEX[Q[q]], 1.45, .72);
        }
        for (nn = 0; nn < 62; nn++) {
          add(4, seg, Math.random(), Math.random(), q, HEX[Q[q]],
              .70 + Math.random() * .55, .10);
        }
      }
      for (j = 0; j < 3; j++) {
        for (nn = 0; nn < 18; nn++) {
          var th = nn / 18 * TAU, rd = .045 + Math.random() * .115;
          add(3, q * 3 + j, th, rd, q, HEX[Q[q]], 1.10 + Math.random() * .7, .62);
        }
      }
    }
    /* 5 · 瓶颈象限的暗红脉冲环 */
    for (nn = 0; nn < 96; nn++) add(5, 0, nn / 96, 0, -2, 0xe08a8a, 1.30, .50);
    /* 6 · 阻塞链 / 解锁链：两条在象限之间流动的光点弧 */
    for (seg = 0; seg < 2; seg++) {
      for (nn = 0; nn < 54; nn++) add(6, seg, nn / 54, 0, -2,
        seg === 0 ? 0xe08a8a : 0xe8cf92, 1.35, .58);
    }
    /* 7 · 环境浮尘：把统计图托在深绿空间里 */
    var MOTES = lowEnd ? 240 : 420;
    for (nn = 0; nn < MOTES; nn++) {
      var th2 = Math.random() * TAU, rd2 = .6 + Math.random() * 4.6;
      add(7, 0, Math.cos(th2) * rd2, (Math.random() - .5) * 6.8, -2,
        0xbfe6d3, .65 + Math.random() * .8, .08 + Math.random() * .18);
      P[P.length - 1].z = -.22 - Math.random() * .5;
    }

    var N = P.length;
    pos = new Float32Array(N * 3);
    col = _col.slice(0, N * 3);
    siz = _siz.slice(0, N);
    alp = _alp.slice(0, N);
    phs = _phs.slice(0, N);
    aq = _aq.slice(0, N);

    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alp, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phs, 1));
    geo.setAttribute('aQ', new THREE.BufferAttribute(aq, 1));
    try { geo.attributes.position.setUsage(THREE.DynamicDrawUsage); } catch (e) { /* 老版本忽略 */ }
    try { geo.attributes.aAlpha.setUsage(THREE.DynamicDrawUsage); } catch (e) { /* 忽略 */ }

    mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uPixel: { value: 1 }, uTime: { value: 0 },
        uFocusQ: { value: -1 }, uBreath: { value: 0 }
      },
      vertexShader: [
        'attribute vec3 aColor;',
        'attribute float aSize; attribute float aAlpha; attribute float aPhase; attribute float aQ;',
        'uniform float uPixel, uTime, uFocusQ, uBreath;',
        'varying vec3 vColor; varying float vAlpha;',
        'void main(){',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  float z = max(1.0, -mv.z);',
        '  float tw = 0.76 + 0.24 * sin(uTime * 1.5 + aPhase * 6.0);',
        '  float dim = 1.0;',
        '  if(uFocusQ > -0.5 && aQ > -1.5 && abs(aQ - uFocusQ) > 0.35) dim = 0.22;',
        '  float ps = aSize * uPixel * (54.0 / z) * (1.0 + uBreath * 0.16);',
        '  gl_PointSize = clamp(ps, 0.9, 17.0);',
        '  float dep = clamp(1.5 - z * 0.05, 0.25, 1.0);',
        '  vColor = aColor * mix(0.68, 1.0, dep);',
        '  vAlpha = aAlpha * tw * dim;',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vColor; varying float vAlpha;',
        'void main(){',
        '  vec2 c = gl_PointCoord - vec2(0.5);',
        '  float d = length(c) * 2.0;',
        '  if(d > 1.0) discard;',
        '  float core = exp(-d * d * 7.0);',
        '  float halo = pow(max(0.0, 1.0 - d), 2.0) * 0.30;',
        '  float a = (core + halo) * vAlpha;',
        '  vec3 cc = mix(vColor, vec3(0.94, 1.0, 0.97), core * 0.40);',
        '  gl_FragColor = vec4(cc, clamp(a, 0.0, 1.0));',
        '}'
      ].join('\n')
    });
    points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 2;
    group.add(points);

    /* ---------- 12 个读数 → 图上的 12 个坐标点 ----------
       x = 该象限内三格的固定位置；y = 读数本身（1/2/3），
       上下半区由 QPOS.sy 决定正负。读数是坐标，不是分数。 */
    function computeVerts() {
      for (var qi = 0; qi < 4; qi++) {
        var p = QPOS[Q[qi]];
        var xs = p.sx < 0 ? XS_LEFT : XS_RIGHT;
        for (var ti = 0; ti < 3; ti++) {
          var idx = qi * 3 + ti, v = Vcur[idx];
          DX[idx] = xs[ti];
          DY[idx] = v > .02 ? p.sy * v : 0;   /* 没标的格落在轴上，留成虚位 */
        }
      }
    }
    function qIndex(name) { return Q.indexOf(name); }
    function applyData(m) {
      if (!m || !m.grid) return false;
      model = m;
      ex = m.extras || extras();
      if (ex.labels) QL = ex.labels;
      if (ex.traitLabels) TL = ex.traitLabels;
      for (var i = 0; i < 12; i++) {
        var name = Q[Math.floor(i / 3)], t = T[i % 3];
        var raw = m.grid[name] && m.grid[name][t];
        Vtgt[i] = (raw === 1 || raw === 2 || raw === 3) ? raw : 0;
      }
      if (firstApply) { for (i = 0; i < 12; i++) Vcur[i] = Vtgt[i]; firstApply = false; }
      chainFrom = qIndex(m.blocked_by);
      chainTo = qIndex(m.bottleneck);
      chainSup = qIndex(m.support_from);
      bottleneckQ = qIndex(m.bottleneck);
      computeVerts();
      if (focusQ >= 0 && opts.onFocus) opts.onFocus(describe(Q[focusQ]));
      return true;
    }

    /* ---------- 每帧：平滑读数 → 重算粒子位置 ---------- */
    function update(now, dt, breath) {
      var t = now * .001;
      var k = 1 - Math.exp(-dt * 4.2), i;
      for (i = 0; i < 12; i++) Vcur[i] = lerp(Vcur[i], Vtgt[i], k);
      computeVerts();

      /* billboard：整张 XY 图纸始终正对相机，刻度与文字永不变形；
         只叠一层极轻的摆动，保留呼吸感而不破坏「标准统计图」的端正。 */
      if (camera) {
        group.quaternion.copy(camera.quaternion);
        group.rotateX(Math.sin(t * .33) * .010);
        group.rotateY(Math.sin(t * .27) * .010);
      }

      var p, o, n, a, s, x, y, z, se, q0, q1, i0, i1, u, xline, yline, from, to, pa, pb;
      for (n = 0; n < N; n++) {
        p = P[n]; o = n * 3; a = p.a; u = p.u;
        switch (p.k) {
          case 0:  /* 网格点阵：a=0 横线 / a=1 纵线 */
            if (a === 0) { x = p.v; y = p.u; } else { x = p.u; y = p.v; }
            z = .012;
            break;
          case 1:  /* 主轴点阵 */
            if (a === 0) { x = u; y = 0; } else { x = 0; y = u; }
            z = .035;
            break;
          case 2:  /* 数据折线：段内线性插值，粒子沿折线均匀排布 */
            se = a; q0 = Math.floor(se / 2); j = se % 2;
            i0 = q0 * 3 + j; i1 = i0 + 1;
            x = lerp(DX[i0], DX[i1], u);
            y = lerp(DY[i0], DY[i1], u);
            z = .06 + Math.sin(t * 1.1 + p.seed) * .010;
            break;
          case 3:  /* 数据点簇：围绕坐标点的一小圈粒子 */
            i = a;
            x = DX[i] + Math.cos(p.u) * p.v;
            y = DY[i] + Math.sin(p.u) * p.v * .82;
            z = .09;
            break;
          case 4:  /* 折线下方的面积点阵：v∈[0,1] 从轴铺到折线 */
            se = a; q0 = Math.floor(se / 2); j = se % 2;
            i0 = q0 * 3 + j; i1 = i0 + 1;
            xline = lerp(DX[i0], DX[i1], u);
            yline = lerp(DY[i0], DY[i1], u);
            x = xline + Math.sin(t * .6 + p.seed) * .018;
            y = yline * p.v;
            z = .02;
            break;
          case 5:  /* 瓶颈象限：一圈缓缓扩散的暗红脉冲 */
            if (bottleneckQ < 0) { x = 0; y = 0; z = -8; alp[n] = 0; }
            else {
              var bp = QPOS[Q[bottleneckQ]];
              var ang = (u + t * .24) % 1 * TAU;
              var rad = .55 + ((u * 3 + t * .24) % 1) * .42;
              x = bp.sx * 1.75 + Math.cos(ang) * rad;
              y = bp.sy * 1.75 + Math.sin(ang) * rad;
              z = .04;
              alp[n] = .42 * (1 - ((u * 3 + t * .24) % 1));
            }
            break;
          case 6:  /* 阻塞 / 解锁链：象限之间的贝塞尔弧上流动的光点 */
            from = (a === 0 ? chainFrom : chainSup);
            to = chainTo;
            if (from < 0 || to < 0 || from === to) { x = 0; y = 0; z = -8; alp[n] = 0; }
            else {
              pa = QPOS[Q[from]]; pb = QPOS[Q[to]];
              var ax = pa.sx * 1.75, ay = pa.sy * 1.75;
              var bx = pb.sx * 1.75, by = pb.sy * 1.75;
              var mx = (ax + bx) * .5, my = (ay + by) * .5 + (a === 0 ? .55 : -.55);
              var uu = (u + t * .10) % 1, iu = 1 - uu;
              x = iu * iu * ax + 2 * iu * uu * mx + uu * uu * bx;
              y = iu * iu * ay + 2 * iu * uu * my + uu * uu * by;
              z = .13;
              alp[n] = .54;
            }
            break;
          case 7:  /* 环境浮尘 */
            x = p.u + Math.sin(t * .25 + p.seed) * .10;
            y = p.v + Math.cos(t * .21 + p.seed) * .08;
            z = (p.z || 0) + Math.sin(t * .19 + p.seed * 1.3) * .10;
            break;
          default: x = 0; y = 0; z = 0;
        }
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      }

      /* 折线 / 面积 / 点簇的亮度跟着读数走：没标的格只留极淡的虚位 */
      for (n = 0; n < N; n++) {
        var pk = P[n].k;
        if (pk !== 2 && pk !== 3 && pk !== 4) continue;
        var qi2 = Math.floor(P[n].a / (pk === 2 || pk === 4 ? 2 : 3));
        var base = pk === 2 ? .30 : (pk === 3 ? .24 : .035);
        var gain = pk === 2 ? .50 : (pk === 3 ? .42 : .12);
        var vv0 = 0;
        for (var tj = 0; tj < 3; tj++) vv0 += Vcur[qi2 * 3 + tj];
        alp[n] = base + (vv0 / 9) * gain;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uFocusQ.value = focusQ;
      mat.uniforms.uBreath.value = breath || 0;
    }

    /* ---------- 交互 ---------- */
    function describe(name) {
      var qi = qIndex(name);
      if (qi < 0) return null;
      var g = (model && model.grid && model.grid[name]) || {};
      var ch = (ex.choices && ex.choices[name]) || {};
      var pr = (ex.prompts && ex.prompts[name]) || {};
      var items = [];
      for (var j2 = 0; j2 < 3; j2++) {
        var t2 = T[j2], v = (g[t2] === 1 || g[t2] === 2 || g[t2] === 3) ? g[t2] : 0;
        var opts3 = ch[t2] || FALLBACK_CHOICE[t2];
        items.push({ label: TL[t2] || t2, prompt: pr[t2] || '', text: v ? opts3[v - 1] : '这一格还没标' });
      }
      var tip = '';
      if (model && model.blocked_by === name) tip = '这一块矮下去的时候，' + (QL[model.bottleneck] || '') + '常常跟着吃力。';
      else if (model && model.bottleneck === name) tip = '眼下最费劲的这一块。先照顾它，不用四块一起用力。';
      else if (model && model.support_from === name) tip = '这一块还有余力，可以借给它一点支撑。';
      else tip = '这三格都是你自己标的，随时可以回去改。';
      return { q: name, title: QL[name] || name, sub: (ex.subtitles && ex.subtitles[name]) || QSUB[name],
        color: hex2css(HEX[name]), items: items, tip: tip, demo: !!(model && model.demo) };
    }
    function focus(name) {
      focusQ = qIndex(name);
      mat.uniforms.uFocusQ.value = focusQ;
      if (opts.onFocus) opts.onFocus(focusQ >= 0 ? describe(Q[focusQ]) : null);
      return focusQ;
    }
    function clearFocus() { return focus(null); }

    var tmp = new THREE.Vector3();
    function projectTo(x, y, z, w, h) {
      tmp.set(x, y, z).applyMatrix4(group.matrixWorld).project(camera);
      return { x: (tmp.x * .5 + .5) * w, y: (-tmp.y * .5 + .5) * h, visible: tmp.z < 1 };
    }
    /* 屏幕点选：先看 12 个数据点，再看 4 个象限中心，点空白处也能聚焦 */
    function pick(sx, sy, w, h) {
      if (!camera) return null;
      group.updateMatrixWorld(true);
      var best = null, bd = 1e9, i, p2, d;
      var lim = Math.max(64, Math.min(w, h) * .17);
      for (i = 0; i < 12; i++) {
        p2 = projectTo(DX[i], DY[i], .09, w, h);
        if (!p2.visible) continue;
        d = Math.hypot(p2.x - sx, p2.y - sy);
        if (d < bd) { bd = d; best = i; }
      }
      if (bd < lim) return Q[Math.floor(best / 3)];
      for (i = 0; i < 4; i++) {
        var qp = QPOS[Q[i]];
        p2 = projectTo(qp.sx * 1.75, qp.sy * 1.75, .05, w, h);
        if (!p2.visible) continue;
        d = Math.hypot(p2.x - sx, p2.y - sy);
        if (d < bd) { bd = d; best = i * 3; }
      }
      return bd < lim * 1.5 ? Q[Math.floor(best / 3)] : null;
    }
    function labelAnchors(w, h) {
      if (!camera) return [];
      group.updateMatrixWorld(true);
      var out = [];
      for (var i = 0; i < 4; i++) {
        var qp = QPOS[Q[i]];
        var a2 = projectTo(qp.nx, qp.ny, .06, w, h);
        out.push({ q: Q[i], label: QL[Q[i]], x: a2.x, y: a2.y,
          visible: a2.visible, color: hex2css(HEX[Q[i]]) });
      }
      return out;
    }
    function setPixel(v) { mat.uniforms.uPixel.value = v; }
    function status() {
      return { mode: 'chart', particles: N, focused: focusQ >= 0 ? Q[focusQ] : null,
        demo: !!(model && model.demo), values: Array.prototype.slice.call(Vcur),
        bottleneck: model ? model.bottleneck : null };
    }
    function dispose() {
      scene.remove(group);
      geo.dispose(); mat.dispose(); paper.geometry.dispose();
      paper.material.map.dispose(); paper.material.dispose();
    }

    computeVerts();
    return {
      group: group, THREE: THREE,
      applyData: applyData, setModel: applyData, update: update,
      focus: focus, clearFocus: clearFocus, pick: pick,
      labelAnchors: labelAnchors, describe: describe,
      setPixel: setPixel, status: status, dispose: dispose,
      colors: HEX, labels: QL
    };
  }

  window.INNERSCAPE_WEB = {
    Q: Q, T: T, LABELS: QL, TRAIT_LABELS: TL, COLORS: HEX,
    create: create, localModel: localModel, demoModel: demoModel
  };
})();
