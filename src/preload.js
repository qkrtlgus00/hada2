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
});
