'use strict';

const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// 데이터 파일 경로: OS별 사용자 데이터 폴더 안에 저장
const DATA_FILE = path.join(app.getPath('userData'), 'data.json');

let mainWindow = null;

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

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * data.json 을 읽어 { tasks: [...] } 형태로 반환.
 * 파일이 없거나 손상됐으면 빈 구조를 돌려준다.
 */
async function loadData() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      return { tasks: [] };
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { tasks: [] };
    }
    // 손상된 파일: 덮어쓰지 않도록 백업 후 빈 구조 반환
    try {
      await fsp.rename(DATA_FILE, `${DATA_FILE}.corrupt-${Date.now()}`);
    } catch (_) {
      /* 백업 실패는 무시 */
    }
    return { tasks: [] };
  }
}

/**
 * 원자적 저장: 임시 파일에 쓴 뒤 rename 으로 교체.
 * 쓰는 도중 프로세스가 죽어도 기존 파일이 손상되지 않는다.
 */
async function saveData(data) {
  const safe = { tasks: Array.isArray(data && data.tasks) ? data.tasks : [] };
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

// ---- 앱 라이프사이클 ----
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
