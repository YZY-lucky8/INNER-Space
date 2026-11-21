/**
 * app.js —— INNERSCAPE 前端唯一脚本入口。
 * 由 cloud.config.js + api.js + particles.js + water.js + ambient.js + human3.js 合并而成。
 * 各分区均为独立 IIFE，仅通过 window 上的约定名通信：
 *   window.INNERSPACE_CLOUD_CONFIG / INNERSPACE_API / INNERSCAPE_PARTICLES
 *   INNERSCAPE_WATER / INNERSCAPE_AMBIENT / HUMAN3
 * 分区顺序即原 index.html 中的加载顺序，勿随意调换。
 */


// ==================== 分区：cloud.config.js ====================
/* 云服务公开配置。
   这些值来自 workbuddy_cloud_service 激活后返回的 publicConfig，
   仅标识「哪个应用」，本身不带权限；服务端按来源域名做精确校验。
   不含任何长期密钥，可以随前端一起发布。 */
window.INNERSPACE_CLOUD_CONFIG = {
  endpoint: 'https://wbapp-awhpxwizaotbydtn10fn7g.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_aWhpxwIzAoTBydtn10Fn7g_qw46Z7IuO8nH82AWAcJmRoqi33Ie0TMt'
};


// ==================== 分区：api.js ====================
/* =========================================================
   api.js —— INNERSCAPE 前端 API 客户端 + 显式云同步入口
   ---------------------------------------------------------
   设计红线（与 README §12 一致）：
   · 默认离线。file:// 打开时一个网络请求都不发。
   · 卡点描述 / 实验记录 / 身份证据只在 localStorage，
     只有用户在这里显式登录并点「同步到云端」才会上传。
   · access token 只存内存，refresh token 只进 httpOnly cookie，
     页面永不接触任何 API Key 或长期密钥。
   · 4xx 不重试；5xx 最多 3 次；401 自动刷新一次；断网给离线提示。
   ========================================================= */
(function () {
  'use strict';

  var CONFIG = window.INNERSPACE_API_CONFIG || {};
  var CANDIDATE_BASES = [];
  if (CONFIG.base) CANDIDATE_BASES.push(String(CONFIG.base).replace(/\/+$/, ''));
  CANDIDATE_BASES.push('/api/v1');
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    CANDIDATE_BASES.push('http://localhost:8787/api/v1');
  }

  var state = {
    base: null,
    enabled: false,
    features: { sync: false, ai: false, forum: false, otpDeliverable: false },
    accessToken: null,       // 只在内存，刷新页面即失效，用 cookie 静默续期
    user: null,
    revision: 0,
    busy: false,
    probed: false,
  };

  var ERROR_TEXT = {
    BAD_REQUEST: '提交的内容不太对，检查一下再试',
    VALIDATION_FAILED: '提交的内容不符合要求，请修改后再试',
    UNAUTHORIZED: '登录状态失效，请重新登录',
    FORBIDDEN: '没有权限执行这个操作',
    NOT_FOUND: '没有找到这条记录',
    CONFLICT: '云端数据与本机不一致，请先取回云端数据',
    RATE_LIMITED: '操作太频繁，请稍后再试',
    SERVICE_UNAVAILABLE: '服务暂时不可用，已自动使用本地结果',
    DB_UNAVAILABLE: '数据库还没启动，请先运行 npm run db:init',
    SAFETY_BLOCKED: '这段内容先不发布。如果你现在很难受，建议直接联系页面上给出的求助渠道',
    SMTP_NOT_CONFIGURED: '邮件服务未配置，验证码登录暂不可用',
    INTERNAL_ERROR: '服务出了点问题，请稍后再试',
  };

  function friendly(err) {
    if (!err) return '网络异常，请稍后再试';
    if (err.code === 'SAFETY_BLOCKED') return ERROR_TEXT.SAFETY_BLOCKED;
    if (err.details && err.details.code === 'AI_DISABLED') return '模型未配置，已使用规则引擎结果';
    return ERROR_TEXT[err.code] || err.message || '请求没有成功，请稍后再试';
  }

  function bridge() { return window.__INNERSPACE_BRIDGE || null; }
  function notify(msg) {
    var b = bridge();
    if (b && typeof b.toast === 'function') b.toast(msg);
    else if (window.console) console.info('[INNERSPACE] ' + msg);
  }

  /* ---------- 底层请求：重试 / 401 刷新 / 错误映射 ---------- */
  var refreshPromise = null;

  function raw(path, options) {
    var opts = options || {};
    var headers = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.accessToken) headers.Authorization = 'Bearer ' + state.accessToken;
    return fetch(state.base + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'include',
      cache: 'no-store',
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (json) {
        return { status: r.status, json: json };
      });
    });
  }

  function doRefresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = raw('/auth/refresh', { method: 'POST' })
      .then(function (res) {
        if (res.status >= 200 && res.status < 300 && res.json.ok) {
          state.accessToken = res.json.data.accessToken;
          state.user = res.json.data.user || state.user;
          return true;
        }
        state.accessToken = null;
        state.user = null;
        return false;
      })
      .catch(function () { state.accessToken = null; state.user = null; return false; })
      .then(function (v) { refreshPromise = null; return v; });
    return refreshPromise;
  }

  function request(path, options) {
    if (!state.enabled) return Promise.reject({ code: 'OFFLINE', message: '当前是纯离线模式' });
    var opts = options || {};
    var attempts = 0;
    var refreshed = false;

    function attempt() {
      return raw(path, opts).then(function (res) {
        var json = res.json || {};
        if (res.status >= 200 && res.status < 300 && json.ok !== false) return json.data;

        if (res.status === 401 && !refreshed && !opts.skipRefresh) {
          refreshed = true;
          return doRefresh().then(function (oken) {
            if (!oken) throw { code: 'UNAUTHORIZED', message: '登录已过期' };
            return attempt();
          });
        }
        var err = json.error || { code: 'HTTP_' + res.status, message: '请求没有成功' };
        var wrapped = { code: err.code, message: friendly(err), details: err.details, status: res.status };
        // 4xx 不重试；5xx 自动重试最多 3 次
        if (res.status >= 500 && attempts < 3) {
          attempts++;
          return new Promise(function (resolve) { setTimeout(resolve, 200 * attempts); }).then(attempt);
        }
        throw wrapped;
      });
    }
    return attempt().catch(function (e) {
      if (e && typeof e === 'object' && e.code) throw e;
      notify('连不上本地后端，当前继续用本机数据');
      throw { code: 'OFFLINE', message: '连不上本地后端' };
    });
  }

  /* ---------- 后端探测：只探测公开配置，不上传任何个人数据 ---------- */
  function probe() {
    if (state.probed) return Promise.resolve(state.enabled);
    state.probed = true;
    if (location.protocol === 'file:') return Promise.resolve(false); // file:// 绝对不发请求
    if (typeof fetch !== 'function') return Promise.resolve(false);

    var i = 0;
    function tryNext() {
      if (i >= CANDIDATE_BASES.length) return Promise.resolve(false);
      var base = CANDIDATE_BASES[i++];
      return fetch(base + '/config', { credentials: 'include', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (json) {
          if (json && json.ok && json.data) {
            state.base = base;
            state.enabled = true;
            state.features = json.data.features || state.features;
            return true;
          }
          return tryNext();
        })
        .catch(function () { return tryNext(); });
    }
    return tryNext();
  }

  /* ---------- 公开 API ---------- */
  var api = {
    isEnabled: function () { return state.enabled; },
    features: function () { return state.features; },
    user: function () { return state.user; },
    revision: function () { return state.revision; },
    setRevision: function (r) { state.revision = Number(r) || 0; },
    probe: probe,

    auth: {
      requestOtp: function (email) { return request('/auth/otp/request', { method: 'POST', body: { email: email } }); },
      verifyOtp: function (email, code) {
        return request('/auth/otp/verify', { method: 'POST', body: { email: email, code: code }, skipRefresh: true })
          .then(function (d) {
            state.accessToken = d.accessToken;
            state.user = d.user;
            return d;
          });
      },
      me: function () { return request('/auth/me'); },
      logout: function () {
        return request('/auth/logout', { method: 'POST' })
          .catch(function () { return null; })
          .then(function () { state.accessToken = null; state.user = null; state.revision = 0; });
      },
    },

    sync: {
      state: function () { return request('/sync/state'); },
      pull: function () { return request('/sync/pull'); },
      push: function (snapshot, baseRevision) {
        return request('/sync/push', {
          method: 'POST',
          body: { snapshot: snapshot, baseRevision: baseRevision || 0, clientSentAt: new Date().toISOString() },
        });
      },
      clear: function () { return request('/sync', { method: 'DELETE' }); },
    },

    diagnose: function (payload) { return request('/diagnose', { method: 'POST', body: payload }); },
    actions: function (payload) { return request('/diagnose/actions', { method: 'POST', body: payload }); },

    /* Human 3.0：措辞精修静默降级；匿名分布必须用户显式点「加入」才写 */
    human3: {
      actions: function (payload) { return request('/human3/actions', { method: 'POST', body: payload }); },
      submitAssessment: function (payload) { return request('/human3/assessments', { method: 'POST', body: payload }); },
      distribution: function () { return request('/human3/distribution'); },
    },
  };

  window.INNERSPACE_API = api;

  /* =========================================================
     云同步面板：动态注入，不改动主站任何渲染函数
     ========================================================= */
  /* v4：与主站同一套「编辑式暗夜档案」令牌 —— 墨黑纸面 / 朱砂 / 等宽标签 / 直角 */
  var CSS = [
    '#is-btn{position:fixed;right:16px;bottom:16px;z-index:9998;padding:9px 14px;border-radius:2px;',
    'border:1px solid rgba(242,237,226,.26);background:rgba(20,24,21,.94);color:#eafff6;',
    'font:11px/1.2 "IBM Plex Mono","SFMono-Regular",Consolas,monospace;letter-spacing:.1em;cursor:pointer;',
    'box-shadow:0 8px 24px rgba(0,0,0,.45);transition:border-color .2s,color .2s,transform .2s}',
    '#is-btn:hover{border-color:#5fdcab;color:#5fdcab;transform:translateY(-2px)}',
    '#is-btn:focus-visible{outline:2px solid #5fdcab;outline-offset:3px}',
    '#is-btn.on{color:#5fdcab;border-color:rgba(95,220,171,.55)}',
    '#is-panel{position:fixed;right:16px;bottom:62px;z-index:9999;width:min(340px,calc(100vw - 32px));',
    'max-height:min(74vh,560px);overflow:auto;border-radius:3px;padding:20px;',
    'border:1px solid rgba(242,237,226,.18);border-left:2px solid #5fdcab;',
    'background:rgba(20,24,21,.97);color:#eafff6;',
    'font:13px/1.7 "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;',
    'box-shadow:0 24px 64px rgba(0,0,0,.62)}',
    '#is-panel h3{margin:0 0 6px;font-size:19px;font-weight:700;letter-spacing:-.02em;',
    'font-family:"Songti SC","STSong","Noto Serif CJK SC","SimSun",Georgia,serif;color:#eafff6}',
    '#is-panel .is-dim{color:#8fb8a5;font-size:12px;line-height:1.6}',
    '#is-panel .is-box{margin-top:12px;padding:12px;border-radius:2px;background:rgba(242,237,226,.035);',
    'border:1px solid rgba(242,237,226,.12)}',
    '#is-panel input{width:100%;box-sizing:border-box;margin:6px 0;padding:10px 11px;border-radius:2px;',
    'border:1px solid rgba(242,237,226,.15);background:rgba(10,12,11,.5);color:#eafff6;font:inherit;outline:none}',
    '#is-panel input:focus{border-color:#5fdcab;box-shadow:0 0 0 3px rgba(95,220,171,.12)}',
    '#is-panel button.is-a{width:100%;margin-top:8px;padding:11px;border-radius:2px;cursor:pointer;',
    'border:1px solid #5fdcab;background:#5fdcab;color:#06231a;font:inherit;font-weight:600;letter-spacing:.06em;',
    'transition:background .2s,letter-spacing .2s}',
    '#is-panel button.is-a:hover{background:#ff8a63;letter-spacing:.1em}',
    '#is-panel button.is-g{width:100%;margin-top:6px;padding:9px;border-radius:2px;cursor:pointer;',
    'border:1px solid rgba(242,237,226,.12);background:transparent;color:#8fb8a5;font:inherit}',
    '#is-panel button.is-g:hover{color:#eafff6;border-color:rgba(242,237,226,.26)}',
    '#is-panel button:disabled{opacity:.45;cursor:default}',
    '#is-panel .is-close{float:right;border:0;background:none;color:#7c9c8c;font-size:18px;cursor:pointer;line-height:1}',
    '#is-panel .is-msg{margin-top:10px;padding:9px 11px;border-radius:2px;font-size:12px;',
    'background:rgba(95,220,171,.1);color:#a8f2d5;white-space:pre-wrap;border-left:2px solid #5fdcab}',
    '#is-panel .is-msg.err{background:rgba(224,150,150,.12);color:#f0b6b6;border-left-color:#e08a8a}',
    '#is-panel code{color:#ff8a63;font-size:11px;font-family:"IBM Plex Mono",Consolas,monospace}',
    '@media (max-width:520px){#is-btn{right:12px;bottom:12px;padding:7px 10px;font-size:10px}}',
  ].join('');

  var panel = null;
  var button = null;
  var msg = '';
  var msgErr = false;
  var otpSent = false;
  var devCode = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setMsg(text, isErr) { msg = text || ''; msgErr = !!isErr; paint(); }

  function paint() {
    if (!panel) return;
    var h = '<button class="is-close" id="is-close" aria-label="关闭">×</button><h3>云同步</h3>';
    h += '<div class="is-dim">默认纯离线。开启后，卡点描述、实验记录与身份证据才会上传到你自己的账号；不开启则一个字节都不会离开这台设备。</div>';

    if (!state.enabled) {
      h += '<div class="is-box"><div class="is-dim">没有探测到本地后端，当前继续用本机数据。<br><br>',
        '想启用：在 <code>server/</code> 下运行 <code>npm start</code>，然后打开 ',
        '<code>http://localhost:8787/</code>。</div>',
        '<button class="is-a" id="is-retry">重新探测</button></div>';
    } else if (!state.user) {
      h += '<div class="is-box">';
      h += '<div class="is-dim">后端已连接。用邮箱验证码登录一次，换设备用同一个邮箱即可找回身份。</div>';
      h += '<input id="is-email" type="email" placeholder="你的邮箱" autocomplete="email">';
      if (!otpSent) h += '<button class="is-a" id="is-send">获取验证码</button>';
      else {
        h += '<input id="is-code" inputmode="numeric" maxlength="6" placeholder="6 位验证码" value="' + esc(devCode) + '">';
        h += '<button class="is-a" id="is-login">登录并开启同步</button>';
        h += '<button class="is-g" id="is-resend">重新获取验证码</button>';
      }
      h += '</div>';
    } else {
      h += '<div class="is-box"><div class="is-dim">已登录：' + esc(state.user.email) +
        '<br>云端版本：' + state.revision + ' <span id="is-state-hint">（点下方刷新）</span></div>';
      h += '<button class="is-a" id="is-push">把本机数据同步到云端</button>';
      h += '<button class="is-a" id="is-pull">从云端取回并覆盖本机</button>';
      h += '<button class="is-g" id="is-state">刷新云端状态</button>';
      h += '<button class="is-g" id="is-clear">关闭同步并删除云端副本</button>';
      h += '<button class="is-g" id="is-logout">退出登录</button></div>';
    }

    if (msg) h += '<div class="is-msg' + (msgErr ? ' err' : '') + '">' + esc(msg) + '</div>';
    panel.innerHTML = h;
    bind();
  }

  function busy(v) { state.busy = v; paint(); }

  function on(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  function currentEmail() {
    var el = document.getElementById('is-email');
    return el ? String(el.value || '').trim() : '';
  }

  function bind() {
    on('is-close', function () { panel.style.display = 'none'; if (button) button.classList.remove('on'); });
    on('is-retry', function () { state.probed = false; probe().then(function () { setMsg(state.enabled ? '已连接本地后端' : '仍未探测到后端', !state.enabled); }); });
    on('is-send', function () { sendOtp(); });
    on('is-resend', function () { sendOtp(); });
    on('is-login', function () {
      if (state.busy) return;
      var codeEl = document.getElementById('is-code');
      var code = codeEl ? String(codeEl.value || '').trim() : '';
      if (!/^\d{6}$/.test(code)) { setMsg('验证码是 6 位数字', true); return; }
      busy(true); setMsg('正在登录…');
      api.auth.verifyOtp(currentEmail(), code).then(function () {
        otpSent = false; devCode = '';
        return api.sync.state();
      }).then(function (s) {
        state.revision = Number(s.revision || 0);
        busy(false); setMsg('登录成功。云端' + (s.hasRemoteData ? '已有数据，可以先点「从云端取回」' : '还没有数据') + '。');
      }).catch(function (e) { busy(false); setMsg(friendly(e), true); });
    });
    on('is-push', function () {
      if (state.busy) return;
      var b = bridge();
      if (!b || typeof b.getDB !== 'function') { setMsg('页面数据接口未就绪', true); return; }
      busy(true); setMsg('正在同步…');
      api.sync.push(b.getDB(), state.revision).then(function (r) {
        state.revision = Number(r.revision);
        busy(false);
        var a = r.applied || {};
        setMsg('已同步到云端。会话 ' + (a.sessions || 0) + ' · 实验 ' + (a.experiments || 0) +
          ' · 记录 ' + (a.logs || 0) + ' · 证据 ' + (a.evidence || 0) + ' 条。');
      }).catch(function (e) {
        busy(false);
        if (e.details && typeof e.details.serverRevision === 'number') {
          state.revision = e.details.serverRevision;
          setMsg('云端版本较新（v' + state.revision + '）。请先点「从云端取回」，或再点一次「同步到云端」用本机覆盖。', true);
        } else setMsg(friendly(e), true);
      });
    });
    on('is-pull', function () {
      if (state.busy) return;
      busy(true); setMsg('正在取回…');
      api.sync.pull().then(function (r) {
        state.revision = Number(r.revision || 0);
        if (!r.hasRemoteData || !r.snapshot) { busy(false); setMsg('云端还没有数据。', true); return; }
        var b = bridge();
        if (!b || typeof b.setDB !== 'function') { busy(false); setMsg('页面数据接口未就绪', true); return; }
        b.setDB(r.snapshot);
        busy(false); setMsg('已用云端数据覆盖本机，页面已刷新。');
      }).catch(function (e) { busy(false); setMsg(friendly(e), true); });
    });
    on('is-state', function () {
      api.sync.state().then(function (s) {
        state.revision = Number(s.revision || 0);
        setMsg('云端版本 v' + state.revision + (s.syncedAt ? '，上次同步 ' + String(s.syncedAt).slice(0, 19).replace('T', ' ') : '') + '。');
      }).catch(function (e) { setMsg(friendly(e), true); });
    });
    on('is-clear', function () {
      if (state.busy) return;
      if (!window.confirm('这会删除云端副本（本机数据保留）。确定吗？')) return;
      busy(true);
      api.sync.clear().then(function () { state.revision = 0; busy(false); setMsg('云端副本已删除，回到纯离线模式。'); })
        .catch(function (e) { busy(false); setMsg(friendly(e), true); });
    });
    on('is-logout', function () {
      api.auth.logout().then(function () { otpSent = false; setMsg('已退出登录，本机数据不受影响。'); });
    });
  }

  function sendOtp() {
    if (state.busy) return;
    var email = currentEmail();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setMsg('先填一个有效的邮箱', true); return; }
    busy(true);
    api.auth.requestOtp(email).then(function (r) {
      otpSent = true;
      devCode = r.devCode || '';
      busy(false);
      setMsg(r.channel === 'dev'
        ? '开发模式：验证码 ' + r.devCode + '（服务端日志也有记录，未冒充邮件发送）'
        : '验证码已发送，请在下方输入');
    }).catch(function (e) { busy(false); setMsg(friendly(e), true); });
  }

  function mount() {
    if (document.getElementById('is-btn')) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    button = document.createElement('button');
    button.id = 'is-btn';
    button.type = 'button';
    button.textContent = '云同步';
    button.title = '默认离线，点开可显式开启云端同步';
    document.body.appendChild(button);

    panel = document.createElement('div');
    panel.id = 'is-panel';
    panel.style.display = 'none';
    document.body.appendChild(panel);

    button.addEventListener('click', function () {
      var show = panel.style.display === 'none';
      panel.style.display = show ? 'block' : 'none';
      button.classList.toggle('on', show);
      if (show) paint();
    });

    paint();
  }

  function boot() {
    mount();
    probe().then(function (enabled) {
      if (!enabled) return null;
      // 有 refresh cookie 时静默恢复登录态，不打断离线体验
      return doRefresh().then(function (ok) {
        if (!ok) return null;
        return api.sync.state().then(function (s) {
          state.revision = Number(s.revision || 0);
        }).catch(function () { return null; });
      });
    }).then(function () { paint(); }).catch(function () { paint(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();


// ==================== 分区：particles.js ====================
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


// ==================== 分区：water.js ====================
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
    var s = document.querySelector('script[src*="app.js"]');
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


// ==================== 分区：ambient.js ====================
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


// ==================== 分区：human3.js ====================
/* =========================================================
   human3.js —— Human 3.0 四象限坐标（前端领域层 + #/map 视图）
   ---------------------------------------------------------
   · 4 象限 × 3 Traits = 12 格自评；所有读数、瓶颈、阻塞链、
     阶段、参考画像、最小有效剂量都是**确定性纯函数**，零 LLM。
   · 数据落在 localStorage 的 DB.human3（离线优先，不新增存储键）。
   · 自评坐标，不是测评：不显示分数 / 等级 / 百分比 / 诊断词。
   · 坐标图由本文件的 quadrantHtml() 直接输出纯 SVG：
     无 iframe、无 canvas、无第三方库，file:// 下可直接打开。
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

  /* ---------- 象限文案组装 ---------- */
  /* 把四个象限的专属文案、颜色、题干一并打包，供 model() 与外部调用取用 */
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
  /* ---------- 标准四象限坐标统计图（纯 SVG） ----------
     x 轴 = 个人 ← → 集体，y 轴 = 外在 ← → 内在：
     左上心智 / 右上精神 / 左下身体 / 右下使命。
     每个象限三个点，依次对应 知识 / 经验 / 技能 三格的读数（1–3）；
     没标过的格画成空心点并落在中线上。最费劲的那一块底色更亮。 */
  function quadrantHtml(a) {
    var W = 420, H = 320, cx = W / 2, cy = H / 2, sx = 52, sy = 46, s = '', i, qi, ti;
    function X(v) { return (cx + v * sx).toFixed(1); }
    function Y(v) { return (cy - v * sy).toFixed(1); }
    var quads = [
      { q: 'mind',     x: 0,  y: 0,  tx: 16,     ty: 26,     anchor: 'start' },
      { q: 'spirit',   x: cx, y: 0,  tx: W - 16, ty: 26,     anchor: 'end' },
      { q: 'body',     x: 0,  y: cy, tx: 16,     ty: H - 14, anchor: 'start' },
      { q: 'vocation', x: cx, y: cy, tx: W - 16, ty: H - 14, anchor: 'end' }
    ];
    /* 四块底色 + 象限名 + 这一块问的是什么 */
    for (qi = 0; qi < quads.length; qi++) {
      var u = quads[qi], short = QSUB[u.q].split('\u3000')[0];
      s += '<rect class="h3q-bg' + (a.bottleneck === u.q ? ' hot' : '') + '" x="' + u.x + '" y="' + u.y +
           '" width="' + (W / 2) + '" height="' + (H / 2) + '"/>';
      s += '<text class="h3q-name" x="' + u.tx + '" y="' + u.ty + '" text-anchor="' + u.anchor + '">' + QL[u.q] + '</text>';
      s += '<text class="h3q-sub" x="' + u.tx + '" y="' + (u.ty + 16) + '" text-anchor="' + u.anchor + '">' + short + '</text>';
    }
    /* 均匀方格 -3..3，主轴（十字）更亮 */
    for (i = -3; i <= 3; i++) {
      s += '<line class="h3q-g' + (i === 0 ? ' major' : '') + '" x1="' + X(i) + '" y1="0" x2="' + X(i) + '" y2="' + H + '"/>';
      s += '<line class="h3q-g' + (i === 0 ? ' major' : '') + '" x1="0" y1="' + Y(i) + '" x2="' + W + '" y2="' + Y(i) + '"/>';
    }
    /* 两轴箭头：数学统计图的标准记号 */
    s += '<path class="h3q-ar" d="M' + (W - 6) + ' ' + cy + ' l-11 -5.5 v11 z"/>';
    s += '<path class="h3q-ar" d="M' + cx + ' 6 l-5.5 11 h11 z"/>';
    /* 1–3 读数标尺 */
    for (i = 1; i <= 3; i++) {
      s += '<text class="h3q-tk" x="' + (cx + 5) + '" y="' + (cy - i * sy + 4) + '">' + i + '</text>';
      s += '<text class="h3q-tk" x="' + X(-i) + '" y="' + (cy + 15) + '" text-anchor="middle">' + i + '</text>';
      s += '<text class="h3q-tk" x="' + X(i) + '" y="' + (cy + 15) + '" text-anchor="middle">' + i + '</text>';
    }
    /* 12 格读数 → 每象限 3 个点用折线串起来 */
    var sign = { mind: 1, spirit: 1, body: -1, vocation: -1 };
    var offs = { mind: [-2.4, -1.5, -0.6], spirit: [0.6, 1.5, 2.4], body: [-2.4, -1.5, -0.6], vocation: [0.6, 1.5, 2.4] };
    for (qi = 0; qi < Q.length; qi++) {
      var q = Q[qi], pts = [], poly = [], pt;
      for (ti = 0; ti < T.length; ti++) {
        var v = a.grid[q] ? a.grid[q][T[ti]] : null;
        pt = { x: cx + offs[q][ti] * sx, y: cy - (v ? v * sign[q] * sy : 0), v: v, t: T[ti] };
        pts.push(pt);
        poly.push(pt.x.toFixed(1) + ',' + pt.y.toFixed(1));
      }
      s += '<polyline class="h3q-ln q' + qi + '" points="' + poly.join(' ') + '"/>';
      for (ti = 0; ti < pts.length; ti++) {
        s += '<circle class="h3q-pt q' + qi + (pts[ti].v ? '' : ' empty') + '" cx="' + pts[ti].x.toFixed(1) +
             '" cy="' + pts[ti].y.toFixed(1) + '" r="5"><title>' + QL[q] + ' · ' + TL[pts[ti].t] + '：' +
             (pts[ti].v ? pts[ti].v + ' / 3' : '还没标') + '</title></circle>';
      }
    }
    return '<svg class="h3q" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" ' +
           'role="img" aria-label="四象限坐标统计图：12 格自评读数">' + s + '</svg>';
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
    /* 这一页就是 12 格自评页：坐标图、读数、报告都在这张单页里完成 */
    h += '<div class="topbar"><div class="brand"><span class="dot"></span>卡点 · 12 格自评</div>' +
      '<div><button class="ghost" data-act="nav" data-to="landing">← 回到开头</button></div></div>';

    h += '<div class="h3-hero card soft reveal">';
    h += '<div class="eyebrow"><i></i>人生坐标 · 标准四象限坐标图</div>';
    h += '<h1 class="mt12">把你此刻的样子，<br>标进坐标里。</h1>';
    h += '<p class="hero-sub mt12">心智 / 身体 / 精神 / 使命，各标三格。12 个读数会画成' +
      '一张标准笛卡尔四象限统计图——每个点落在哪、哪一块还空着，都由你刚才标的决定。这是自评坐标，不是测评。</p>';
    h += '<div class="h3-stage" id="h3-quad-host">' + quadrantHtml(a) + '</div>';
    h += '<div class="h3-stage-bar">';
    h += '<span class="tiny dim">横轴 个人 ↔ 集体 · 纵轴 外在 ↔ 内在 · 每象限三点依次是知识 / 经验 / 技能 · 鼠标停在点上可看读数</span>';
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

  /* ---------- 局部刷新（只换 DOM 片段，不抢输入焦点） ---------- */
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
    var qd = document.getElementById('h3-quad-host');
    if (qd) qd.innerHTML = quadrantHtml(a);
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

  document.addEventListener('input', onInput, false);
  document.addEventListener('change', onInput, false);

  window.HUMAN3 = {
    QUADRANTS: Q, TRAITS: T, LABELS: QL,
    QPROMPT: QPROMPT, QNOTES: QNOTES, QSELF: QSELF,
    promptOf: promptOf, choiceOf: choiceOf, modelExtras: modelExtras,
    defaultDB: defaultDB, normalize: normalize,
    readGrid: readGrid, bottleneck: bottleneck, blockedBy: blockedBy,
    inferPhase: inferPhase, traitBalance: traitBalance, archetype: archetype,
    makeDose: makeDose, filled: filled,
    ensure: ensure, current: current, recalc: recalc, model: model,
    render: render, action: action, refresh: refresh, quadrantHtml: quadrantHtml
  };
})();
