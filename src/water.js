/* =========================================================
   INNERSCAPE · 水面涟漪引擎（原生 WebGL1，零外部依赖）
   ---------------------------------------------------------
   设计意图：点击是「水波荡漾」，不是「扩散光圈」。
   决定性质感 = 折射：把 #photo-bg 的照片作为纹理，用波面斜率
   做径向 UV 位移采样，树叶与蓝天会被波纹真实推挤扭曲；再叠
   波峰天光 / 波谷阴影 / 镜面高光与极淡色散。只画同心亮环，
   无论多亮都只会读成光圈。
     · 雨滴   ：第一下只有一枚小涟漪（终末半径 ~52px、寿命 ~1.05s、
       短波长细密 3~4 圈），像雨滴滴进水面，而不是一整片湖在晃
     · 累积   ：连点会累积「水面热度」charge（每次 +0.22，约 5 次到顶），
       后续每一滴的半径 / 波宽 / 寿命按该滴的 scale 递增，最大 ~352px；
       停手 2.4s 自动回落到第一滴。多个波并存叠加，越点越荡越开
     · 不规则 ：波前用角度谐波轻微扰动，雨滴近似正圆、大波略扰动
     · 椭圆透视：竖向压扁 1.22，像俯视一片水面
     · 阻尼   ：波前随时间推进、波幅指数衰减；落点有暗核与亮环
     · 合成   ：canvas 插进 #photo-bg 内、位于 .photo-veil 之下，
       CSS 的 filter / 遮罩照常作用，#stage 与粒子层不受遮挡
   性能：无活跃波时完全停帧；DPR 上限 1.25；最多 6 个并存波；
         页面隐藏暂停；reduce-motion 不产波。
   降级：纹理加载失败（如 file:// 的跨域限制）→ 退回「透明叠加」
     的明暗波列，CSS 照片背景照常；WebGL 不可用 → canvas 2D
     多层明暗椭圆波列；两者都不行 → 静默失败。
   ========================================================= */
(function () {
  'use strict';

  var MQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var REDUCED = !!(MQ && MQ.matches);
  var MAX_WAVES = 6;
  /* 连点累积：停手 CHARGE_HOLD 秒后清零，重新从「第一滴雨」开始 */
  var CHARGE_STEP = 0.22, CHARGE_HOLD = 2.4;
  /* 用户中途改变系统偏好也能立刻响应，不必刷新页面 */
  function onMotionChange(e) {
    REDUCED = !!e.matches;
    if (REDUCED) { W.waves.length = 0; W.charge = 0; W.lastTap = 0; stop(); draw(performance.now()); }
    else start();
  }
  if (MQ) {
    if (MQ.addEventListener) MQ.addEventListener('change', onMotionChange);
    else if (MQ.addListener) MQ.addListener(onMotionChange);
  }

  var W = {
    ready: false, ok: false, mode: '', cv: null, gl: null, ctx: null,
    prog: null, loc: {}, glTried: false,
    tex: null, texW: 1, texH: 1, hasTex: false, texReady: false,
    w: 0, h: 0, dpr: 1, t0: 0, raf: 0, paused: false,
    waves: [], seq: 0, charge: 0, lastTap: 0, lastScale: 0
  };

  var VERT = [
    'attribute vec2 aPos;',
    'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  /* 片元着色器：全部波纹在一次全屏 pass 内算完。
     注意 GLSL ES 1.0 的 pow(x,2.0) 在 x<0 时未定义、smoothstep
     要求 edge0<edge1，因此平方一律用乘法、反向渐变用 1.0-ss。 */
  var FRAG = [
    'precision highp float;',
    'uniform vec2 uRes;',          /* CSS 像素尺寸 */
    'uniform float uDpr;',
    'uniform float uTime;',        /* 秒 */
    'uniform vec4 uWaves[6];',     /* x, y(顶起算), 起始秒, 强度 */
    'uniform float uScale[6];',    /* 该滴的扩张系数：0=雨滴，1=连点满级 */
    'uniform sampler2D uTex;',     /* 背景照片 */
    'uniform vec2 uTexSize;',      /* 照片原始尺寸 */
    'uniform float uHasTex;',      /* 纹理是否就绪 */
    /* 复现 CSS 的 background: center 42% / cover */
    'vec2 coverUV(vec2 p){',
    '  float sc = max(uRes.x / uTexSize.x, uRes.y / uTexSize.y);',
    '  vec2 drawn = uTexSize * sc;',
    '  vec2 off = vec2((uRes.x - drawn.x) * 0.5, (uRes.y - drawn.y) * 0.42);',
    '  return (p - off) / drawn;',
    '}',
    'void main(){',
    '  vec2 p = gl_FragCoord.xy / uDpr;',
    '  p.y = uRes.y - p.y;',       /* 换成顶起算，和 DOM 坐标一致 */
    /* slope = 波面法线朝光分量（决定明暗），refr = 径向折射位移 */
    '  float slope = 0.0, energy = 0.0, tint = 0.0;',
    '  vec2 refr = vec2(0.0);',
    '  for(int i=0;i<6;i++){',
    '    vec4 w = uWaves[i];',
    '    if(w.w > 0.0){',
    '      float sc = uScale[i];',
    '      float age = uTime - w.z;',
    '      float life = 1.05 + 1.55 * sc;',
    '      if(age >= 0.0 && age < life){',
    '        vec2 dv = vec2(p.x - w.x, (p.y - w.y) * 1.22);',
    /* 雨滴：终末半径 52px、窄波包、短波长细密圈；连点后放大到 352px */
    '        float vmax = 52.0 + 300.0 * sc;',
    /* 阻尼式波前：先快后慢，0.3s 就有 ~34px，1s 收敛到 52px，像真涟漪 */
    '        float f1 = vmax * (1.0 - exp(-age * 3.6));',
    '        float w1 = 10.0 + 24.0 * sc;',
    /* 包围盒剔除：雨滴只覆盖落点周围几十像素，其余片元直接跳过。
       连点 6 波并存时软件渲染也不会被全屏 exp/sin 拖垮。 */
    '        if(length(dv) > f1 + 3.2 * w1 + 4.0) continue;',
    '        float ang = atan(dv.y, dv.x);',
    '        float d = length(dv);',
    '        float jit = 0.55 + 2.0 * sc;',
    '        d += sin(ang * 5.0 + age * 1.8) * jit + sin(ang * 9.0 - age * 1.2) * jit * 0.5;',
    '        float w2 = w1 * 0.58;',
    '        float damp = exp(-age * (2.05 - 0.65 * sc)) * smoothstep(0.0, 0.035, age) * w.w;',
    '        float a1 = (d - f1) / w1;',
    '        float e1 = exp(-a1 * a1);',
    '        float f2 = f1 * 0.60 - w1 * 0.8;',
    '        float a2 = (d - f2) / w2;',
    '        float e2 = exp(-a2 * a2) * 0.55;',
    '        float ph = (d - f1) * (0.50 - 0.22 * sc);',
    '        float env = e1 + e2;',
    '        float s = sin(ph) * env * damp;',
    '        slope += cos(ph) * env * damp;',
    '        energy += env * damp;',
    '        tint += sin(ph + 0.9) * env * damp;',
    /* 波峰把像素往外推、波谷往内拉 —— 这才是「水」而不是光圈。
       圆心处 dv→0 时 normalize 方向会乱跳，必须用 cf 淡掉，
       否则落点会出现一个星形采样伪影。 */
    '        float cf = smoothstep(1.0, 7.0 + 16.0 * sc, d);',
    '        refr += normalize(dv + vec2(0.0001)) * s * cf;',
    /* 落点暗核与紧邻亮环也随雨滴收小，否则小涟漪会被中心光斑盖掉 */
    '        float a3 = d / (5.0 + 8.0 * sc);',
    '        slope -= exp(-a3 * a3) * exp(-age * 7.0) * w.w * 0.80;',
    '        float a4 = (d - f1 * 0.28 - 3.0 - 6.0 * sc) / (3.0 + 6.0 * sc);',
    '        slope += exp(-a4 * a4) * exp(-age * 5.0) * w.w * 0.90;',
    '      }',
    '    }',
    '  }',
    '  float L = clamp(slope / max(energy, 0.001), -1.0, 1.0);',
    '  float crest = smoothstep(0.12, 0.86, L);',
    '  float trough = smoothstep(0.12, 0.86, -L);',
    '  float spec = pow(crest, 5.0);',
    '  float strength = clamp(energy * 1.35, 0.0, 1.0);',
    '  refr = clamp(refr, vec2(-2.1), vec2(2.1));',
    '  if(uHasTex > 0.5){',
    /* 有纹理：这一层就是照片本身。UV 位移后 RGB 分通道错开采样，
       波峰处出现极淡色散；无波处 duv=0，与 CSS 背景像素完全一致。 */
    '    vec2 uv = coverUV(p);',
    '    vec2 duv = refr * 0.0135;',
    '    vec3 cR = texture2D(uTex, clamp(uv + duv * 1.06, 0.001, 0.999)).rgb;',
    '    vec3 cG = texture2D(uTex, clamp(uv + duv, 0.001, 0.999)).rgb;',
    '    vec3 cB = texture2D(uTex, clamp(uv + duv * 0.94, 0.001, 0.999)).rgb;',
    '    vec3 col = vec3(cR.r, cG.g, cB.b);',
    '    col += vec3(0.24, 0.46, 0.35) * crest * strength * 0.34;',
    '    col += vec3(0.78, 0.98, 0.90) * spec * strength * 0.18;',
    '    col *= 1.0 - trough * strength * 0.34;',
    '    col += vec3(0.05, 0.01, 0.10) * clamp(tint, 0.0, 1.0) * crest * 0.20;',
    '    gl_FragColor = vec4(col, 1.0);',
    '  } else {',
    /* 无纹理降级：透明层上只画明暗波列，CSS 照片背景仍在 */
    '    if(energy < 0.004) discard;',
    '    float a = clamp((crest * 0.92 + trough * 0.66 + spec * 0.30) * strength, 0.0, 0.94);',
    '    if(a < 0.012) discard;',
    '    vec3 col = vec3(0.035, 0.10, 0.075);',
    '    col = mix(col, vec3(0.72, 1.00, 0.86), crest);',
    '    col += vec3(0.95, 1.00, 0.97) * spec * 0.75;',
    '    col = mix(col, vec3(0.004, 0.026, 0.020), trough * 0.90);',
    '    gl_FragColor = vec4(col, a);',
    '  }',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  /* 照片纹理：同源加载，NPOT 用 CLAMP_TO_EDGE + LINEAR（WebGL1 不支持 mipmap）。
     不设 crossOrigin，避免 file:// 下反而触发 CORS 失败。 */
  function photoURL() {
    var s = document.querySelector('script[src*="water.js"]');
    try { return new URL('assets/background/bg.jpg', s ? s.src : location.href).href; }
    catch (e) { return 'assets/background/bg.jpg'; }
  }

  function setupTexture() {
    if (!W.gl || W.texReady) return;
    W.texReady = true;
    var gl = W.gl;
    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    /* 1×1 占位色，纹理真正就绪前 shader 走 uHasTex=0 分支，不会用到它 */
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([6, 20, 15, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.uniform1i(W.loc.tex, 0);
    W.tex = tex;

    /* 只有当 canvas 成功挂进 #photo-bg，才允许接管整张背景；
       否则保持透明叠加模式，避免盖住 #stage 与粒子层。 */
    var inPhoto = !!(W.cv.parentNode && W.cv.parentNode.id === 'photo-bg');
    var img = new Image();
    img.onload = function () {
      if (!W.gl || !W.tex) return;
      try {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, W.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      } catch (e) { return; }           /* 跨域 / 上下文丢失 → 保持降级 */
      W.texW = img.naturalWidth || 1200;
      W.texH = img.naturalHeight || 1510;
      if (!inPhoto) return;
      W.hasTex = true;
      var pb = document.getElementById('photo-bg');
      if (pb) pb.classList.add('water-live');
      document.documentElement.classList.add('water-live');
      draw(performance.now());          /* 立刻铺一层无波的原始照片 */
    };
    img.onerror = function () { /* 静默：CSS 照片背景不受影响 */ };
    img.src = photoURL();
  }

  function initGL() {
    W.glTried = true;          /* 一旦取过 WebGL context，这个 canvas 就不能再取 2D */
    var opts = { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true };
    var gl = W.cv.getContext('webgl', opts)
      || W.cv.getContext('experimental-webgl', opts);
    if (!gl) return false;
    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var a = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    W.gl = gl; W.prog = prog;
    W.loc = {
      res: gl.getUniformLocation(prog, 'uRes'),
      dpr: gl.getUniformLocation(prog, 'uDpr'),
      time: gl.getUniformLocation(prog, 'uTime'),
      waves: gl.getUniformLocation(prog, 'uWaves[0]'),
      scale: gl.getUniformLocation(prog, 'uScale[0]'),
      tex: gl.getUniformLocation(prog, 'uTex'),
      texSize: gl.getUniformLocation(prog, 'uTexSize'),
      hasTex: gl.getUniformLocation(prog, 'uHasTex')
    };
    W.mode = 'webgl';
    setupTexture();
    return true;
  }

  /* 2D 降级：同一个波列模型，改用多组明暗椭圆环绘制 */
  function init2D() {
    var ctx = W.cv.getContext('2d');
    if (!ctx) return false;
    W.ctx = ctx; W.mode = '2d';
    return true;
  }

  function resize() {
    W.w = window.innerWidth; W.h = window.innerHeight;
    W.dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    W.cv.width = Math.max(1, Math.floor(W.w * W.dpr));
    W.cv.height = Math.max(1, Math.floor(W.h * W.dpr));
    W.cv.style.width = W.w + 'px';
    W.cv.style.height = W.h + 'px';
    if (W.gl) W.gl.viewport(0, 0, W.cv.width, W.cv.height);
    if (W.ctx) W.ctx.setTransform(W.dpr, 0, 0, W.dpr, 0, 0);
  }

  function draw2D(t) {
    var ctx = W.ctx;
    ctx.clearRect(0, 0, W.w, W.h);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    for (var i = 0; i < W.waves.length; i++) {
      var q = W.waves[i];
      var sc = q.s || 0;
      var age = t - q.t;
      var life = 1.05 + 1.55 * sc;
      if (age < 0 || age > life) continue;
      var damp = Math.exp(-age * (2.05 - 0.65 * sc)) * q.a;
      var vmax = 52 + 300 * sc;
      var front0 = vmax * (1 - Math.exp(-age * 3.6));
      var gap = 5 + 9 * sc, ringW = 6 + 12 * sc;
      for (var k = 0; k < 5; k++) {
        /* 雨滴：细密 3~4 圈、环距 5px；连点后按 scale 放大 */
        var front = front0 - k * gap;
        if (front < 2) continue;
        var alpha = damp * Math.exp(-Math.pow(k * gap / ringW, 2)) * (k < 2 ? 0.30 : 0.15);
        if (alpha < 0.004) continue;
        ctx.beginPath();
        ctx.ellipse(q.x, q.y, front, front / 1.22, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(178,255,220,' + alpha.toFixed(3) + ')';
        ctx.lineWidth = 1.4 + k * 0.35 + sc * 1.6;
        ctx.shadowBlur = 6 + sc * 6; ctx.shadowColor = 'rgba(95,220,171,.55)';
        ctx.stroke();
        /* 紧邻的暗边：水面凹陷，质感的关键 */
        ctx.beginPath();
        ctx.ellipse(q.x, q.y, front + gap * 0.55, (front + gap * 0.55) / 1.22, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(3,20,14,' + (alpha * 0.55).toFixed(3) + ')';
        ctx.lineWidth = 2.4 + k * 0.5 + sc * 2;
        ctx.shadowBlur = 0;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function draw(now) {
    var t = (now - W.t0) / 1000;
    for (var i = W.waves.length - 1; i >= 0; i--) {
      var qi = W.waves[i];
      if (t - qi.t > (1.05 + 1.55 * (qi.s || 0))) W.waves.splice(i, 1);
    }
    if (W.gl) {
      var gl = W.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      var data = new Float32Array(MAX_WAVES * 4);
      var scales = new Float32Array(MAX_WAVES);
      for (var j = 0; j < W.waves.length && j < MAX_WAVES; j++) {
        var q = W.waves[j], o = j * 4;
        data[o] = q.x; data[o + 1] = q.y; data[o + 2] = q.t; data[o + 3] = q.a;
        scales[j] = q.s || 0;
      }
      if (W.tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, W.tex);
      }
      gl.uniform2f(W.loc.res, W.w, W.h);
      gl.uniform1f(W.loc.dpr, W.dpr);
      gl.uniform1f(W.loc.time, t);
      gl.uniform4fv(W.loc.waves, data);
      gl.uniform1fv(W.loc.scale, scales);
      gl.uniform2f(W.loc.texSize, W.texW, W.texH);
      gl.uniform1f(W.loc.hasTex, W.hasTex ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else if (W.ctx) {
      draw2D(t);
    }
  }

  function frame(now) {
    W.raf = 0;
    draw(now);
    /* 最后一帧把过期波清掉：纹理模式下回到无扰动的原始照片，
       叠加模式下整层透明，不会留下残影。 */
    if (!W.paused && W.waves.length) W.raf = window.requestAnimationFrame(frame);
  }

  function kick() {
    if (!W.paused && W.ok && !W.raf && W.waves.length) {
      W.raf = window.requestAnimationFrame(frame);
    }
  }

  function ripple(x, y, amp) {
    if (REDUCED || !W.ok) return false;
    var now = performance.now();
    var gap = W.lastTap ? (now - W.lastTap) / 1000 : 1e6;
    /* 停手 2.4s 就回到「第一滴雨」；连点则热度累积，之后每一滴都比前一滴大 */
    W.charge = gap > CHARGE_HOLD ? 0 : W.charge * Math.exp(-gap * 0.85);
    var scale = W.charge;
    W.charge = Math.min(1, W.charge + CHARGE_STEP);
    W.lastTap = now;
    W.lastScale = scale;
    W.waves.push({ x: x, y: y, t: (now - W.t0) / 1000, a: amp || 1, s: scale });
    if (W.waves.length > MAX_WAVES) W.waves.shift();
    W.seq++;
    kick();
    return true;
  }

  function init() {
    if (W.ready) return W.ok;
    W.ready = true;
    W.cv = document.createElement('canvas');
    W.cv.id = 'water-canvas';
    W.cv.setAttribute('aria-hidden', 'true');
    /* 插到 #photo-bg 内、.photo-veil 之前：canvas 成为「水面」本体，
       CSS 的 filter 与深绿遮罩照常作用，又不会盖住 #stage / 粒子 / 流星。 */
    var pb = document.getElementById('photo-bg');
    if (pb) pb.insertBefore(W.cv, pb.firstChild);
    else document.body.appendChild(W.cv);

    W.t0 = performance.now();
    if (!initGL()) {
      if (W.glTried) {           /* 取过 WebGL context 的 canvas 锁死 2D，重建 */
        var fresh = W.cv.cloneNode(false);
        W.cv.parentNode.replaceChild(fresh, W.cv);
        W.cv = fresh;
      }
      if (!init2D()) { W.cv.style.display = 'none'; return false; }
    }
    resize();
    window.addEventListener('resize', function () { resize(); draw(performance.now()); }, { passive: true });
    W.ok = true;
    draw(performance.now());     /* 纹理已就绪时铺静态照片，否则透明 */
    return true;
  }

  function start() {
    /* head 里的外部 SDK 脚本会阻塞 DOMContentLoaded，不能只等那一个事件：
       body 一存在就立刻尝试，幂等，多个事件只是重复确认。 */
    if (!document.body) return false;
    if (!W.ready && !init()) return false;
    W.paused = false;
    if (REDUCED) { draw(performance.now()); return true; }
    kick();
    return true;
  }

  function stop() {
    W.paused = true;
    if (W.raf) { window.cancelAnimationFrame(W.raf); W.raf = 0; }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else if (W.ready && !REDUCED) { W.paused = false; draw(performance.now()); kick(); }
  }, false);

  /* 幂等启动：立即 + DOMContentLoaded + load + 兜底轮询。
     外部 CDN 卡住时也不会让水波层迟迟不就绪。 */
  function boot() { try { start(); } catch (e) { /* 单次失败由后续事件重试 */ } }
  boot();
  document.addEventListener('DOMContentLoaded', boot, false);
  window.addEventListener('load', boot, false);
  window.setTimeout(boot, 60);
  window.setTimeout(boot, 400);
  window.setTimeout(boot, 1600);

  window.INNERSCAPE_WATER = {
    start: start, stop: stop, ripple: ripple,
    get status() {
      return {
        available: W.ok, running: !!W.raf, reduced: REDUCED,
        mode: W.mode, textured: W.hasTex, waves: W.waves.length, emitted: W.seq,
        /* scale = 最近这一滴的扩张系数，charge = 当前累积热度 */
        scale: W.lastScale, charge: W.charge
      };
    }
  };
})();
