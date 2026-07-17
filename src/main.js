'use strict';

const { app, BrowserWindow, ipcMain, Notification, shell, dialog, session, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const https = require('https');
const os = require('os');

// userData 폴더명을 'hada2'로 고정 — productName('하다')이 app.getName()을 바꿔도
// 기존 데이터 경로(%APPDATA%\hada2\data.json)를 유지 (폴더판·설치판 데이터 공유)
app.setName('hada2');

// 숨은 창에서 유튜브 오디오를 자동재생하려면 사용자 제스처 요구를 꺼야 함
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 투명(frameless transparent) 창이 잠깐씩 불투명해졌다 창을 움직이면 돌아오는 깜빡임 방지.
// 원인: Windows '창 가림 판정'(occlusion)이 창을 가려졌다고 오판 → 렌더링을 멈춰 투명이 순간 사라짐.
// 그 판정 기능만 끔. GPU 합성은 그대로라 투명도는 정상 유지.
// (v1.13.6의 disable-gpu-compositing은 투명도를 아예 깨뜨려서 v1.13.7에서 제거함.)
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

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
        res.on('end', () => {
          const cl = res.headers['content-length'];
          if (cl && Number(cl) !== Buffer.byteLength(data)) { reject(new Error('TRUNCATED')); return; } // 잘린 응답 차단
          resolve(data);
        });
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
  // 설치본(패키지)은 electron-updater로 갱신 — 파일 덮어쓰기 방식은 폴더판에서만 사용
  if (app.isPackaged) return { ok: true, current: app.getVersion(), latest: app.getVersion(), updateAvailable: false };
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
      if (!dest.startsWith(APP_ROOT + path.sep)) throw new Error('BAD_PATH ' + rel); // 경로 이탈 차단
      payload.push({ rel, dest, text: await fetchText(UP_BASE + rel) });
    }
    // 2) 쓰기 전 무결성 검증 — 비었거나 깨진 파일이면 아무것도 안 씀
    for (const p of payload) {
      if (!p.text || p.text.length < 10) throw new Error('EMPTY ' + p.rel);
      if (p.rel.endsWith('.json')) JSON.parse(p.text);
      else if (p.rel.endsWith('.js')) new Function(p.text); // 구문 검사(실행하지 않음)
    }
    // 3) 기존본 백업 후 원자적 쓰기, 중간 실패 시 롤백
    const written = [];
    try {
      for (const p of payload) {
        await fsp.mkdir(path.dirname(p.dest), { recursive: true });
        try { await fsp.copyFile(p.dest, p.dest + '.bak-update'); } catch (_) {}
        const tmp = p.dest + '.tmp-update';
        await fsp.writeFile(tmp, p.text, 'utf8');
        await fsp.rename(tmp, p.dest);
        written.push(p.dest);
      }
    } catch (werr) {
      for (const dest of written) { try { await fsp.copyFile(dest + '.bak-update', dest); } catch (_) {} } // 롤백
      throw werr;
    }
    for (const p of payload) { try { await fsp.unlink(p.dest + '.bak-update'); } catch (_) {} } // 백업 정리
    // 4) 새 코드로 재시작
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

let mainWindow = null;
let revealMainWindow = null; // 현재 창의 '테마 적용 후 첫 표시' 함수 — ipc 'ui:themed' 수신 시 호출
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
        res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
        const data = await fsp.readFile(filePath);
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
let bootShell = { windowOpacity: 100, backgroundMaterial: 'none', uiScale: 100 };
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
    windowOpacity: clampInt(o.windowOpacity, 15, 100, 100),
    backgroundMaterial: materialSupported() ? mat : 'none',
    uiScale: clampInt(o.uiScale, 80, 150, 100),
  };
}
// ===== 창 크기/위치 저장·복원 (data.json과 별도 파일로 경합 방지) =====
const WSTATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
function restoreWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(WSTATE_FILE, 'utf8'));
    const out = { maximized: !!s.maximized };
    if (Number.isFinite(s.width) && Number.isFinite(s.height) && s.width >= 480 && s.height >= 400) {
      out.width = Math.round(s.width); out.height = Math.round(s.height);
    }
    if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
      // 저장 위치가 '연결된 어느 모니터'의 작업영역과라도 겹치면 복원(보조 모니터 위치도 그대로).
      // 모든 화면 밖(모니터 분리 등)일 때만 무시 → 주 모니터 중앙에 배치(창을 잃어버리지 않게).
      try {
        const { screen } = require('electron');
        const w = out.width || 960, h = out.height || 720;
        const onAny = screen.getAllDisplays().some((disp) => {
          const a = disp.workArea;
          return s.x < a.x + a.width && s.x + w > a.x && s.y < a.y + a.height && s.y + h > a.y;
        });
        if (onAny) { out.x = Math.round(s.x); out.y = Math.round(s.y); }
      } catch (_) {}
    }
    return out;
  } catch (_) { return { maximized: false }; }
}
let wsaveTimer = null;
function saveWindowState() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const b = mainWindow.getNormalBounds(); // 최대화/최소화 중에도 '보통 크기' 반환
    const tmp = WSTATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: mainWindow.isMaximized() }), 'utf8');
    fs.renameSync(tmp, WSTATE_FILE);
  } catch (_) {}
}
function saveWindowStateDebounced() { if (wsaveTimer) clearTimeout(wsaveTimer); wsaveTimer = setTimeout(saveWindowState, 400); }

function createWindow(useFileFallback) {
  const winState = restoreWindowState();
  mainWindow = new BrowserWindow({
    width: winState.width || 960,
    height: winState.height || 720,
    ...(winState.x != null ? { x: winState.x, y: winState.y } : {}),
    minWidth: 480,
    minHeight: 400,
    show: false, // 렌더러가 저장된 테마를 적용(ui:themed)한 뒤에 표시 — 기본 파랑 → 커스텀 색 깜빡임 제거
    title: '하다 — 할 일 & 메모',
    // 진짜 투명창: 프레임 제거 + 투명 처리 → 투명도 낮추면 바탕화면이 실제로 비침.
    // (앱이 직접 그린 #titlebar로 이동·최소/최대/닫기, 리사이즈는 프레임리스 기본 동작)
    // 재질(mica/acrylic)은 생성 시 투명창과 충돌할 수 있어 런타임(applyShell)에서만 적용.
    // ※ 비투명창(#00000000)은 투명 픽셀이 클릭 통과 + 바탕 안 비침 문제가 있어 쓰지 않음.
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

  // 창 크기/위치 저장(리사이즈·이동 디바운스)
  mainWindow.on('resize', saveWindowStateDebounced);
  mainWindow.on('move', saveWindowStateDebounced);

  // ---- 첫 표시(reveal): 렌더러가 테마 적용을 마치면(ui:themed) 그때 창을 보여줌 ----
  // 저장된 최대화 복원도 여기서 — maximize()는 숨은 창을 강제로 표시하므로(Electron 문서),
  // show:false 상태에서 미리 부르면 테마 적용 전 기본 파랑이 그대로 보인다.
  // ready-to-show는 '테마 적용 전 첫 페인트'에 오므로 표시 신호로 쓰지 않는다(깜빡임 재발).
  let revealed = false;
  let revealTimer = null;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (winState.maximized) mainWindow.maximize();
    mainWindow.show();
  };
  revealMainWindow = reveal;
  revealTimer = setTimeout(reveal, 1500); // 안전망: 신호 유실(구버전 렌더러/init 예외)에도 창은 반드시 뜬다
  mainWindow.webContents.on('did-fail-load', reveal); // 로드 실패 화면도 보여야 함

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

  // 창(X)을 닫으면 완전히 종료 (트레이 상주 안 함). 닫기 직전 크기·위치 저장.
  mainWindow.on('close', () => {
    saveWindowState();
  });

  mainWindow.on('closed', () => {
    if (revealTimer) clearTimeout(revealTimer);
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
// 창을 주(primary) 모니터 중앙으로 이동해 보여주기 — 다른 모니터/화면 밖으로 사라졌을 때 복구
function centerOnPrimary() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindowSafe(); return; }
  try {
    const { screen } = require('electron');
    const a = screen.getPrimaryDisplay().workArea;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    const b = mainWindow.getBounds();
    const w = Math.min(b.width, a.width), h = Math.min(b.height, a.height);
    mainWindow.setBounds({ x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 2), width: w, height: h });
  } catch (_) {}
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function trayControl(action) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tray:control', action);
}
// 설치본에서만 유효한 electron-updater 참조 (트레이의 수동 '업데이트 확인'용)
let autoUpdaterRef = null;
function checkForUpdatesManual() {
  if (!app.isPackaged) {
    dialog.showMessageBox({ type: 'info', title: '하다', message: '개발(폴더) 실행에서는 자동 업데이트를 쓰지 않아요.', detail: '설치본에서만 GitHub 릴리스로 업데이트됩니다.' });
    return;
  }
  if (!autoUpdaterRef) return;
  const au = autoUpdaterRef;
  function cleanup() { au.removeListener('update-not-available', onNone); au.removeListener('error', onErr); }
  const onNone = () => { cleanup(); dialog.showMessageBox({ type: 'info', title: '하다 업데이트', message: '이미 최신 버전이에요.' }); };
  const onErr = (e) => { cleanup(); dialog.showMessageBox({ type: 'warning', title: '하다 업데이트', message: '업데이트 확인에 실패했어요.', detail: String((e && e.message) || e) }); };
  au.once('update-not-available', onNone);
  au.once('error', onErr);
  // 업데이트가 있으면 autoDownload가 받아서 'update-downloaded' → 재시작 안내창으로 이어짐
  au.checkForUpdates().catch(() => {});
}
function createTray() {
  if (tray) return;
  let img = nativeImage.createFromDataURL('data:image/png;base64,' + TRAY_ICON_B64);
  if (process.platform === 'win32') img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('하다');
  const menu = Menu.buildFromTemplate([
    { label: '열기', click: showMainWindow },
    { label: '창 가운데로 (화면에 안 보일 때)', click: centerOnPrimary },
    { type: 'separator' },
    { label: '재생 / 일시정지', click: () => trayControl('playpause') },
    { label: '다음 곡', click: () => trayControl('next') },
    { type: 'separator' },
    { label: '업데이트 확인', click: checkForUpdatesManual },
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

// 종료 직전 렌더러가 동기적으로 마지막 상태를 flush (디바운스 유실 방지)
ipcMain.on('data:saveSync', (e, data) => {
  try {
    const safe = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    const tmp = `${DATA_FILE}.tmp-sync`;
    fs.writeFileSync(tmp, JSON.stringify(safe), 'utf-8');
    fs.renameSync(tmp, DATA_FILE);
    e.returnValue = true;
  } catch (err) { e.returnValue = false; }
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
// 렌더러가 저장된 테마·글씨·아이콘까지 적용을 마친 뒤 보내는 신호 → 이때 창을 처음 표시 (시작 깜빡임 제거)
ipcMain.on('ui:themed', () => { if (revealMainWindow) revealMainWindow(); });

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
let ytNavPending = false; // youtube:play의 loadURL 커밋 전(이전 문서 잔존) — 폴링의 ended/드리프트 판정 유예
let ytNavGen = 0;         // loadURL 세대 — 연타로 이전 load가 abort돼도 새 게이트를 풀지 않게

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
// ---- 광고 데이터 제거 (문서 시작 시점, 페이지 메인 월드) — best-effort ----
// 유튜브가 광고를 그리기 '전에' 플레이어 응답에서 광고 필드만 삭제 → 광고가 아예 시작되지 않음.
// 실패하면 조용히 무시 → 기존 음소거+스킵+빨리감기(ytPlayJs/폴링)가 그대로 최종 방어선.
// 이력: 1.15.0은 훅 3종(ytInitialPlayerResponse 트랩 + 전역 JSON.parse + Response.prototype.json).
//   '재생 안 됨' 보고 → 실제론 재생됐고 시작이 느렸던 것(전체 로드 대기 + 폴링 음소거 구멍, 1.15.2에서 수정).
// 1.15.2: 트랩 1종만 유지. 곡마다 loadURL(새 문서 전체 로드)이라 광고는 항상 초기 HTML의
//   ytInitialPlayerResponse에 실려 옴 → 트랩만으로 충분. 전역 JSON.parse 래핑은 페이지의 모든
//   파싱을 느리게 하고 변조 흔적(toString≠[native code])이 가장 컸음.
// 문제 생기면 false로 — 즉시 기존(음소거+스킵) 동작으로 복귀 (킬 스위치 유지).
const YT_AD_STRIP = true;
const YT_ADSTRIP_JS = "(function(){" +
  "if(window.__adStrip)return;window.__adStrip=true;" +
  "var K=['adPlacements','adSlots','playerAds','adBreakHeartbeatParams'];" +
  "function strip(o){try{if(o&&typeof o==='object'){for(var i=0;i<K.length;i++){if(K[i] in o){try{delete o[K[i]];}catch(e){}}}" +
    "if(o.playerResponse)strip(o.playerResponse);}}catch(e){}return o;}" +
  "try{var _p;Object.defineProperty(window,'ytInitialPlayerResponse',{configurable:true," +
    "get:function(){return _p;},set:function(v){_p=strip(v);}});}catch(e){}" +
  "})();";
// 프리로드 파일을 userData에 런타임 생성 — UP_FILES(자체 업데이트 파일 목록)에 새 파일을 추가하면
// 구버전 업데이터가 못 받는 닭-달걀 문제가 있어, main.js가 직접 써서 배포/업데이트 경로와 무관하게 동작.
let ytPreloadPath = null;
function ensureYtPreload() {
  if (!YT_AD_STRIP) return null;
  if (ytPreloadPath) return ytPreloadPath;
  try {
    const f = path.join(app.getPath('userData'), 'yt-preload.js');
    // 샌드박스 프리로드: webFrame.executeJavaScript가 페이지(메인 월드)에서 문서 시작 시점에 실행됨
    fs.writeFileSync(f,
      "try{var p=require('electron').webFrame.executeJavaScript(" + JSON.stringify(YT_ADSTRIP_JS) + ");" +
      "p&&p.catch&&p.catch(function(){});}catch(e){}", 'utf8');
    ytPreloadPath = f;
  } catch (_) { ytPreloadPath = null; } // 쓰기 실패 → 프리로드 없이 기존 동작
  return ytPreloadPath;
}
function ytPlayJs(vol) {
  // 로드 후: 음량 적용+재생, autonav 끄기, ended→즉시 정지. 광고는 스킵 버튼 클릭+빨리감기로 넘김.
  // 소리 차단(광고/다른 곡)은 메인 프로세스의 setAudioMuted가 담당 → 여기선 v.muted 미사용.
  return "(function(){" +
    "window.__ytvol=" + vol + ";" +
    // 볼륨 설정 헬퍼: 플레이어 API(mp.setVolume)로 '플레이어 자체 볼륨'을 사용자값으로 → 로드 시 유튜브가 100으로 덮는 것 방지. video.volume도 폴백.
    "window.__setvol=function(){try{var mp=document.querySelector('#movie_player');if(mp&&mp.setVolume){mp.setVolume(Math.round((window.__ytvol||0)*100));if((window.__ytvol||0)>0&&mp.isMuted&&mp.isMuted()&&mp.unMute){mp.unMute();}}var vs=document.querySelectorAll('video');for(var i=0;i<vs.length;i++){vs[i].volume=window.__ytvol;}}catch(e){}};" +
    // <video>가 아직 없으면(dom-ready 직후 등) 100ms 간격으로 최대 5초 기다렸다가 생기는 즉시 재생 시작.
    "function boot(){var v=document.querySelector('video');if(!v)return false;" +
      "v.volume=window.__ytvol; v.play&&v.play(); v.addEventListener('ended',function(){try{v.pause();}catch(e){}});" +
      "window.__setvol();return true;}" +
    "if(!boot()&&!window.__ytboot){var n=0;window.__ytboot=setInterval(function(){try{n++;" +
      "if(boot()||n>50){clearInterval(window.__ytboot);window.__ytboot=0;}" +
    "}catch(e){clearInterval(window.__ytboot);window.__ytboot=0;}},100);}" +
    "try{var b=document.querySelector('.ytp-autonav-toggle-button[aria-checked=\"true\"]'); if(b){b.click();}}catch(e){}" +
    "if(!window.__adskip){window.__adskip=setInterval(function(){try{" +
      "var mp=document.querySelector('#movie_player');" +
      "var p=document.querySelector('.html5-video-player');" +
      "var av=p?p.querySelector('video'):document.querySelector('video');" +
      "window.__setvol&&window.__setvol();" +
      "var adp=false; try{adp=!!(mp&&mp.getAdState&&mp.getAdState()===1);}catch(e){}" +
      "var adc=!!(p&&p.classList.contains('ad-showing'));" +
      "if(adp||adc){" +
        "var s=document.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-slot button,.ytp-ad-skip-button-container button');" +
        "if(s){s.click();}" +
        "if(adp && av&&av.duration&&isFinite(av.duration)){av.currentTime=av.duration;}" + // 확정 광고(getAdState===1)에서만 빨리감기 — ad-showing 클래스만으론 본곡을 끝내지 않음
      "}" +
    "}catch(e){}},400);}" +
    "})();";
}
// oEmbed로 유튜브 영상 실제 제목 가져오기 (제목 자동 채우기용)
ipcMain.handle('youtube:title', async (_e, url) => {
  try {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return { ok: false, error: 'BAD_URL' };
    const oe = 'https://www.youtube.com/oembed?url=' + encodeURIComponent(url) + '&format=json';
    const title = JSON.parse(await fetchText(oe)).title;
    if (!title) return { ok: false, error: 'NO_TITLE' };
    return { ok: true, title: String(title) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
// 재생목록 → 개별 곡 목록으로 '펼치기' (추가 시 1회만 사용)
// 재생 경로는 ytExpectedId(단일 곡 고정) 가정 위에 서 있으므로 재생목록을 직접 재생하지 않는다.
// 대신 추가 시점에 곡들로 펼쳐 넣어, 이후엔 손으로 하나씩 넣은 곡과 완전히 동일하게 취급.
// 주의: 재생용 ytWindow는 절대 건드리지 않음(재생 중일 수 있음) — 전용 임시 숨은 창을 만들고 반드시 파괴.
ipcMain.handle('youtube:playlist', async (_e, listId) => {
  if (typeof listId !== 'string' || !/^[a-zA-Z0-9_-]{2,60}$/.test(listId)) return { ok: false, reason: 'BAD_ID' };
  // RD… 는 유튜브가 즉석에서 만드는 믹스/라디오 — 유한한 목록이 아니라 펼치기가 무의미
  if (/^RD/i.test(listId)) return { ok: false, reason: 'MIX' };
  let win = null;
  let timer = null;
  try {
    setupYtSession(); // 광고 요청 차단 세션 공유 (세션만 공유 — 창은 ytWindow와 별개라 재생에 영향 없음)
    win = new BrowserWindow({
      width: 480,
      height: 360,
      show: false, // 숨김 — 화면에 띄우지 않음
      webPreferences: {
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false, // 숨김 상태에서도 로드가 멈추지 않게
        partition: 'ytmusic',
      },
    });
    const work = (async () => {
      await win.loadURL('https://www.youtube.com/playlist?list=' + encodeURIComponent(listId));
      // ytInitialData 전체를 '재귀'로 훑어 playlistVideoRenderer만 수집.
      // (contents.twoColumnBrowseResultsRenderer… 같은 고정 경로는 유튜브가 수시로 바꿔 금방 깨짐)
      return await win.webContents.executeJavaScript(
        "(function(){" +
        "var out=[],more=false,got={},seen=(typeof WeakSet!=='undefined')?new WeakSet():null;" +
        // '#' 접두사 — 영상 ID가 'constructor' 같은 Object 기본 속성명과 겹쳐도 오작동하지 않게
        "function add(id,t){if(!id||got['#'+id])return;got['#'+id]=1;out.push({videoId:String(id),title:String(t||'')});}" +
        "function walk(o,d){try{" +
          "if(!o||typeof o!=='object'||d>60)return;" + // 깊이 제한 + 방문 기록 — 순환/비정상 구조 방어
          "if(seen){if(seen.has(o))return;seen.add(o);}" +
          // 구형 구조 — 유튜브가 화면/계정별로 A/B로 뿌리므로 신형과 '둘 다' 받는다
          "var r=o.playlistVideoRenderer;" +
          "if(r&&r.videoId){var t='';" +
            "try{t=(r.title&&r.title.runs&&r.title.runs[0]&&r.title.runs[0].text)||(r.title&&r.title.simpleText)||'';}catch(e){}" +
            "add(r.videoId,t);}" +
          // 신형 구조 — 유튜브가 재생목록 화면을 lockupViewModel로 바꿈(실측 확인: 49곡 전부 여기서 나옴).
          // videoId=contentId, 제목=metadata.lockupMetadataViewModel.title.content
          "var lv=o.lockupViewModel;" +
          "if(lv&&lv.contentId&&(!lv.contentType||lv.contentType==='LOCKUP_CONTENT_TYPE_VIDEO')){var lt='';" +
            "try{var mt=lv.metadata&&lv.metadata.lockupMetadataViewModel&&lv.metadata.lockupMetadataViewModel.title;" +
            "lt=(mt&&(mt.content||(mt.runs&&mt.runs[0]&&mt.runs[0].text)))||'';}catch(e){}" +
            "add(lv.contentId,lt);}" +
          "if(o.continuationItemRenderer){more=true;}" + // 100곡 초과 목록 — 초기 데이터엔 '이어보기' 토큰만 옴
          "if(Array.isArray(o)){for(var i=0;i<o.length;i++)walk(o[i],d+1);return;}" +
          "for(var k in o){if(Object.prototype.hasOwnProperty.call(o,k))walk(o[k],d+1);}" +
        "}catch(e){}}" +
        "walk(window.ytInitialData,0);" +
        "return {items:out,more:more};" +
        "})();"
      );
    })();
    work.catch(() => {}); // 타임아웃 패배 후 창 파괴로 늦게 reject돼도 unhandled 경고가 없게
    const res = await Promise.race([
      work,
      new Promise((_res, rej) => { timer = setTimeout(() => rej(new Error('TIMEOUT')), 15000); }),
    ]);
    const raw = (res && Array.isArray(res.items)) ? res.items : null;
    if (!raw) return { ok: false, reason: 'NO_DATA' };
    // 형식이 맞는 항목만 통과 (11자 영상 ID) — 페이지 구조가 바뀌어 이상한 값이 섞여도 차단
    const items = [];
    for (const it of raw) {
      if (it && typeof it.videoId === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(it.videoId)) {
        items.push({ videoId: it.videoId, title: typeof it.title === 'string' ? it.title.slice(0, 200) : '' });
      }
    }
    if (!items.length) return { ok: false, reason: 'EMPTY' }; // 비공개·빈 목록·로그인 필요 등
    // 잘렸으면 숨기지 않고 알림 (렌더러가 토스트로 고지).
    // 유튜브 초기 데이터는 100곡까지만 실어 보내므로 '정확히 100곡'이면 더 있을 수 있다고 본다.
    // ('이어보기' 표시(more)는 신형 구조에서 안 올 수 있어 개수로도 막는다 — 딱 100곡짜리 목록에
    //  "앞 100곡만"이 뜨는 건 사소한 오차지만, 곡이 조용히 사라지는 것보다 낫다.)
    const truncated = items.length >= 100 || !!res.more;
    return { ok: true, items: items.slice(0, 100), truncated };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { ok: false, reason: msg === 'TIMEOUT' ? 'TIMEOUT' : msg };
  } finally {
    if (timer) clearTimeout(timer);
    try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) {} // 임시 창 누수 = 조용한 메모리/CPU 낭비 — 반드시 파괴
  }
});
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
      const ytPre = ensureYtPreload();
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
          ...(ytPre ? { preload: ytPre } : {}),
        },
      });
      ytWindow.on('closed', () => { ytWindow = null; stopYtPoll(); });
      ytWindow.webContents.on('did-finish-load', () => {
        ytWindow.webContents.executeJavaScript(ytPlayJs(ytVolume)).catch(() => {});
        // 자가 점검: 프리로드의 광고 제거 훅이 실제로 걸렸는지 확인 (실패해도 기존 방어선으로 동작)
        ytWindow.webContents.executeJavaScript('!!window.__adStrip').then((on) => {
          if (!on && YT_AD_STRIP) console.warn('[yt] ad-strip inactive — falling back to mute+skip only');
        }).catch(() => {});
      });
      // dom-ready(HTML 파싱 완료)에도 주입 — 전체 로드보다 0.5~2s 이름. ytPlayJs는 재실행 안전
      // (__adskip/__ytboot 가드, play()/볼륨 멱등) → 둘 다 걸어 이른 쪽이 먼저 재생을 시작.
      ytWindow.webContents.on('dom-ready', () => {
        ytWindow.webContents.executeJavaScript(ytPlayJs(ytVolume)).catch(() => {});
      });
      // 내비게이션 가드: 요청한 영상이 아닌 다른 watch 페이지로 이동(autonav/추천 등)하면
      // 즉시 정지하고 '곡 종료'로 처리 → 렌더러의 반복/다음곡 로직이 올바른 곡으로 이어감.
      // (재로드 대신 ended 처리 — 리다이렉트 루프 방지. watch 아닌 페이지는 무시해 연쇄 스킵 방지)
      const onNav = (_ev, navUrl) => {
        ytNavPending = false; // 어떤 내비게이션이든 커밋 → 이전 문서 사라짐, 판정 재개
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
    // 전체 로드를 await 하지 않음 — 추천/댓글/썸네일까지 1~3s인데 플레이어는 그 전에 뜬다.
    // 렌더러는 play()의 반환값을 쓰지 않으므로(fire-and-forget) 실패는 로그만.
    ytNavGen++;
    const gen = ytNavGen;
    ytNavPending = true;
    ytWindow.loadURL(url).catch((e) => {
      if (gen === ytNavGen) ytNavPending = false; // 실패 → 게이트 해제(기존 드리프트 로직이 곡 진행을 복구)
      console.warn('[yt] loadURL failed:', String((e && e.message) || e));
    });
    startYtPoll(); // 즉시 시작 (음소거 제어 + 드리프트/종료 감지) — 준비되는 순간 소리가 난다
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 250ms 폴링(첫 틱은 즉시): 플레이어 API로 광고/현재 영상ID/종료를 확인해
//  ① 광고이거나 지정 영상이 아니면 음소거, 지정 영상이 광고 없이 재생될 때만 소리
//     (예외: ad-showing 클래스만 있고(adc) 확정 광고(adp=getAdState===1)가 아니면서 본곡이
//      확인되면(요청 ID 일치+재생 중) 오버레이/배너 광고 → 음소거하지 않음. 불확실하면 음소거.)
//  ② 오토플레이가 다른 곡을 틀면(드리프트) 즉시 정지+다음 지정곡
//  ③ 곡 종료 시 정지+다음곡   (②③은 자체 loadURL 진행 중엔 유예 — 이전 문서 잔상 오탐 방지)
let ytPoll = null;
let ytMuteStreak = 0;  // 음소거 게이트 히스테리시스: 광고/다른곡이 연속 확인될 때만 음소거(순간 오탐 무시)
let ytUnmuteWait = 0;  // 초반 풀볼륨 구간 음소거 유지 카운터(volume이 사용자값으로 내려올 때까지, 상한 3틱)
let ytNoVidStreak = 0; // video_id 미확정(플레이어 초기화 중) 연속 틱 수 — 조건 충족 2틱이면 조기 해제
function stopYtPoll() { if (ytPoll) { clearInterval(ytPoll); ytPoll = null; } ytMuteStreak = 0; ytUnmuteWait = 0; ytNoVidStreak = 0; }
function startYtPoll() {
  stopYtPoll();
  const tick = async () => {
    if (!ytWindow || ytWindow.isDestroyed()) { stopYtPoll(); return; }
    try {
      const st = await ytWindow.webContents.executeJavaScript(
        "(function(){" +
        "var mp=document.querySelector('#movie_player');" +
        "var v=document.querySelector('video');" +
        "var adp=false,adc=false,vid='',lv='';" +
        "try{adp=!!(mp&&mp.getAdState&&mp.getAdState()===1);}catch(e){}" +
        "try{vid=(mp&&mp.getVideoData&&mp.getVideoData().video_id)||'';}catch(e){}" +
        "try{lv=(location.search.match(/[?&]v=([a-zA-Z0-9_-]{11})/)||[])[1]||'';}catch(e){}" +
        "var p=document.querySelector('.html5-video-player');adc=!!(p&&p.classList.contains('ad-showing'));" +
        "try{if(window.__setvol){window.__setvol();}else{var vv=document.querySelectorAll('video');for(var i=0;i<vv.length;i++)vv[i].volume=window.__ytvol;}}catch(e){}" +
        "return {ended:v?v.ended:false,d:v?v.duration:0,adp:adp,adc:adc,vid:vid,lv:lv," +
        "playing:!!(v&&!v.paused&&!v.ended&&v.currentTime>0.1),vol:(v?v.volume:window.__ytvol)};" +
        "})();"
      );
      if (!st) return;
      const drift = !!(ytExpectedId && st.vid && st.vid !== ytExpectedId);
      // v1.15.4 광고 판별 분리: adp=확정 광고(getAdState===1 — 광고가 '현재 미디어'로 재생 중),
      // adc=ad-showing 클래스만(오버레이/배너 광고는 본곡이 재생 중에도 붙음 → 음소거하면 곡 중간 무음).
      // 본곡 확인(요청 ID 일치 + 재생 중 + 확정광고 아님) 시에만 adc를 무시. 불확실하면 항상 음소거.
      const vidOk = !!(ytExpectedId && st.vid === ytExpectedId);
      const overlayOnly = !!(st.adc && !st.adp && vidOk && st.playing);
      const adBlock = !!(st.adp || (st.adc && !overlayOnly));
      const positived = ytExpectedId ? (st.vid === ytExpectedId && !adBlock) : (!!st.vid && !adBlock);
      const tooLoud = (typeof st.vol === 'number') && (st.vol > ytVolume + 0.03);
      if (adBlock) { ytMuteStreak = 0; ytUnmuteWait = 0; ytNoVidStreak = 0; try { ytWindow.webContents.setAudioMuted(true); } catch (_) {} }
      else if (positived) {
        ytNoVidStreak = 0;
        if (tooLoud && ytUnmuteWait < 3) { ytUnmuteWait++; } // 초반 풀볼륨 구간은 음소거 유지(큰 소리 감춤), 상한 3틱
        else { ytMuteStreak = 0; ytUnmuteWait = 0; try { ytWindow.webContents.setAudioMuted(false); } catch (_) {} }
      }
      else if (drift) { ytUnmuteWait = 0; ytNoVidStreak = 0; ytMuteStreak++; if (ytMuteStreak >= 2) { try { ytWindow.webContents.setAudioMuted(true); } catch (_) {} } }
      else {
        // video_id 미확정(플레이어 초기화 중). 조기 해제: 요청 watch URL(lv 일치) + 실제 재생 중
        // + 광고 신호 없음 + loadURL 커밋 후(!ytNavPending — 같은 곡 연타 시 이전 문서 잔상 소리 방지)
        // 가 연속 2틱(~0.5s). 광고 신호(getAdState/ad-showing)가 늦는 오탐은 1틱 이내라 2틱이면 흡수.
        // 초반 풀볼륨(tooLoud)은 streak과 동시에 계수 — 직렬로 쌓여 4+3틱(~1.75s)이 되던 버그 수정.
        // ytMuteStreak은 건드리지 않음(드리프트 판정 유지).
        const rightPage = ytExpectedId ? (st.lv === ytExpectedId) : true;
        if (!st.vid && st.playing && rightPage && !ytNavPending) {
          ytNoVidStreak++;
          if (tooLoud && ytUnmuteWait < 3) { ytUnmuteWait++; }
          else if (ytNoVidStreak >= 2) { ytUnmuteWait = 0; try { ytWindow.webContents.setAudioMuted(false); } catch (_) {} }
        } else { ytNoVidStreak = 0; ytUnmuteWait = 0; }
      }
      // 드리프트 종료·다음곡은 '비광고 + 연속 3틱' 확인 시에만 — 광고 순간의 일시적 video_id 불일치 오탐 방지.
      // ytNavPending(자체 loadURL 커밋 전)엔 이전 문서를 보고 있으므로 판정하지 않음.
      if (drift && !adBlock && ytMuteStreak >= 3 && !ytEndedSent && !ytNavPending) {
        ytEndedSent = true;
        stopYtPoll();
        ytExec("var v=document.querySelector('video'); v&&v.pause();");
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('youtube:ended');
        return;
      }
      // ended 판정: adBlock을 쓰면 안 됨 — ended면 playing=false → overlayOnly=false → adBlock=adc가 되어
      // 오버레이가 붙은 채 곡이 끝나면 다음곡 신호가 영영 안 나가 큐가 멈춘다. 확정 광고(adp)만 제외하고,
      // adc는 본곡 확인(vidOk) 시 무시.
      if (st.ended && !st.adp && (!st.adc || vidOk) && st.d > 0 && !ytNavPending) {
        stopYtPoll();
        ytExec("var v=document.querySelector('video'); v&&v.pause();");
        if (!ytEndedSent) {
          ytEndedSent = true;
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('youtube:ended');
        }
      }
    } catch (_) { /* 페이지 전환 중 등은 무시 */ }
  };
  ytPoll = setInterval(tick, 250); // 인터벌을 먼저 등록 — 즉시 틱이 stopYtPoll을 불러도 정상 정리됨
  tick(); // 첫 틱 즉시 (기존엔 250ms 대기)
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
  await ytExec("window.__ytvol=" + ytVolume + "; if(window.__setvol){window.__setvol();} else {var v=document.querySelector('video'); if(v){v.volume=" + ytVolume + ";}}");
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
// 단일 인스턴스: 두 번째 실행 시 기존 창을 띄우고 자신은 종료 (창 중복 방지)
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) app.quit();
app.on('second-instance', () => showMainWindow());

app.whenReady().then(async () => {
  if (!gotSingleLock) return; // 두 번째 인스턴스는 창을 만들지 않고 종료됨
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
  // 트레이 상주 제거: createTray()를 호출하지 않음 → tray=null → 창을 닫으면 완전 종료.

  // 설치본(패키지)에서만 electron-updater로 자동 업데이트 (폴더판은 기존 파일 덮어쓰기 방식 유지).
  // require를 isPackaged 안에서 지연 로드 + try — 폴더판엔 electron-updater 모듈이 없어도 안전.
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdaterRef = autoUpdater; // 트레이 수동 확인용
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true; // 완전 종료 시에도 적용(백업 경로)
      autoUpdater.on('update-downloaded', (info) => {
        // 트레이 상주 앱은 창을 닫아도 프로세스가 살아 있어 autoInstallOnAppQuit이 잘 안 걸린다.
        // (사용자는 창만 닫고 다시 열어 같은 프로세스를 포커스 → 앱이 한 번도 진짜 종료되지 않음)
        // 다운로드가 끝나면 바로 재시작·적용을 물어봐 확실히 새 버전으로 올린다.
        const v = (info && info.version) ? ' v' + info.version : '';
        dialog.showMessageBox({
          type: 'info',
          buttons: ['지금 재시작', '나중에'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
          title: '하다 업데이트',
          message: '새 버전' + v + '을 받았어요.',
          detail: '지금 재시작하면 바로 적용됩니다. "나중에"를 눌러도 앱을 완전히 종료(트레이 → 종료)하면 자동으로 적용돼요.',
        }).then((r) => {
          if (r.response === 0) {
            app.isQuitting = true;
            setImmediate(() => { try { autoUpdater.quitAndInstall(true, true); } catch (_) {} });
          }
        }).catch(() => {});
      });
      autoUpdater.checkForUpdates().catch((e) => console.error('업데이트 확인 실패:', e));
    } catch (e) { console.error('자동 업데이트 초기화 실패:', e); }
  }

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
  // 트레이를 안 쓰므로(tray=null) 창을 모두 닫으면 앱 종료 (macOS 제외).
  if (process.platform !== 'darwin' && !tray) {
    app.quit();
  }
});
