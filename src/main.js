'use strict';

const { app, BrowserWindow, ipcMain, Notification, shell, dialog, session, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const https = require('https');
const os = require('os');

// 숨은 창에서 유튜브 오디오를 자동재생하려면 사용자 제스처 요구를 꺼야 함
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 데이터 파일 경로: OS별 사용자 데이터 폴더 안에 저장
const DATA_FILE = path.join(app.getPath('userData'), 'data.json');

// ---- 앱 자체 업데이트 (GitHub raw에서 파일 받아 덮어쓰기) ----
const UP_OWNER = 'qkrtlgus00';
const UP_REPO = 'hada2';
const UP_BRANCH = 'main'; // 자동 업데이트 기준 = 안정 브랜치(삭제 위험 없음)
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

// ===== 창 셸 설정 (커스텀 타이틀바 / 투명도 / 블러 / 배율) =====
// 창 생성 전에 data.json의 prefs에서 창 관련 값만 읽어 옵션에 반영 (시작 시 깜빡임 방지)
let bootShell = { windowOpacity: 100, backgroundMaterial: 'none', uiScale: 100, theme: 'light' };
// 런타임 상태 — 투명도는 앱 내부(CSS)에서 처리하므로 여기선 블러 재질만 추적
let shellState = { material: 'none' };

function clampInt(v, min, max, dflt) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
// mica/acrylic 은 Windows 11 22H2+ (빌드 22621 이상)에서만 동작
function materialSupported() {
  if (process.platform !== 'win32') return false;
  const build = parseInt(String(os.release()).split('.')[2], 10) || 0;
  return build >= 22621;
}
function sanitizeShellPrefs(p) {
  const o = (p && typeof p === 'object') ? p : {};
  const mat = ['none', 'mica', 'acrylic'].includes(o.backgroundMaterial) ? o.backgroundMaterial : 'none';
  return {
    windowOpacity: clampInt(o.windowOpacity, 40, 100, 100),
    backgroundMaterial: materialSupported() ? mat : 'none',
    uiScale: clampInt(o.uiScale, 80, 150, 100),
    theme: o.theme === 'dark' ? 'dark' : 'light',
  };
}
function createWindow(useFileFallback) {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 480,
    minHeight: 400,
    title: '하다 — 할 일 & 메모',
    // 진짜 투명창: 프레임 제거 + 투명 처리 → 투명도 낮추면 바탕화면이 실제로 비침.
    // (앱이 직접 그린 #titlebar로 이동·최소/최대/닫기, 리사이즈는 프레임리스 기본 동작)
    // 재질(mica/acrylic)은 생성 시 투명창과 충돌할 수 있어 런타임(applyShell)에서만 적용.
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: bootShell.uiScale / 100, // 화면 배율 (첫 페인트부터 적용)
    },
  });
  shellState.material = 'none';

  // 최대화 상태 변화를 렌더러에 알림 (타이틀바 최대화/복원 아이콘 교체)
  const sendMax = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', sendMax);
  mainWindow.on('unmaximize', sendMax);

  // 메뉴바 제거로 사라진 기본 단축키 복구 (DevTools / 새로고침)
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = String(input.key || '').toLowerCase();
    if (k === 'f12' || (input.control && input.shift && k === 'i')) {
      mainWindow.webContents.toggleDevTools(); e.preventDefault();
    } else if ((input.control && k === 'r') || k === 'f5') {
      mainWindow.webContents.reload(); e.preventDefault();
    }
  });

  if (useFileFallback) mainWindow.loadFile(path.join(__dirname, 'index.html'));
  else mainWindow.loadURL(`${appBaseUrl}/index.html`);

  // 창 닫기 → 종료 대신 트레이로 숨김(음악 계속). 진짜 종료는 트레이 메뉴/Alt+F4 후 isQuitting.
  mainWindow.on('close', (e) => {
    if (!app.isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // 숨은 음악 재생 창이 남아 앱이 안 꺼지는 것 방지
    if (ytWindow && !ytWindow.isDestroyed()) ytWindow.close();
  });
}

// ===== 트레이 (창 닫아도 상주 + 음악 유지) =====
let tray = null;
const TRAY_ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAhklEQVR4nO3TWwqAMAxE0e7Ihbknt1rxT9C+MjNJiwbyfQ+hTemfymzHnhkbFjZBVPEuhDreRIQCvOJFxDKAa8IvwEBAF7hPOMCKoAIsEPgNoAjJBUYgckALsu4Fpn4DLr8ADdMBljgFYA1TAGgcArD2AfBEvManAHggqnE1oiuugAyHPzUnOSvxWp/58qMAAAAASUVORK5CYII=';
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindowSafe(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function trayControl(action) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tray:control', action);
}
function createTray() {
  if (tray) return;
  let img = nativeImage.createFromDataURL('data:image/png;base64,' + TRAY_ICON_B64);
  if (process.platform === 'win32') img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('하다');
  const menu = Menu.buildFromTemplate([
    { label: '열기', click: showMainWindow },
    { type: 'separator' },
    { label: '재생 / 일시정지', click: () => trayControl('playpause') },
    { label: '다음 곡', click: () => trayControl('next') },
    { type: 'separator' },
    { label: '종료', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', showMainWindow);
  tray.on('click', showMainWindow);
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
  // 알림 클릭 → 앱 창 복원/포커스
  n.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  n.show();
  return true;
});

// ===== 창 제어 (커스텀 타이틀바) =====
ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.handle('window:maximizeToggle', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { maximized: false };
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return { maximized: mainWindow.isMaximized() };
});
ipcMain.handle('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});
ipcMain.handle('window:getState', () => ({
  maximized: !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()),
  materialSupported: materialSupported(),
}));
// 투명도는 앱 내부(CSS)로 처리 → 네이티브 opacity 미사용. 호환용 no-op.
ipcMain.handle('window:setOpacity', () => ({ ok: true, native: false }));
ipcMain.handle('window:setMaterial', (_e, m) => {
  if (!['none', 'mica', 'acrylic'].includes(m)) return { ok: false, reason: 'BAD_VALUE' };
  if (m !== 'none' && !materialSupported()) return { ok: false, reason: 'UNSUPPORTED' };
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: 'NO_WINDOW' };
  try {
    // 창이 항상 투명(transparent:true)이므로 backgroundColor는 계속 투명 유지.
    // 재질(mica/acrylic)만 켜고 끈다 — 없음이어도 CSS 투명도로 바탕화면이 비침.
    shellState.material = m;
    mainWindow.setBackgroundMaterial(m === 'none' ? 'none' : m);
    return { ok: true };
  } catch (e) {
    try { mainWindow.setBackgroundMaterial('none'); } catch (_) {}
    shellState.material = 'none';
    return { ok: false, reason: String((e && e.message) || e) };
  }
});
ipcMain.handle('window:setUiScale', (_e, pct) => {
  const v = clampInt(pct, 80, 150, 100);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.setZoomFactor(v / 100);
  return { ok: true, value: v };
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
let ytVolume = 1;        // 0..1 — 현재 음량 (렌더러 prefs.ytVolume/100). 새 곡 로드 시에도 적용
let ytExpectedId = '';   // youtube:play로 요청한 영상 ID — 다른 영상으로 이탈(드리프트) 감지용
let ytEndedSent = false; // youtube:ended 중복 전송 방지 (폴링/내비게이션 가드 동시 발화 대비)

// 광고 요청 차단 (전용 세션 'ytmusic'에만 적용 — 메인앱과 격리) — best-effort
// 주의: 본편과 같은 googlevideo.com 으로 서빙되는 서버삽입 광고는 네트워크 차단이 불가능
//       → ytPlayJs의 음소거+스킵+빨리감기가 최종 방어선 (광고 완전 제거는 보장 못 함)
let ytSessionReady = false;
function setupYtSession() {
  if (ytSessionReady) return;
  ytSessionReady = true;
  const sess = session.fromPartition('ytmusic');
  const adHosts = [
    '*://*.doubleclick.net/*', '*://*.googlesyndication.com/*', '*://*.googleadservices.com/*',
    '*://*.googletagservices.com/*', '*://*.googletagmanager.com/*',
    '*://*.2mdn.net/*', '*://*.adservice.google.com/*',
    '*://*.youtube.com/pagead/*', '*://*.youtube.com/ptracking*', '*://*.youtube.com/api/stats/ads*',
    '*://*.youtube.com/api/stats/atr*', '*://*.youtube.com/pcs/activeview*',
    '*://*.youtube.com/youtubei/v1/log_event*',
    '*://*.youtube.com/get_midroll_*', '*://*.youtube.com/get_video_info*ad*',
  ];
  sess.webRequest.onBeforeRequest({ urls: adHosts }, (_details, cb) => cb({ cancel: true }));
}
function ytPlayJs(vol) {
  // 로드 후: 음량 적용+재생, autonav 끄기, ended→즉시 정지. 광고는 스킵 버튼 클릭+빨리감기로 넘김.
  // 소리 차단(광고/다른 곡)은 메인 프로세스의 setAudioMuted가 담당 → 여기선 v.muted 미사용.
  return "(function(){" +
    "window.__ytvol=" + vol + ";" +
    "var v=document.querySelector('video');" +
    "if(v){v.volume=window.__ytvol; v.play&&v.play(); v.addEventListener('ended',function(){try{v.pause();}catch(e){}});}" +
    "try{var b=document.querySelector('.ytp-autonav-toggle-button[aria-checked=\"true\"]'); if(b){b.click();}}catch(e){}" +
    "if(!window.__adskip){window.__adskip=setInterval(function(){try{" +
      "var mp=document.querySelector('#movie_player');" +
      "var p=document.querySelector('.html5-video-player');" +
      "var av=p?p.querySelector('video'):document.querySelector('video');" +
      "if(av&&Math.abs(av.volume-window.__ytvol)>0.001){av.volume=window.__ytvol;}" +
      "var adp=false; try{adp=!!(mp&&mp.getAdState&&mp.getAdState()===1);}catch(e){}" +
      "if(adp||(p&&p.classList.contains('ad-showing'))){" +
        "var s=document.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-slot button,.ytp-ad-skip-button-container button');" +
        "if(s){s.click();}" +
        "if(av&&av.duration&&isFinite(av.duration)){av.currentTime=av.duration;}" +
      "}" +
    "}catch(e){}},400);}" +
    "})();";
}
ipcMain.handle('youtube:play', async (_e, url) => {
  if (typeof url !== 'string' || !/^https:\/\/(www\.)?youtube\.com\//.test(url)) {
    return { ok: false, error: 'BAD_URL' };
  }
  try {
    setupYtSession();
    // 요청 영상 ID를 loadURL 전에 기억 (내비게이션 가드 기준값)
    const m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    ytExpectedId = m ? m[1] : '';
    ytEndedSent = false;
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
        ytWindow.webContents.executeJavaScript(ytPlayJs(ytVolume)).catch(() => {});
      });
      // 내비게이션 가드: 요청한 영상이 아닌 다른 watch 페이지로 이동(autonav/추천 등)하면
      // 즉시 정지하고 '곡 종료'로 처리 → 렌더러의 반복/다음곡 로직이 올바른 곡으로 이어감.
      // (재로드 대신 ended 처리 — 리다이렉트 루프 방지. watch 아닌 페이지는 무시해 연쇄 스킵 방지)
      const onNav = (_ev, navUrl) => {
        const s = String(navUrl || '');
        if (!/^https:\/\/(www\.)?youtube\.com\/watch/.test(s)) return;
        const mm = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (!mm || !ytExpectedId) return;
        if (mm[1] !== ytExpectedId && !ytEndedSent) {
          ytEndedSent = true;
          stopYtPoll();
          ytExec("var v=document.querySelector('video'); v&&v.pause();");
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('youtube:ended');
        }
      };
      ytWindow.webContents.on('did-navigate', onNav);
      ytWindow.webContents.on('did-navigate-in-page', onNav);
    }
    // 로드 즉시 전체 음소거 → 프리롤/미드롤 광고·엉뚱한 곡 소리 원천 차단.
    // 폴링이 "지정 영상이 광고 없이 재생 중"임을 확인하면 해제.
    try { ytWindow.webContents.setAudioMuted(true); } catch (_) {}
    await ytWindow.loadURL(url); // show() 하지 않음 → 백그라운드 오디오
    try { ytWindow.webContents.setAudioMuted(true); } catch (_) {}
    startYtPoll(); // 상태 폴링 시작 (음소거 제어 + 드리프트/종료 감지)
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 250ms 폴링: 플레이어 API로 광고/현재 영상ID/종료를 확인해
//  ① 광고이거나 지정 영상이 아니면 음소거, 지정 영상이 광고 없이 재생될 때만 소리
//  ② 오토플레이가 다른 곡을 틀면(드리프트) 즉시 정지+다음 지정곡
//  ③ 곡 종료 시 정지+다음곡
let ytPoll = null;
function stopYtPoll() { if (ytPoll) { clearInterval(ytPoll); ytPoll = null; } }
function startYtPoll() {
  stopYtPoll();
  ytPoll = setInterval(async () => {
    if (!ytWindow || ytWindow.isDestroyed()) { stopYtPoll(); return; }
    try {
      const st = await ytWindow.webContents.executeJavaScript(
        "(function(){" +
        "var mp=document.querySelector('#movie_player');" +
        "var v=document.querySelector('video');" +
        "var ad=false,vid='';" +
        "try{ad=!!(mp&&mp.getAdState&&mp.getAdState()===1);}catch(e){}" +
        "try{vid=(mp&&mp.getVideoData&&mp.getVideoData().video_id)||'';}catch(e){}" +
        "if(!ad){var p=document.querySelector('.html5-video-player');ad=!!(p&&p.classList.contains('ad-showing'));}" +
        "return {ended:v?v.ended:false,d:v?v.duration:0,ad:ad,vid:vid};" +
        "})();"
      );
      if (!st) return;
      const drift = !!(ytExpectedId && st.vid && st.vid !== ytExpectedId);
      // 지정 영상이 광고 없이 재생될 때만 소리 (기대 ID 없으면 광고만 아니면 허용)
      const confirmed = ytExpectedId ? (st.vid === ytExpectedId && !st.ad) : !st.ad;
      try { ytWindow.webContents.setAudioMuted(!confirmed); } catch (_) {}
      if (drift && !ytEndedSent) {
        ytEndedSent = true;
        stopYtPoll();
        ytExec("var v=document.querySelector('video'); v&&v.pause();");
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('youtube:ended');
        return;
      }
      if (st.ended && !st.ad && st.d > 0) {
        stopYtPoll();
        ytExec("var v=document.querySelector('video'); v&&v.pause();");
        if (!ytEndedSent) {
          ytEndedSent = true;
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('youtube:ended');
        }
      }
    } catch (_) { /* 페이지 전환 중 등은 무시 */ }
  }, 250);
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
// 음량 (0~100) — 상태로 보관해 다음 곡 로드 시에도 적용
ipcMain.handle('youtube:setVolume', async (_e, v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return { ok: false, error: 'BAD_VOLUME' };
  ytVolume = Math.max(0, Math.min(100, Math.round(n))) / 100;
  await ytExec("window.__ytvol=" + ytVolume + ";var v=document.querySelector('video'); if(v){v.volume=" + ytVolume + ";}");
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
  Menu.setApplicationMenu(null); // 기본(영어) 메뉴바 제거

  // 구버전 구글 연동이 남긴 자격증명/토큰 파일 정리 (없으면 무해한 no-op)
  fsp.unlink(path.join(app.getPath('userData'), 'google-config.json')).catch(() => {});
  fsp.unlink(path.join(app.getPath('userData'), 'google-tokens.json')).catch(() => {});

  // 창 관련 설정(투명도/블러/배율/테마)을 창 생성 전에 읽어 반영 (시작 시 깜빡임 방지)
  try { bootShell = sanitizeShellPrefs((await loadData()).prefs); } catch (_) {}

  try {
    await startAppServer();
  } catch (e) {
    console.error('로컬 서버 시작 실패, file:// 로 폴백:', e);
  }
  createWindowSafe();
  try { createTray(); } catch (e) { console.error('트레이 생성 실패:', e); }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindowSafe();
    else showMainWindow();
  });
});

app.on('before-quit', () => { app.isQuitting = true; });

// 서버가 없으면 file:// 로 폴백해서라도 창을 띄운다
function createWindowSafe() {
  createWindow(!appBaseUrl);
}

app.on('window-all-closed', () => {
  // 트레이 상주 중엔 창을 닫아도 종료하지 않음(음악 유지). 트레이 없으면 기존 동작.
  if (process.platform !== 'darwin' && !tray) {
    app.quit();
  }
});
