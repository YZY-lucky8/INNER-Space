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
