/* =========================================================
   INNERSCAPE · 3D 银河粒子引擎（原生 WebGL，零外部依赖）
   ---------------------------------------------------------
   取代旧版 canvas 2D 的 O(n²) 连线网络：
   · 真 3D 透视：相机自转 + 指针视差，深度雾化与近大远小
   · 四套形态（银河 / 旋涡 / 星潮 / 双环）全部作为静态 attribute
     一次上传，GPU 内按 uMix 插值，切换时是「同一批粒子流动」
     而不是重新撒点；CPU 每帧只改 uniform，几乎零开销
   · 主形态是倾斜扁平银河盘：三条旋臂 + 亮核 + 稀疏晕，
     配合 CSS 银河带与 ambient.js 的星野/流星构成整片夜空
   · 交互全部在 view space 完成：拨开 / 拖动涡旋 / 点击水波
     环 / 滚轮与双指捏合扩散 / 双击换形
   · 加色混合 + 双层辉光内核，薄荷主色 + 冷白星点 + 少量暖金
   · 降级：WebGL 不可用 → 返回 false，旧 2D 粒子原样接管；
     prefers-reduced-motion → 只渲染一帧静态星空
   ========================================================= */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- Shader ---------- */
  var VERT = [
    'precision highp float;',
    'attribute vec3 aP0; attribute vec3 aP1; attribute vec3 aP2; attribute vec3 aP3;',
    'attribute vec4 aRnd;',                 // x 尺寸 / y 配色种子 / z 闪烁相位 / w 亮度
    'uniform vec4 uMix;',                   // 四形态权重
    'uniform float uTime, uYaw, uPitch, uSpread;',
    'uniform float uFocal, uAspect, uPixel, uPointScale, uCamZ;',
    'uniform float uNear, uFar;',
    'uniform vec2 uPointer;',               // 指针在 z=0 平面的世界坐标
    'uniform float uPointerOn, uRadius, uRepel, uVortex;',
    'uniform vec4 uShock[3];',              // xy 原点 / z 波前半径 / w 强度
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'void main(){',
    '  /* 1. 形态混合 */',
    '  vec3 p = aP0*uMix.x + aP1*uMix.y + aP2*uMix.z + aP3*uMix.w;',
    '  p *= uSpread;',
    '  /* 2. 呼吸 + 自转（yaw 含指针视差，pitch 含上下视差） */',
    '  p += vec3(sin(uTime*0.53 + aRnd.z*6.2832), cos(uTime*0.41 + aRnd.z*4.1), sin(uTime*0.37 + aRnd.z*5.7)) * 0.055;',
    '  float cy = cos(uYaw), sy = sin(uYaw);',
    '  p = vec3(p.x*cy - p.z*sy, p.y, p.x*sy + p.z*cy);',
    '  float cp = cos(uPitch), sp = sin(uPitch);',
    '  p = vec3(p.x, p.y*cp - p.z*sp, p.y*sp + p.z*cp);',
    '  /* 3. 相机空间：相机固定在 +z 看向原点 */',
    '  vec3 mv = vec3(p.x, p.y, p.z - uCamZ);',
    '  /* 4. 指针力场：高斯衰减的斥力 + 切向涡旋 */',
    '  vec2 d = mv.xy - uPointer;',
    '  float dist = length(d) + 0.0001;',
    '  vec2 dir = d / dist;',
    '  float infl = exp(-dist*dist / (2.0*uRadius*uRadius)) * uPointerOn;',
    '  mv.xy += dir * infl * uRepel;',
    '  mv.xy += vec2(-dir.y, dir.x) * infl * uVortex;',
    '  /* 5. 冲击波：环形波前把经过的粒子向外、向相机推 */',
    '  for(int i=0;i<3;i++){',
    '    vec2 sd = mv.xy - uShock[i].xy;',
    '    float sl = length(sd) + 0.0001;',
    '    float band = abs(sl - uShock[i].z);',
    '    float ring = exp(-band*band / 0.20) * uShock[i].w;',
    '    mv.xy += (sd/sl) * ring;',
    '    mv.z  += ring * 0.30;',
    '  }',
    '  /* 6. 透视投影（不做深度测试，z 直接给 0） */',
    '  float depth = max(0.6, -mv.z);',
    '  vec2 ndc = vec2(mv.x*uFocal/uAspect, mv.y*uFocal) / depth;',
    '  gl_Position = vec4(ndc, 0.0, 1.0);',
    '  gl_PointSize = clamp(aRnd.x * uPixel * uPointScale / depth, 1.0, 30.0);',
    '  /* 7. 配色与深度雾 */',
    '  vec3 cold = vec3(0.82, 0.98, 0.89);',       /* 冷白星点 */
    '  vec3 mint = vec3(0.37, 0.86, 0.67);',       /* 薄荷主色 */
    '  vec3 gold = vec3(0.95, 0.88, 0.62);',       /* 暖金，呼应流星 */
    '  vec3 base = mix(cold, mint, step(0.80, aRnd.y));',
    '  base = mix(base, gold, step(0.966, aRnd.y) * 0.9);',
    '  float tw = 0.58 + 0.42 * sin(uTime*1.25 + aRnd.z*6.2832);',
    '  float fog = 1.0 - smoothstep(uNear, uFar, depth);',
    '  vColor = base;',
    '  vAlpha = (0.24 + 0.76*aRnd.w) * tw * fog * 1.45;',
    '}'
  ].join('\n');

  var FRAG = [
    'precision mediump float;',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'void main(){',
    '  vec2 c = gl_PointCoord - vec2(0.5);',
    '  float d = length(c) * 2.0;',
    '  if(d > 1.0) discard;',
    '  float core = exp(-d*d*6.5);',                       /* 硬亮核 */
    '  float halo = pow(max(0.0, 1.0-d), 2.4) * 0.40;',  /* 柔光晕 */
    '  float a = (core*0.92 + halo) * vAlpha;',
    '  vec3 col = mix(vColor, vec3(0.94,1.0,0.97), core*0.52);',
    '  gl_FragColor = vec4(col, a);',                      /* 配合 SRC_ALPHA/ONE 加色 */
    '}'
  ].join('\n');

  /* ---------- 引擎状态 ---------- */
  var G = {
    ok: false, started: false, gl: null, cv: null, prog: null, buf: null,
    u: {}, n: 0, raf: 0, t0: 0, paused: false, lost: false,
    w: 0, h: 0, dpr: 1,
    yaw: 0, yawT: 0, pitch: 0, pitchT: 0, spread: 1, spreadT: 1,
    ptr: [0, 0], ptrOn: 0, repel: 0.34, vortex: 0, vortexT: 0,
    press: false, shape: 0, shapeT: 0, mix: [1, 0, 0, 0],
    shocks: [], lastAuto: 0
  };

  var FOCAL = 2.1445;   /* 1 / tan(25°)，约 50° 视场 */
  var CAM_Z = 8.2;
  var SHAPE_NAMES = ['银河', '旋涡', '星潮', '双环'];

  function rand() { return Math.random(); }

  /* 生成四套目标位置：同一个 i 在四套里是「同一个粒子」 */
  function buildGeometry(n) {
    var data = new Float32Array(n * 16);
    var grid = Math.ceil(Math.sqrt(n));
    for (var i = 0; i < n; i++) {
      var o = i * 16;
      /* P0 银河：倾斜扁平盘 + 三条旋臂 + 中心亮核 + 稀疏晕。
         盘面在 y 上压扁并叠加 x/z 的线性项，视觉上是斜挂夜空的一条光带 */
      var tt = Math.pow(rand(), 0.72);
      var rr = 0.18 + tt * 3.95;
      var arm = i % 3;
      var ang = rr * 1.06 + arm * (TAU / 3) + (rand() - 0.5) * (0.40 + rr * 0.11);
      var gx = Math.cos(ang) * rr + (rand() - 0.5) * 0.24;
      var gz = Math.sin(ang) * rr + (rand() - 0.5) * 0.24;
      var gy = (rand() - 0.5) * (0.34 + 0.10 * (1 - tt));
      if (rand() < 0.17) {                       /* 17% 粒子聚到银心 */
        var cr = Math.pow(rand(), 1.8) * 0.86;
        var ca = rand() * TAU;
        gx = Math.cos(ca) * cr; gz = Math.sin(ca) * cr;
        gy = (rand() - 0.5) * 0.62;
      }
      data[o]      = gx;
      data[o + 1]  = gy * 0.88 + gx * 0.28 + gz * 0.09;
      data[o + 2]  = gz * 0.76;
      /* P1 螺旋：13 圈渐开，中心密外围疏 */
      var t = i / n, ang = t * Math.PI * 13 + (rand() - 0.5) * 0.55;
      var rr = 0.28 + t * 3.05;
      data[o + 3]  = Math.cos(ang) * rr;
      data[o + 4]  = (t - 0.5) * 4.4 + Math.sin(ang * 2.0) * 0.18;
      data[o + 5]  = Math.sin(ang) * rr;
      /* P2 波面：网格 + 干涉波纹 */
      var gx = (i % grid) / grid, gz = Math.floor(i / grid) / grid;
      data[o + 6]  = (gx - 0.5) * 8.2;
      data[o + 7]  = Math.sin(gx * 9.4) * Math.cos(gz * 7.1) * 0.92 + (rand() - 0.5) * 0.16;
      data[o + 8]  = (gz - 0.5) * 7.0;
      /* P3 双环：两个倾斜、错位的椭圆环 */
      var side = (i & 1) ? 1 : -1, a2 = rand() * TAU;
      data[o + 9]  = side * 1.05 + Math.cos(a2) * (2.25 + rand() * 0.22);
      data[o + 10] = Math.sin(a2) * (1.44 + rand() * 0.18) + side * 0.18;
      data[o + 11] = Math.sin(a2) * (1.75 + rand() * 0.2) + side * 0.35;
      /* 随机参数：尺寸 / 配色 / 闪烁 / 亮度 */
      var big = rand() < 0.055;
      data[o + 12] = big ? (0.036 + rand() * 0.030) : (0.010 + rand() * 0.014);
      data[o + 13] = rand();
      data[o + 14] = rand();
      data[o + 15] = big ? (0.72 + rand() * 0.28) : Math.pow(rand(), 1.5);
    }
    return data;
  }

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[particles] shader:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function init() {
    var wrap = document.getElementById('fx');
    if (!wrap) return false;
    var cv = document.getElementById('gl-canvas');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'gl-canvas';
      cv.setAttribute('aria-hidden', 'true');
      cv.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%';
      wrap.appendChild(cv);
    }
    var gl = null;
    try {
      gl = cv.getContext('webgl', {
        alpha: true, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, powerPreference: 'high-performance'
      }) || cv.getContext('experimental-webgl');
    } catch (e) { gl = null; }
    if (!gl) { cv.style.display = 'none'; return false; }

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { cv.style.display = 'none'; return false; }
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[particles] link:', gl.getProgramInfoLog(prog));
      cv.style.display = 'none'; return false;
    }
    gl.useProgram(prog);

    var isMobile = window.innerWidth < 760 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    var n = isMobile
      ? Math.min(2200, Math.max(900, Math.round(window.innerWidth * window.innerHeight / 420)))
      : Math.min(5200, Math.max(2000, Math.round(window.innerWidth * window.innerHeight / 260)));

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, buildGeometry(n), gl.STATIC_DRAW);
    var stride = 16 * 4;
    var attrs = [['aP0', 3, 0], ['aP1', 3, 12], ['aP2', 3, 24], ['aP3', 3, 36], ['aRnd', 4, 48]];
    for (var i = 0; i < attrs.length; i++) {
      var loc = gl.getAttribLocation(prog, attrs[i][0]);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, attrs[i][1], gl.FLOAT, false, stride, attrs[i][2]);
    }
    var names = ['uMix','uTime','uYaw','uPitch','uSpread','uFocal','uAspect','uPixel',
                 'uPointScale','uCamZ','uNear','uFar','uPointer','uPointerOn','uRadius',
                 'uRepel','uVortex','uShock[0]'];
    var u = {};
    for (var k = 0; k < names.length; k++) u[names[k]] = gl.getUniformLocation(prog, names[k]);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);       /* 加色：亮处自然堆叠 */
    gl.clearColor(0, 0, 0, 0);

    G.gl = gl; G.cv = cv; G.prog = prog; G.buf = buf; G.u = u; G.n = n;
    G.ok = true; G.t0 = performance.now(); G.lastAuto = G.t0;

    cv.addEventListener('webglcontextlost', function (ev) {
      ev.preventDefault(); G.lost = true; stop(); fallback();
    }, false);

    var legacy = document.getElementById('fx-canvas');
    if (legacy) legacy.style.display = 'none';   /* 旧 2D 画布让位 */
    resize();
    bindEvents();
    return true;
  }

  function fallback() {
    var cv = document.getElementById('gl-canvas');
    if (cv) cv.style.display = 'none';
    var legacy = document.getElementById('fx-canvas');
    if (legacy) legacy.style.display = 'block';
    if (window.INNERSCAPE_LEGACY_FX) window.INNERSCAPE_LEGACY_FX();
  }

  function resize() {
    if (!G.ok) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    G.w = window.innerWidth; G.h = window.innerHeight; G.dpr = dpr;
    G.cv.width = Math.floor(G.w * dpr);
    G.cv.height = Math.floor(G.h * dpr);
    G.gl.viewport(0, 0, G.cv.width, G.cv.height);
  }

  /* 屏幕坐标 → z=0 平面上的世界坐标（与 shader 的透视一致） */
  function toWorld(cx, cy) {
    var nx = (cx / (G.w || 1)) * 2 - 1;
    var ny = 1 - (cy / (G.h || 1)) * 2;
    var aspect = (G.w || 1) / (G.h || 1);
    return [nx * CAM_Z * aspect / FOCAL, ny * CAM_Z / FOCAL];
  }

  function shock(cx, cy, amp) {
    var w = toWorld(cx, cy);
    G.shocks.push({ x: w[0], y: w[1], r: 0, a: amp });
    if (G.shocks.length > 3) G.shocks.shift();
  }

  function setShape(idx, silent) {
    G.shapeT = ((idx % 4) + 4) % 4;
    G.lastAuto = performance.now();
    if (!silent) {
      G.shocks.push({ x: 0, y: 0, r: 0, a: 1.8 });
      if (G.shocks.length > 3) G.shocks.shift();
    }
    if (G.paused || REDUCED) draw(performance.now());
    return SHAPE_NAMES[G.shapeT];
  }

  function bindEvents() {
    if (G.bound) return;
    G.bound = true;
    var w = window, d = document;

    d.addEventListener('pointermove', function (ev) {
      var p = toWorld(ev.clientX, ev.clientY);
      G.ptr[0] = p[0]; G.ptr[1] = p[1]; G.ptrOn = 1;
      G.yawT = (ev.clientX / (G.w || 1) - 0.5) * 0.62;
      G.pitchT = -(ev.clientY / (G.h || 1) - 0.5) * 0.42;
    }, { passive: true });

    d.addEventListener('pointerdown', function (ev) {
      G.press = true;
      G.ptrOn = 1;
      shock(ev.clientX, ev.clientY, 0.85);   /* 内层细波；外层水波由 ambient.ripple 触发 */
    }, { passive: true });

    w.addEventListener('pointerup', function () { G.press = false; }, { passive: true });
    w.addEventListener('blur', function () { G.press = false; G.ptrOn = 0; });
    d.addEventListener('pointerleave', function () { G.ptrOn = 0; });

    d.addEventListener('dblclick', function (ev) {
      setShape(G.shapeT + 1);
      shock(ev.clientX, ev.clientY, 2.3);
    }, false);

    d.addEventListener('wheel', function (ev) {
      G.spreadT = Math.max(0.66, Math.min(1.55, G.spreadT - ev.deltaY * 0.00042));
    }, { passive: true });

    var pinchBase = 0;
    d.addEventListener('touchstart', function (ev) {
      if (ev.touches && ev.touches.length >= 2) {
        var a = ev.touches[0], b = ev.touches[1];
        pinchBase = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
      }
    }, { passive: true });
    d.addEventListener('touchmove', function (ev) {
      var ts = ev.touches;
      if (!ts || !ts.length) return;
      if (ts.length >= 2) {
        var d0 = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
        G.spreadT = Math.max(0.66, Math.min(1.55, d0 / (pinchBase || d0 || 1)));
        var mx = (ts[0].clientX + ts[1].clientX) / 2, my = (ts[0].clientY + ts[1].clientY) / 2;
        var p = toWorld(mx, my); G.ptr[0] = p[0]; G.ptr[1] = p[1]; G.ptrOn = 1;
      } else {
        var q = toWorld(ts[0].clientX, ts[0].clientY);
        G.ptr[0] = q[0]; G.ptr[1] = q[1]; G.ptrOn = 1;
      }
    }, { passive: true });
    d.addEventListener('touchend', function (ev) {
      if (!ev.touches || ev.touches.length < 2) pinchBase = 0;
    }, { passive: true });

    w.addEventListener('resize', resize, { passive: true });
    d.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else if (!REDUCED && G.started && !G.lost) startLoop();
    }, false);
  }

  function draw(now) {
    if (!G.ok || G.lost) return;
    var gl = G.gl, u = G.u, t = (now - G.t0) / 1000;
    var k = 0.075;

    /* 平滑所有交互量 */
    G.yaw += (G.yawT - G.yaw) * k;
    G.pitch += (G.pitchT - G.pitch) * k;
    G.spread += (G.spreadT - G.spread) * 0.055;
    G.vortexT = G.press ? 0.82 : 0.0;
    G.vortex += (G.vortexT - G.vortex) * 0.07;
    G.repel = G.press ? 0.12 : 0.34;

    /* 形态权重：向目标 one-hot 缓动，形成粒子流动 */
    for (var i = 0; i < 4; i++) {
      var target = i === G.shapeT ? 1 : 0;
      G.mix[i] += (target - G.mix[i]) * 0.028;
    }
    var sum = G.mix[0] + G.mix[1] + G.mix[2] + G.mix[3];
    if (sum > 0.0001) for (var m = 0; m < 4; m++) G.mix[m] /= sum;

    /* 自动编排：每 15 秒换一次形态 */
    if (!REDUCED && now - G.lastAuto > 15000) setShape(G.shapeT + 1, true);

    /* 冲击波推进 */
    var shockData = new Float32Array(12);
    for (var s = G.shocks.length - 1; s >= 0; s--) {
      var q = G.shocks[s];
      /* 慢速波前：像水波一样一圈圈荡开，而不是瞬间炸开 */
      q.r += 0.085 + q.r * 0.007;
      q.a *= 0.984;
      if (q.a < 0.02 || q.r > 18) G.shocks.splice(s, 1);
    }
    for (var s2 = 0; s2 < G.shocks.length; s2++) {
      var o = s2 * 4, z = G.shocks[s2];
      shockData[o] = z.x; shockData[o + 1] = z.y;
      shockData[o + 2] = z.r; shockData[o + 3] = z.a;
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(G.prog);
    gl.uniform4f(u.uMix, G.mix[0], G.mix[1], G.mix[2], G.mix[3]);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uYaw, G.yaw + t * 0.035);       /* 缓慢自转叠加视差 */
    gl.uniform1f(u.uPitch, G.pitch);
    gl.uniform1f(u.uSpread, G.spread);
    gl.uniform1f(u.uFocal, FOCAL);
    gl.uniform1f(u.uAspect, (G.w || 1) / (G.h || 1));
    gl.uniform1f(u.uPixel, G.dpr);
    gl.uniform1f(u.uPointScale, (G.h || 1) * FOCAL * 1.15);
    gl.uniform1f(u.uCamZ, CAM_Z);
    gl.uniform1f(u.uNear, CAM_Z - 0.8);
    gl.uniform1f(u.uFar, CAM_Z + 5.8);
    gl.uniform2f(u.uPointer, G.ptr[0], G.ptr[1]);
    gl.uniform1f(u.uPointerOn, G.ptrOn);
    gl.uniform1f(u.uRadius, 1.65);
    gl.uniform1f(u.uRepel, G.repel);
    gl.uniform1f(u.uVortex, G.vortex);
    gl.uniform4fv(u['uShock[0]'], shockData);
    gl.drawArrays(gl.POINTS, 0, G.n);
  }

  function frame(now) {
    draw(now);
    if (!G.paused && !G.lost) G.raf = window.requestAnimationFrame(frame);
  }

  function startLoop() {
    if (G.paused) G.paused = false;
    if (!G.raf && !REDUCED && !G.lost) G.raf = window.requestAnimationFrame(frame);
  }

  function stop() {
    G.paused = true;
    if (G.raf) { window.cancelAnimationFrame(G.raf); G.raf = 0; }
  }

  function start() {
    if (G.lost) return false;
    if (!G.ok && !init()) return false;
    G.started = true;
    var wrap = document.getElementById('fx');
    if (wrap) wrap.className = 'on';
    if (REDUCED) { draw(performance.now()); return true; }   /* 静态一帧 */
    startLoop();
    return true;
  }

  /* 供 index.html 的 fxSetup() 调用；也暴露给控制台做手动调参 */
  window.INNERSCAPE_PARTICLES = {
    start: start,
    stop: stop,
    setShape: setShape,
    /* 供水波引擎调用：幅度随雨滴累积热度变化，第一滴只轻推一下 */
    ripple: function (x, y, amp) { shock(x, y, amp === undefined ? 1.95 : amp); },
    get status() {
      return { available: G.ok, running: !!G.raf, count: G.n, shape: SHAPE_NAMES[G.shapeT] };
    }
  };
})();
