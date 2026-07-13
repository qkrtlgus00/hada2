'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 렌더러(브라우저)에서 window.api 로 접근할 수 있는 안전한 API만 노출한다.
// nodeIntegration 은 꺼져 있으므로 렌더러는 아래 함수 외의 시스템 접근 불가.
contextBridge.exposeInMainWorld('api', {
  /** 저장된 데이터 { tasks: [...] } 를 불러온다. */
  load: () => ipcRenderer.invoke('data:load'),

  /** { tasks: [...] } 를 디스크에 저장한다. */
  save: (data) => ipcRenderer.invoke('data:save', data),

  /** 네이티브 데스크톱 알림을 띄운다. */
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),

  /** 이미지 선택 (배너/스티커) */
  image: {
    pick: () => ipcRenderer.invoke('image:pick'),
  },

  /** 외부 브라우저로 열기 */
  open: {
    external: (url) => ipcRenderer.invoke('open:external', url),
  },

  /** 유튜브 백그라운드 오디오 재생 (숨은 창에서 실제 페이지 로드) */
  youtube: {
    play: (url) => ipcRenderer.invoke('youtube:play', url),
    pause: () => ipcRenderer.invoke('youtube:pause'),
    resume: () => ipcRenderer.invoke('youtube:resume'),
    stop: () => ipcRenderer.invoke('youtube:stop'),
    /** 현재 곡 재생 종료 시 콜백 (다음 곡 자동재생용) */
    onEnded: (cb) => ipcRenderer.on('youtube:ended', () => cb()),
  },

  /** 데이터 백업/복원 */
  data: {
    export: (payload) => ipcRenderer.invoke('data:export', payload),
    import: () => ipcRenderer.invoke('data:import'),
  },

  /** 파일(드라이브) 화면 */
  files: {
    pickFolder: () => ipcRenderer.invoke('files:pickFolder'),
    list: (dirPath) => ipcRenderer.invoke('files:list', dirPath),
    open: (p) => ipcRenderer.invoke('files:open', p),
    reveal: (p) => ipcRenderer.invoke('files:reveal', p),
    home: () => ipcRenderer.invoke('files:home'),
  },

  /** 앱 자체 업데이트 (GitHub에서 받아 적용) */
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    apply: () => ipcRenderer.invoke('update:apply'),
  },

  /** Google 캘린더 연동 */
  google: {
    status: () => ipcRenderer.invoke('google:status'),
    saveConfig: (cfg) => ipcRenderer.invoke('google:saveConfig', cfg),
    signIn: () => ipcRenderer.invoke('google:signIn'),
    signOut: () => ipcRenderer.invoke('google:signOut'),
    importEvents: (range) => ipcRenderer.invoke('google:importEvents', range),
  },
});
