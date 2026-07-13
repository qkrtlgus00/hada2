'use strict';

const { app, BrowserWindow, ipcMain, Notification, shell, safeStorage, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const https = require('https');

// 숨은 창에서 유튜브 오디오를 자동재생하려면 사용자 제스처 요구를 꺼야 함
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 데이터 파일 경로: OS별 사용자 데이터 폴더 안에 저장
const DATA_FILE = path.join(app.getPath('userData'), 'data.json');
// Google 연동 파일: 자격증명(clientId/secret)과 토큰
const GCONF_FILE = path.join(app.getPath('userData'), 'google-config.json');
const GTOKEN_FILE = path.join(app.getPath('userData'), 'google-tokens.json');
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

// ---- 앱 자체 업데이트 (GitHub raw에서 파일 받아 덮어쓰기) ----
const UP_OWNER = 'qkrtlgus00';
const UP_REPO = 'hada2';
const UP_BRANCH = 'claude/program-recommendations-f6xz4n';
const UP_FILES = ['src/main.js', 'src/preload.js', 'src/renderer.js', 'src/index.html', 'src/styles.css', 'package.json'];
const UP_BASE = `https://raw.githubusercontent.com/${UP_OWNER}/${UP_REPO}/${UP_BRANCH}/`;
const APP_ROOT = path.join(__dirname, '..'); // package.json이 있는 폴더

// "1.2.10" > "1.2.2" 처럼 숫자 단위 비교 (remote가 더 최신이면 true)
function isNewerVersion(remote, local) {
  const pa = String(remote || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(local || '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const a = pa[i] || 0, b = pb[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}
// GitHub raw 텍스트 다운로드 (캐시 무시, 10초 타임아웃)
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(),
      { headers: { 'User-Agent': 'hada2-updater', 'Cache-Control': 'no-cache' } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
        let data = ''; res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve(data));
      });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('TIMEOUT')); });
  });
}
async function remoteVersion() {
  const txt = await fetchText(UP_BASE + 'package.json');
  const v = JSON.parse(txt).version;
  if (!v) throw new Error('NO_VERSION');
  return String(v);
}
ipcMain.handle('update:check', async () => {
  try {
    const latest = await remoteVersion();
    const current = app.getVersion();
    return { ok: true, current, latest, updateAvailable: isNewerVersion(latest, current) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('update:apply', async () => {
  try {
    // 1) 모두 받아서 메모리에 (하나라도 실패하면 아무것도 안 바꿈)
    const payload = [];
    for (const rel of UP_FILES) {
      const dest = path.normalize(path.join(APP_ROOT, rel));
      if (!dest.startsWith(APP_ROOT)) throw new Error('BAD_PATH ' + rel); // 경로 이탈 차단
      payload.push({ dest, text: await fetchText(UP_BASE + rel) });
    }
    // 2) 원자적으로 쓰기 (tmp → rename)
    for (const p of payload) {
      const tmp = p.dest + '.tmp-update';
      await fsp.mkdir(path.dirname(p.dest), { recursive: true });
      await fsp.writeFile(tmp, p.text, 'utf8');
      await fsp.rename(tmp, p.dest);
    }
    // 3) 새 코드로 재시작
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

let mainWindow = null;
let appBaseUrl = null; // 로컬 http 서버 주소

// 앱 파일을 http://127.0.0.1 로 서빙 (유튜브 임베드가 file:// 출처를 거부하므로)
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
};
function startAppServer() {
  return new Promise((resolve, reject) => {
    const root = __dirname;
    const server = http.createServer(async (req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        // 경로 traversal 방지: root 밖 접근 차단
        const filePath = path.normalize(path.join(root, urlPath));
        if (!filePath.startsWith(root)) { res.statusCode = 403; res.end('forbidden'); return; }
        const data = await fsp.readFile(filePath);
        res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
        res.end(data);
      } catch (_) { res.statusCode = 404; res.end('not found'); }
    });
    const onListen = () => {
      appBaseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve(appBaseUrl);
    };
    let fellBack = false;
    server.on('error', (err) => {
      // 고정 포트가 사용 중이면 임의 포트로 1회 폴백
      if (!fellBack && err && err.code === 'EADDRINUSE') {
        fellBack = true;
        server.listen(0, '127.0.0.1', onListen);
      } else {
        reject(err);
      }
    });
    // 고정 포트(47821) 우선 → origin이 매 실행 동일 → 설정 유지에 유리
    server.listen(47821, '127.0.0.1', onListen);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 480,
    minHeight: 400,
    title: '하다 — 할 일 & 메모',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`${appBaseUrl}/index.html`);

  mainWindow.on('closed', () => {
    mainWindow = null;
    // 숨은 음악 재생 창이 남아 앱이 안 꺼지는 것 방지
    if (ytWindow && !ytWindow.isDestroyed()) ytWindow.close();
  });
}

/**
 * data.json 을 읽어 저장된 객체(예: { events: [...] })를 그대로 반환.
 * 파일이 없거나 손상됐으면 빈 객체를 돌려준다. (형식 변환은 렌더러가 처리)
 */
async function loadData() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {};
    }
    // 손상된 파일: 덮어쓰지 않도록 백업 후 빈 객체 반환
    try {
      await fsp.rename(DATA_FILE, `${DATA_FILE}.corrupt-${Date.now()}`);
    } catch (_) {
      /* 백업 실패는 무시 */
    }
    return {};
  }
}

/**
 * 원자적 저장: 임시 파일에 쓴 뒤 rename 으로 교체.
 * 쓰는 도중 프로세스가 죽어도 기존 파일이 손상되지 않는다.
 */
async function saveData(data) {
  const safe = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  const dir = path.dirname(DATA_FILE);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = `${DATA_FILE}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(safe, null, 2), 'utf-8');
  await fsp.rename(tmp, DATA_FILE);
  return true;
}

// ---- IPC 핸들러 ----
ipcMain.handle('data:load', async () => {
  return loadData();
});

ipcMain.handle('data:save', async (_event, data) => {
  return saveData(data);
});

ipcMain.handle('notify', async (_event, payload) => {
  const { title, body } = payload || {};
  if (!Notification.isSupported()) return false;
  const n = new Notification({
    title: title || '하다',
    body: body || '',
  });
  n.show();
  return true;
});

// ========================= Google 캘린더 연동 =========================
let _google = null;
function getGoogle() {
  if (!_google) _google = require('googleapis').google; // 지연 로드 (설치돼 있어야 함)
  return _google;
}

async function readJson(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf-8')); }
  catch (_) { return null; }
}
async function writeJson(file, obj) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(obj), 'utf-8');
}

// 토큰 저장 (safeStorage 사용 가능하면 암호화)
async function saveTokens(tokens) {
  const raw = JSON.stringify(tokens);
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    await writeJson(GTOKEN_FILE, { enc: safeStorage.encryptString(raw).toString('base64') });
  } else {
    await writeJson(GTOKEN_FILE, { raw });
  }
}
async function loadTokens() {
  const d = await readJson(GTOKEN_FILE);
  if (!d) return null;
  if (d.enc && safeStorage && safeStorage.isEncryptionAvailable()) {
    try { return JSON.parse(safeStorage.decryptString(Buffer.from(d.enc, 'base64'))); }
    catch (_) { return null; }
  }
  if (d.raw) { try { return JSON.parse(d.raw); } catch (_) { return null; } }
  return null;
}

// 저장된 토큰으로 인증된 OAuth2 클라이언트 (자동 refresh 저장)
async function authedClient() {
  const conf = await readJson(GCONF_FILE);
  const tokens = await loadTokens();
  if (!conf || !conf.clientId || !tokens) return null;
  const google = getGoogle();
  const client = new google.auth.OAuth2(conf.clientId, conf.clientSecret);
  client.setCredentials(tokens);
  client.on('tokens', (t) => {
    (async () => {
      const cur = (await loadTokens()) || {};
      await saveTokens({ ...cur, ...t });
    })().catch(() => {});
  });
  return client;
}

// loopback 리디렉션 OAuth 플로우 (앱 내 새 세션 로그인 창 → 시크릿 모드 불필요)
function runOAuth(clientId, clientSecret) {
  const google = getGoogle();
  return new Promise((resolve, reject) => {
    let client;
    let done = false;
    let authWin = null;
    const closeAuthWin = () => { if (authWin && !authWin.isDestroyed()) { authWin.destroy(); } authWin = null; };
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      const code = u.searchParams.get('code');
      const error = u.searchParams.get('error');
      if (!code && !error) { res.statusCode = 204; res.end(); return; }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:48px"><h2>✅ 연동 완료</h2><p>이 창을 닫고 앱으로 돌아가세요.</p></body>');
      done = true;
      try { server.close(); } catch (_) {}
      closeAuthWin();
      if (error) { reject(new Error(error)); return; }
      try { const { tokens } = await client.getToken(code); resolve(tokens); }
      catch (e) { reject(e); }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      client = new google.auth.OAuth2(clientId, clientSecret, `http://127.0.0.1:${port}`);
      const authUrl = client.generateAuthUrl({
        access_type: 'offline', prompt: 'select_account consent', scope: GOOGLE_SCOPES,
      });
      // 앱 내 로그인 창(비영구 partition = 로그아웃 상태 → 매번 계정 선택)
      authWin = new BrowserWindow({
        width: 480, height: 660,
        title: '구글 로그인',
        autoHideMenuBar: true,
        webPreferences: {
          partition: 'oauth-' + Date.now(),
          contextIsolation: true, nodeIntegration: false, sandbox: true,
        },
      });
      authWin.loadURL(authUrl);
      authWin.on('closed', () => {
        authWin = null;
        if (!done) { done = true; try { server.close(); } catch (_) {} reject(new Error('CANCELED')); }
      });
    });
    // 5분 타임아웃
    setTimeout(() => { if (!done) { done = true; try { server.close(); } catch (_) {} closeAuthWin(); reject(new Error('TIMEOUT')); } }, 5 * 60 * 1000);
  });
}

async function fetchPrimaryEmail(client) {
  try {
    const google = getGoogle();
    const cal = google.calendar({ version: 'v3', auth: client });
    const r = await cal.calendarList.get({ calendarId: 'primary' });
    return r.data && r.data.id;
  } catch (_) { return null; }
}

ipcMain.handle('google:status', async () => {
  const conf = await readJson(GCONF_FILE);
  const tokens = await loadTokens();
  return { hasCreds: !!(conf && conf.clientId && conf.clientSecret), connected: !!tokens };
});

ipcMain.handle('google:saveConfig', async (_e, cfg) => {
  const clientId = (cfg && cfg.clientId || '').trim();
  const clientSecret = (cfg && cfg.clientSecret || '').trim();
  if (!clientId || !clientSecret) return { ok: false, error: 'EMPTY' };
  // 방어적 형식 검증 — 잘못된 ID로 인한 invalid_client 조기 차단
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) return { ok: false, error: 'BAD_CLIENT_ID' };
  await writeJson(GCONF_FILE, { clientId, clientSecret });
  return { ok: true };
});

ipcMain.handle('google:signIn', async () => {
  const conf = await readJson(GCONF_FILE);
  if (!conf || !conf.clientId || !conf.clientSecret) return { ok: false, error: 'NO_CREDENTIALS' };
  try {
    const tokens = await runOAuth(conf.clientId, conf.clientSecret);
    await saveTokens(tokens);
    const client = await authedClient();
    const email = client ? await fetchPrimaryEmail(client) : null;
    return { ok: true, email };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

ipcMain.handle('google:signOut', async () => {
  try { await fsp.unlink(GTOKEN_FILE); } catch (_) {}
  return { ok: true };
});

ipcMain.handle('google:importEvents', async (_e, range) => {
  const client = await authedClient();
  if (!client) return { ok: false, error: 'NOT_CONNECTED' };
  try {
    const google = getGoogle();
    const cal = google.calendar({ version: 'v3', auth: client });
    const resp = await cal.events.list({
      calendarId: 'primary',
      timeMin: range && range.timeMin,
      timeMax: range && range.timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    return { ok: true, items: (resp.data && resp.data.items) || [] };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// ========================= 파일(드라이브) 화면 =========================
ipcMain.handle('files:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false };
  return { ok: true, path: res.filePaths[0] };
});

ipcMain.handle('files:list', async (_e, dirPath) => {
  if (!dirPath) return { ok: false, error: 'NO_PATH' };
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const items = [];
    for (const ent of entries) {
      const full = path.join(dirPath, ent.name);
      let size = 0, mtime = 0;
      try {
        const st = await fsp.stat(full);
        size = st.size;
        mtime = st.mtimeMs;
      } catch (_) { /* 접근 불가 항목은 크기/시간 0 */ }
      const isDir = ent.isDirectory();
      const dot = ent.name.lastIndexOf('.');
      const ext = (!isDir && dot > 0) ? ent.name.slice(dot + 1).toLowerCase() : '';
      items.push({ name: ent.name, path: full, isDir, size, mtime, ext });
    }
    return { ok: true, path: dirPath, parent: path.dirname(dirPath), items };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('files:open', async (_e, p) => {
  const err = await shell.openPath(p); // 성공 시 ''
  return { ok: !err, error: err || undefined };
});

ipcMain.handle('files:reveal', async (_e, p) => {
  shell.showItemInFolder(p);
  return { ok: true };
});

ipcMain.handle('files:home', async () => {
  return { ok: true, path: app.getPath('home') };
});

// ---- 외부 브라우저로 URL 열기 (유튜브 등) ----
ipcMain.handle('open:external', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return { ok: false, error: 'BAD_URL' };
  await shell.openExternal(url);
  return { ok: true };
});

// ---- 유튜브 백그라운드 오디오: 실제 youtube.com 페이지를 '숨은' 창에서 로드 ----
// (영상 화면은 안 보이고 오디오만 흐름 → 임베드가 막힌 영상도 재생됨)
let ytWindow = null;
// 광고 요청 차단 (전용 세션 'ytmusic'에만 적용 — 메인앱/OAuth와 격리) — best-effort
let ytSessionReady = false;
function setupYtSession() {
  if (ytSessionReady) return;
  ytSessionReady = true;
  const sess = session.fromPartition('ytmusic');
  const adHosts = [
    '*://*.doubleclick.net/*', '*://*.googlesyndication.com/*', '*://*.googleadservices.com/*',
    '*://*.youtube.com/pagead/*', '*://*.youtube.com/ptracking*', '*://*.youtube.com/api/stats/ads*',
    '*://*.youtube.com/get_midroll_*', '*://*.youtube.com/get_video_info*ad*',
  ];
  sess.webRequest.onBeforeRequest({ urls: adHosts }, (_details, cb) => cb({ cancel: true }));
}
function ytPlayJs() {
  // 로드 후: 음소거 해제+재생, autonav 끄기, ended→멈춤(드리프트 방지), 광고 자동 스킵(광고 제거)
  return "(function(){" +
    "var v=document.querySelector('video');" +
    "if(v){v.muted=false; v.play&&v.play(); v.addEventListener('ended',function(){try{v.pause();}catch(e){}});}" +
    "try{var b=document.querySelector('.ytp-autonav-toggle-button[aria-checked=\"true\"]'); if(b){b.click();}}catch(e){}" +
    "if(!window.__adskip){window.__adskip=setInterval(function(){try{" +
      "var p=document.querySelector('.html5-video-player');" +
      "if(p&&p.classList.contains('ad-showing')){" +
        "var s=document.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button');" +
        "if(s){s.click();}else{var av=document.querySelector('video'); if(av&&av.duration&&isFinite(av.duration)){av.currentTime=av.duration;}}" +
      "}}catch(e){}},500);}" +
    "})();";
}
ipcMain.handle('youtube:play', async (_e, url) => {
  if (typeof url !== 'string' || !/^https:\/\/(www\.)?youtube\.com\//.test(url)) {
    return { ok: false, error: 'BAD_URL' };
  }
  try {
    setupYtSession();
    if (!ytWindow || ytWindow.isDestroyed()) {
      ytWindow = new BrowserWindow({
        width: 480,
        height: 360,
        show: false, // 숨김 — 영상 창을 띄우지 않음
        title: '음악 재생',
        backgroundColor: '#000000',
        webPreferences: {
          contextIsolation: true, nodeIntegration: false, sandbox: true,
          backgroundThrottling: false, // 숨김 상태에서도 재생 유지
          partition: 'ytmusic', // 광고 차단 세션
        },
      });
      ytWindow.on('closed', () => { ytWindow = null; stopYtPoll(); });
      ytWindow.webContents.on('did-finish-load', () => {
        ytWindow.webContents.executeJavaScript(ytPlayJs()).catch(() => {});
      });
    }
    await ytWindow.loadURL(url); // show() 하지 않음 → 백그라운드 오디오
    startYtPoll(); // 곡 종료 감지 시작 (곡마다 재시작)
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 곡 종료를 폴링으로 감지 → 렌더러에 알림(다음 곡 재생). 광고 종료 오탐 방지.
let ytPoll = null;
function stopYtPoll() { if (ytPoll) { clearInterval(ytPoll); ytPoll = null; } }
function startYtPoll() {
  stopYtPoll();
  ytPoll = setInterval(async () => {
    if (!ytWindow || ytWindow.isDestroyed()) { stopYtPoll(); return; }
    try {
      const st = await ytWindow.webContents.executeJavaScript(
        "(function(){var v=document.querySelector('video');return v?{ended:v.ended,ad:!!document.querySelector('.ad-showing'),d:v.duration}:null;})();"
      );
      if (st && st.ended && !st.ad && st.d > 0) {
        stopYtPoll();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('youtube:ended');
      }
    } catch (_) { /* 페이지 전환 중 등은 무시 */ }
  }, 1500);
}
function ytExec(js) {
  if (ytWindow && !ytWindow.isDestroyed()) {
    return ytWindow.webContents.executeJavaScript(js).catch(() => {});
  }
  return Promise.resolve();
}
ipcMain.handle('youtube:pause', async () => { await ytExec("document.querySelector('video')&&document.querySelector('video').pause();"); return { ok: true }; });
ipcMain.handle('youtube:resume', async () => { await ytExec("document.querySelector('video')&&document.querySelector('video').play();"); return { ok: true }; });
ipcMain.handle('youtube:stop', async () => {
  stopYtPoll();
  if (ytWindow && !ytWindow.isDestroyed()) ytWindow.close();
  ytWindow = null;
  return { ok: true };
});

// ---- 이미지 선택 (배너/스티커, GIF 포함) → dataURL ----
ipcMain.handle('image:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '이미지 선택',
    properties: ['openFile'],
    filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, error: 'CANCELED' };
  try {
    const p = res.filePaths[0];
    const buf = await fsp.readFile(p);
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const dataUrl = `data:image/${mime};base64,${buf.toString('base64')}`;
    return { ok: true, dataUrl };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// ---- 데이터 백업/복원 ----
ipcMain.handle('data:export', async (_e, payload) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '데이터 내보내기',
    defaultPath: `hada-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, error: 'CANCELED' };
  try {
    await fsp.writeFile(res.filePath, JSON.stringify(payload || {}, null, 2), 'utf-8');
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

ipcMain.handle('data:import', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '데이터 가져오기',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, error: 'CANCELED' };
  try {
    const raw = await fsp.readFile(res.filePaths[0], 'utf-8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'INVALID' };
    return { ok: true, data };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// ---- 앱 라이프사이클 ----
app.whenReady().then(async () => {
  try {
    await startAppServer();
  } catch (e) {
    console.error('로컬 서버 시작 실패, file:// 로 폴백:', e);
  }
  createWindowSafe();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindowSafe();
  });
});

// 서버가 없으면 file:// 로 폴백해서라도 창을 띄운다
function createWindowSafe() {
  if (appBaseUrl) { createWindow(); return; }
  mainWindow = new BrowserWindow({
    width: 960, height: 720, minWidth: 480, minHeight: 400,
    title: '하다 — 할 일 & 메모', backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
