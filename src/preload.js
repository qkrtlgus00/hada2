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
    /** 음량 (0~100) */
    setVolume: (v) => ipcRenderer.invoke('youtube:setVolume', v),
    /** oEmbed로 영상 실제 제목 가져오기 (제목 자동 채우기) */
    fetchTitle: (url) => ipcRenderer.invoke('youtube:title', url),
    /** 현재 곡 재생 종료 시 콜백 (다음 곡 자동재생용) */
    onEnded: (cb) => ipcRenderer.on('youtube:ended', () => cb()),
  },

  /** 트레이 메뉴 → 렌더러 재생 제어 (playpause / next) */
  onTrayControl: (cb) => ipcRenderer.on('tray:control', (_e, action) => cb(action)),

  /** 창 제어 (커스텀 타이틀바 / 투명도 / 블러 / 배율) */
  win: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
    close: () => ipcRenderer.invoke('window:close'),
    getState: () => ipcRenderer.invoke('window:getState'),
    onMaximized: (cb) => ipcRenderer.on('window:maximized', (_e, v) => cb(!!v)),
    setOpacity: (pct) => ipcRenderer.invoke('window:setOpacity', pct),
    setMaterial: (m) => ipcRenderer.invoke('window:setMaterial', m),
    setUiScale: (pct) => ipcRenderer.invoke('window:setUiScale', pct),
  },

  /** 데이터 백업/복원 */
  data: {
    export: (payload) => ipcRenderer.invoke('data:export', payload),
    import: () => ipcRenderer.invoke('data:import'),
  },

  /** 앱 자체 업데이트 (GitHub에서 받아 적용) */
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    apply: () => ipcRenderer.invoke('update:apply'),
  },
});
