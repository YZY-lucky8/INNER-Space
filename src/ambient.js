/* =========================================================
   INNERSCAPE · 星夜氛围引擎（零外部依赖，canvas 2D）
   ---------------------------------------------------------
   · 点击水波：交给 water.js 的 WebGL 折射涟漪（波峰/波谷明暗波列），
     本文件只负责派发事件 + 联动 WebGL 星点向外荡开，不再画 DOM 光圈
   · 银河星野：静态细星点 + 缓慢闪烁，铺在 WebGL 粒子之上
   · 流星：统一朝向（右上 → 左下）斜向划过，渐变拖尾 + 头部辉光，偶发流星雨
   · 萤火与光尘：缓慢漂浮 / 下落，构成治愈系的常驻呼吸感
   · 降级：prefers-reduced-motion 只画一帧静态星野；
     页面隐藏暂停；DPR 限制 1.75；所有层 pointer-events:none
   ========================================================= */
(function () {
  'use strict';

  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var TAU = Math.PI * 2;

  var A = {
    ready: false, cv: null, ctx: null,
    w: 0, h: 0, dpr: 1, raf: 0, t0: 0, last: 0, paused: false,
    stars: [], fireflies: [], dust: [], meteors: [],
    nextMeteor: 0
  };

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- 初始化 ---------- */
  function buildStars() {
    A.stars.length = 0;
    var n = Math.round(clamp(A.w * A.h / 7600, 90, 240));
    for (var i = 0; i < n; i++) {
      A.stars.push({
        x: Math.random() * A.w, y: Math.random() * A.h,
        r: rand(0.35, 1.15), a: rand(0.16, 0.62),
        ph: Math.random() * TAU, sp: rand(0.4, 1.5),
        warm: Math.random() < 0.13
      });
    }
  }
  function buildFireflies() {
    A.fireflies.length = 0;
    var n = Math.round(clamp(A.w * A.h / 48000, 12, 34));
    for (var i = 0; i < n; i++) {
      A.fireflies.push({
        x: Math.random() * A.w, y: Math.random() * A.h,
        r: rand(1.1, 2.6), ph: Math.random() * TAU,
        sx: rand(0.16, 0.48), sy: rand(0.12, 0.36),
        ax: rand(14, 46), ay: rand(10, 34), sp: rand(0.35, 0.85)
      });
    }
  }
  function buildDust() {
    A.dust.length = 0;
    var n = Math.round(clamp(A.w / 52, 10, 26));
    for (var i = 0; i < n; i++) {
      A.dust.push({
        x: Math.random() * A.w, y: Math.random() * A.h,
        r: rand(0.6, 1.8), vy: rand(6, 20), sway: rand(7, 24),
        ph: Math.random() * TAU, sp: rand(0.3, 0.8), a: rand(0.14, 0.44),
        warm: Math.random() < 0.28
      });
    }
  }

  function resize() {
    A.w = window.innerWidth; A.h = window.innerHeight;
    A.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    if (!A.cv) return;
    A.cv.width = Math.floor(A.w * A.dpr);
    A.cv.height = Math.floor(A.h * A.dpr);
    A.cv.style.width = A.w + 'px';
    A.cv.style.height = A.h + 'px';
    A.ctx.setTransform(A.dpr, 0, 0, A.dpr, 0, 0);
    buildStars(); buildFireflies(); buildDust();
  }

  function init() {
    if (A.ready) return true;
    /* 挂在 body 而不是 #fx：#fx 的显隐受登录态控制，
       星野 / 流星 / 光尘属于整站氛围，应当在任何状态下都可见 */
    A.cv = document.createElement('canvas');
    A.cv.id = 'meteor-canvas';
    A.cv.setAttribute('aria-hidden', 'true');
    A.cv.style.cssText = 'position:fixed;inset:0;display:block;width:100%;height:100%;z-index:0;pointer-events:none';
    document.body.appendChild(A.cv);
    A.ctx = A.cv.getContext('2d');
    if (!A.ctx) return false;

    resize();
    window.addEventListener('resize', resize, { passive: true });
    bindRipple();

    A.ready = true;
    A.t0 = performance.now();
    A.nextMeteor = A.t0 + rand(1400, 3200);
    return true;
  }

  /* ---------- 点击水波：派发给折射引擎 + 星点联动 ---------- */
  function ripple(x, y) {
    if (REDUCED) return;
    var ok = false, sc = 0;
    try {
      var water = window.INNERSCAPE_WATER;
      if (water && water.ripple) {
        ok = water.ripple(x, y, 1);
        /* 取本次雨滴的扩张系数，让星点联动与水面涟漪同尺度 */
        if (water.status) sc = water.status.scale || 0;
      }
    } catch (e) { /* 水波层不可用时不影响其余交互 */ }
    /* 第一滴只轻推一下星点，连点后才跟着铺开，避免「小涟漪 + 大光圈」割裂 */
    try {
      if (window.INNERSCAPE_PARTICLES && window.INNERSCAPE_PARTICLES.ripple) {
        window.INNERSCAPE_PARTICLES.ripple(x, y, 0.55 + sc * 1.65);
      }
    } catch (e) { /* 粒子层不可用时水波仍然成立 */ }
    return ok;
  }

  function bindRipple() {
    if (REDUCED) return;
    document.addEventListener('pointerdown', function (ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      ripple(ev.clientX, ev.clientY);
    }, { passive: true });
    /* 键盘确认也给一次柔波，保证非指针用户有同等反馈 */
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var el = document.activeElement;
      if (!el || !el.getBoundingClientRect) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      ripple(r.left + r.width / 2, r.top + r.height / 2);
    }, { passive: true });
  }

  /* ---------- 流星：统一朝向 ----------
     全部从右上往左下斜划（dx<0, dy>0），不再有随机反向的那一批。
     角度只在很窄的区间里抖动，让同向的几条保持自然差别又不散开成两个方向；
     流星雨里延后出发的几条也沿用同一朝向，只是错峰起跑。 */
  function spawnMeteor(delay) {
    if (REDUCED) return;
    var ang = rand(0.38, 0.53);                 /* 与水平线夹角，恒定向下 */
    var dx = -Math.cos(ang), dy = Math.sin(ang);
    var x = rand(0.60 * A.w, 1.14 * A.w);      /* 一律从画面右侧之外 / 右上方出发 */
    var y = rand(-0.12 * A.h, 0.36 * A.h);
    var speed = rand(720, 1160);
    A.meteors.push({
      x: x, y: y, dx: dx, dy: dy, speed: speed,
      len: rand(140, 272), w: rand(1.0, 2.1),
      life: 0, max: rand(0.95, 1.50),
      warm: Math.random() < 0.18,
      born: performance.now() + (delay || 0)
    });
  }

  function drawMeteor(m, now) {
    var ctx = A.ctx;
    var age = (now - m.born) / 1000;
    if (age < 0) return true;      /* 流星雨里延后出发的那几条，先保留不绘制 */
    if (age > m.max) return false;
    var travel = m.speed * age;
    var hx = m.x + m.dx * travel, hy = m.y + m.dy * travel;
    var tx = hx - m.dx * m.len, ty = hy - m.dy * m.len;

    /* 生命周期包络：快速亮起 → 缓慢淡出 */
    var env = Math.min(1, age / 0.12) * Math.pow(1 - age / m.max, 0.85);
    if (env <= 0) return false;

    var head = m.warm ? '255,231,178' : '220,255,238';
    var mid  = m.warm ? '255,205,150' : '159,240,206';
    var grad = ctx.createLinearGradient(tx, ty, hx, hy);
    grad.addColorStop(0, 'rgba(' + mid + ',0)');
    grad.addColorStop(0.62, 'rgba(' + mid + ',' + (0.24 * env).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(' + head + ',' + (0.95 * env).toFixed(3) + ')');
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy);
    ctx.strokeStyle = grad; ctx.lineWidth = m.w; ctx.lineCap = 'round';
    ctx.stroke();

    /* 头部辉光 */
    var g2 = ctx.createRadialGradient(hx, hy, 0, hx, hy, 12 + m.w * 3);
    g2.addColorStop(0, 'rgba(' + head + ',' + (0.9 * env).toFixed(3) + ')');
    g2.addColorStop(0.28, 'rgba(' + mid + ',' + (0.36 * env).toFixed(3) + ')');
    g2.addColorStop(1, 'rgba(' + mid + ',0)');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(hx, hy, 12 + m.w * 3, 0, TAU); ctx.fill();
    return true;
  }

  /* ---------- 每帧绘制 ---------- */
  function draw(now) {
    var ctx = A.ctx;
    if (!ctx) return;
    var t = (now - A.t0) / 1000;
    ctx.clearRect(0, 0, A.w, A.h);

    /* 1. 静态星野 + 缓慢闪烁 */
    for (var i = 0; i < A.stars.length; i++) {
      var s = A.stars[i];
      var tw = 0.68 + 0.32 * Math.sin(t * s.sp + s.ph);
      ctx.fillStyle = s.warm
        ? 'rgba(255,231,184,' + (s.a * tw * 0.82).toFixed(3) + ')'
        : 'rgba(226,255,241,' + (s.a * tw).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
    }

    /* 2. 萤火：正弦漂移 + 呼吸辉光 */
    for (var f = 0; f < A.fireflies.length; f++) {
      var p = A.fireflies[f];
      var fx2 = p.x + Math.sin(t * p.sx + p.ph) * p.ax;
      var fy2 = p.y + Math.cos(t * p.sy + p.ph * 1.3) * p.ay;
      var glow = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * p.sp * 2.4 + p.ph));
      var rr = p.r * (2.6 + glow * 1.8);
      var gg = ctx.createRadialGradient(fx2, fy2, 0, fx2, fy2, rr);
      gg.addColorStop(0, 'rgba(200,255,228,' + (0.62 * glow).toFixed(3) + ')');
      gg.addColorStop(0.35, 'rgba(95,220,171,' + (0.20 * glow).toFixed(3) + ')');
      gg.addColorStop(1, 'rgba(95,220,171,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(fx2, fy2, rr, 0, TAU); ctx.fill();
    }

    /* 3. 下落光尘：慢速飘落 + 横向摆动 */
    for (var d = 0; d < A.dust.length; d++) {
      var q = A.dust[d];
      var dy2 = (q.y + t * q.vy) % (A.h + 30) - 15;
      var dx2 = q.x + Math.sin(t * q.sp + q.ph) * q.sway;
      ctx.fillStyle = q.warm
        ? 'rgba(255,231,184,' + (q.a * 0.8).toFixed(3) + ')'
        : 'rgba(191,240,216,' + q.a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(dx2, dy2, q.r, 0, TAU); ctx.fill();
    }

    /* 4. 流星调度与绘制 */
    if (!REDUCED) {
      if (now >= A.nextMeteor) {
        var shower = Math.random() < 0.22;
        spawnMeteor(0);
        if (shower) { spawnMeteor(rand(140, 320)); if (Math.random() < 0.5) spawnMeteor(rand(360, 620)); }
        A.nextMeteor = now + rand(2800, 6800);
      }
      for (var m = A.meteors.length - 1; m >= 0; m--) {
        if (!drawMeteor(A.meteors[m], now)) A.meteors.splice(m, 1);
      }
    }
  }

  function frame(now) {
    A.last = now;
    draw(now);
    if (!A.paused) A.raf = window.requestAnimationFrame(frame);
  }

  function startLoop() {
    A.paused = false;
    if (!A.raf && !REDUCED) A.raf = window.requestAnimationFrame(frame);
  }

  function stop() {
    A.paused = true;
    if (A.raf) { window.cancelAnimationFrame(A.raf); A.raf = 0; }
  }

  function start() {
    if (!A.ready && !init()) return false;
    if (REDUCED) { draw(performance.now()); return true; }   /* 静态一帧，无流星无水波 */
    startLoop();
    return true;
  }

  /* 手动触发一次流星（也供控制台/测试使用） */
  function burst(n) {
    if (REDUCED) return 0;
    var k = clamp(n || 1, 1, 5);
    for (var i = 0; i < k; i++) spawnMeteor(i * 160);
    return k;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else if (A.ready && !REDUCED) startLoop();
  }, false);

  function boot() {
    start();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, false);
  } else {
    boot();
  }

  window.INNERSCAPE_AMBIENT = {
    start: start,
    stop: stop,
    ripple: ripple,
    burst: burst,
    get status() {
      return {
        available: A.ready, running: !!A.raf, reduced: REDUCED,
        stars: A.stars.length, fireflies: A.fireflies.length,
        dust: A.dust.length, meteors: A.meteors.length
      };
    }
  };
})();
