'use strict';

// ===================== 상수 =====================
const DAY_START = 6;   // 06:00
const DAY_END = 22;    // 22:00
const HOUR_HEIGHT = 64; // styles.css --hour-height 와 일치
const DOW_KO = ['월', '화', '수', '목', '금', '토', '일'];

// 카테고리 색 (배경, 글자). 미지정은 팔레트 순환.
const CATEGORY_COLORS = {
  Math: ['#ece8ff', '#5b45c7'],
  Art: ['#e2f0ff', '#2f6bb0'],
  Physics: ['#e5eaff', '#3a4bc7'],
  Sport: ['#ffe6dc', '#c2603a'],
  Computer: ['#dff3e6', '#2f8f5b'],
  Science: ['#e6f7f2', '#1f8f7a'],
  English: ['#fdf0d5', '#b0862f'],
  History: ['#f3e6ff', '#8b45c7'],
};
const PALETTE = [
  ['#ece8ff', '#5b45c7'], ['#e2f0ff', '#2f6bb0'], ['#ffe6dc', '#c2603a'],
  ['#dff3e6', '#2f8f5b'], ['#fdf0d5', '#b0862f'], ['#f3e6ff', '#8b45c7'],
];

// ===================== 상태 =====================
/** @type {Array} */
let events = [];
let todos = [];       // [{id,title,done,createdAt}]
let recurring = [];   // [{id,title,rule,lastDone}]
let ledger = [];      // [{id,date,type,amount,category,memo}]
// 작업 관리(마감·커미션·외주 통합): [{id,title,client,contact,platform,type,amount,status,done,due,progress,notes}]
let works = [];
let notes = [];       // [{id,text,updatedAt}]
let habits = [];      // [{id,name,log:{ymd:true}}]
let playlist = [];    // [{id,title,url,videoId,listId}]
let banner = '';      // 홈 배너 dataURL
let bannerCfg = { height: 180, zoom: 100 }; // 배너 높이(px)·줌(%)
let stickers = [];    // [{id,view,src,x,y,w}]
let ytCurrent = null; // 현재 재생 중 트랙 id
let ytPlaying = false; // 백그라운드 오디오 재생 상태
let ledgerType = 'expense'; // 가계부 입력 구분
let currentView = 'calendar';
let deadlineMonth = ''; // 작업 월 필터 ('' = 전체)
// UI 설정(테마/색/제목/사이드바접힘/음량/창 셸/알림) — data.json에 저장(origin 무관 영구)
let prefs = {
  theme: 'light', colors: {}, viewColors: {}, appTitle: '하다', sidebarCollapsed: false,
  ytRepeat: 'off', ytVolume: 100,
  windowOpacity: 100, backgroundMaterial: 'none', blurIntensity: 30, uiScale: 100,
  notifyDeadlines: true,
  manual: { ledger: false, works: false },
};
let miniMonth = new Date(); // 미니 달력이 보는 달
let weekStart = startOfWeek(new Date()); // 현재 보는 주의 월요일
let catFilter = 'all';
let searchText = '';
let editingId = null; // 모달이 수정 중인 이벤트 id (없으면 신규)
let nowTimer = null;
let firedReminders = {}; // 이미 발송한 알림 { key: 발송시각(ms) } — data.json에 저장돼 재시작에도 중복 방지
let reminderTimer = null;

// ===================== 날짜/시간 유틸 (순수 함수) =====================
function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - day);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function weekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function timeToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minutesToLabel(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function fmt12(t) {
  const mins = timeToMinutes(t);
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h < 12 ? '오전' : '오후';
  h = h % 12 || 12;
  return `${ap} ${h}:${String(m).padStart(2, '0')}`;
}
// 주 범위 라벨 (한국어). 같은 달이면 "2025년 1월 1–7일",
// 달/연도 넘어가면 "2024년 12월 30일 – 2025년 1월 5일"
function weekRangeLabel(monday) {
  const sun = addDays(monday, 6);
  const y1 = monday.getFullYear(), m1 = monday.getMonth() + 1, d1 = monday.getDate();
  const y2 = sun.getFullYear(), m2 = sun.getMonth() + 1, d2 = sun.getDate();
  if (y1 === y2 && m1 === m2) return `${y2}년 ${m2}월 ${d1}–${d2}일`;
  if (y1 === y2) return `${y1}년 ${m1}월 ${d1}일 – ${m2}월 ${d2}일`;
  return `${y1}년 ${m1}월 ${d1}일 – ${y2}년 ${m2}월 ${d2}일`;
}
// 시간(분) → 그리드 top(px)
function minutesToTop(mins) {
  return ((mins - DAY_START * 60) / 60) * HOUR_HEIGHT;
}
function categoryColor(name) {
  if (name && CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  if (!name) return ['#eef0f6', '#5a6072'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
// 구버전 { tasks: [...] } → events 마이그레이션
function migrate(data) {
  if (data && Array.isArray(data.events)) return data.events;
  if (data && Array.isArray(data.tasks)) {
    return data.tasks.map((t) => ({
      id: t.id || (typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Math.random())),
      title: t.title || '(제목 없음)',
      date: t.dueDate || ymd(new Date()),
      start: '09:00',
      end: '10:00',
      category: (t.tags && t.tags[0]) || '',
      confirmed: !!t.done,
      notes: t.notes || '',
      createdAt: t.createdAt || new Date().toISOString(),
      updatedAt: t.updatedAt || new Date().toISOString(),
    }));
  }
  return [];
}

// ---- 파일 표시용 순수 헬퍼 ----
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  const s = (n >= 100 || i === 0) ? Math.round(n) : n.toFixed(1);
  return `${s} ${u[i]}`;
}
// 파일 확장자 → 색 (구글 드라이브풍: 문서=파랑, 시트=초록, PDF=빨강, 이미지=주황 …)
function fileColor(ext) {
  const e = String(ext || '').toLowerCase();
  if (['doc', 'docx', 'hwp', 'txt', 'rtf', 'odt', 'md'].includes(e)) return '#4285f4';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(e)) return '#34a853';
  if (['ppt', 'pptx', 'odp', 'key'].includes(e)) return '#ff6d00';
  if (e === 'pdf') return '#ea4335';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(e)) return '#f4b400';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(e)) return '#e5487f';
  if (['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'].includes(e)) return '#8b5cf6';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return '#b0862f';
  return '#8a93a6';
}
// 확장자 → 타입 글리프 키
function fileTypeGlyph(ext, isDir) {
  if (isDir) return 'folder';
  const e = String(ext || '').toLowerCase();
  if (['doc', 'docx', 'hwp', 'txt', 'rtf', 'odt', 'md'].includes(e)) return 'fdoc';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(e)) return 'fsheet';
  if (['ppt', 'pptx', 'odp', 'key'].includes(e)) return 'fslide';
  if (e === 'pdf') return 'fpdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(e)) return 'fimage';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(e)) return 'fvideo';
  if (['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'].includes(e)) return 'music';
  return 'file';
}
// 색깔 파일 타입 아이콘 (라인 아이콘을 타입 색으로) — 폴더는 파랑
function fileIcon(ext, isDir) {
  const color = isDir ? '#4285f4' : fileColor(ext);
  return `<span class="file-ico" style="color:${color}">${icon(fileTypeGlyph(ext, isDir))}</span>`;
}
function kindLabel(ext, isDir) {
  if (isDir) return '폴더';
  return ext ? ext.toUpperCase() : '파일';
}
function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
// 배경색이 밝으면 어두운 글자, 어두우면 흰 글자
function idealText(hex) { return luminance(hex) > 0.45 ? '#1d2030' : '#ffffff'; }
// 두 색을 t(0~1) 비율로 섞어 #rrggbb 반환 (t=0이면 a, t=1이면 b)
function mix(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  const ch = (x, y) => Math.round(x + (y - x) * k);
  const hx = (n) => n.toString(16).padStart(2, '0');
  return `#${hx(ch(ca.r, cb.r))}${hx(ch(ca.g, cb.g))}${hx(ch(ca.b, cb.b))}`;
}

// ---- 라인 아이콘 (이모지 대체) ----
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5H20A1.5 1.5 0 0 1 21.5 9v9A1.5 1.5 0 0 1 20 19.5H4.5A1.5 1.5 0 0 1 3 18Z"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  note: '<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v6h6M9 13h7M9 17h5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5 11 15l5-5.5"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2A3.2 3.2 0 0 1 16 11.4M17.5 20a5.5 5.5 0 0 0-2.3-4.5"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M8 12 6 14a3.5 3.5 0 0 0 5 5l2-2"/><path d="M16 12l2-2a3.5 3.5 0 0 0-5-5l-2 2"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M4.2 7l2.6 1.5M17.2 15.5l2.6 1.5M4.2 17l2.6-1.5M17.2 8.5 19.8 7"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  message: '<path d="M4 5h16v11H9l-4 3.5V16H4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M13 3v5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  sticker: '<path d="M4 4h10a6 6 0 0 1 6 6v0l-10 10H4z"/><path d="M14 20a6 6 0 0 0 6-6h-4a2 2 0 0 0-2 2z"/>',
  // 파일 타입 글리프 (fileIcon이 타입 색으로 렌더)
  fdoc: '<path d="M6 3h8l4 4v14H6z"/><path d="M13 3v5h5"/><path d="M9 12h6M9 15h6M9 18h4"/>',
  fsheet: '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M4 9h16M4 14.5h16M10 3.5v17M15 3.5v17"/>',
  fslide: '<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M12 17v3M9 21h6"/>',
  fpdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M13 3v5h5"/><path d="M9 14h5M9 17h3"/>',
  fimage: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-4 4-2-2-4 4"/>',
  fvideo: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
};
function icon(name) {
  const p = ICONS[name];
  if (!p) return '';
  return `<svg class="ic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

// 작업 항목 정규화 (순수). 구버전 마감(deadline)·커미션(commission)·이미 병합된 항목 모두 흡수.
// 커미션의 name→title, price→amount, memo→notes, 상태 '진행'→'진행중'으로 통일.
function migrateWork(w) {
  const r = w || {};
  const rawStatus = r.status === '진행' ? '진행중' : r.status;
  const status = rawStatus || (r.done ? '완료' : '대기');
  return {
    id: r.id || (typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Math.random())),
    title: (r.title || r.name || '').trim() || '(제목 없음)',
    client: r.client || '',
    contact: r.contact || '',
    platform: r.platform || '',
    type: r.type || '',
    amount: Number(r.amount != null ? r.amount : r.price) || 0,
    status,
    done: status === '완료',
    due: r.due || '',
    progress: Math.max(0, Math.min(100, Number(r.progress) || 0)),
    notes: (r.notes != null ? r.notes : r.memo) || '',
  };
}
// data(또는 백업)에서 작업 목록을 만든다. 신형 works 우선, 없으면 구형 deadlines+commissions 1회 병합.
function loadWorks(data) {
  const d = data || {};
  if (Array.isArray(d.works)) return d.works.map(migrateWork);
  const dl = Array.isArray(d.deadlines) ? d.deadlines : [];
  const cm = Array.isArray(d.commissions) ? d.commissions : [];
  return [...dl, ...cm].map(migrateWork);
}

// 평문 텍스트 → 안전한 HTML (escape + 줄바꿈)
function textToHtml(str) {
  const esc = String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return esc.replace(/\n/g, '<br>');
}

// HTML → 평문 (미리보기용): 태그 제거 + 기본 엔티티 디코드 + 공백 정리
function stripHtml(html) {
  return String(html || '')
    .replace(/<(br|BR)\s*\/?>/g, ' ')
    .replace(/<\/(p|div|h1|h2|h3|li)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// ---- 유튜브 URL 파싱 (순수) ----
function parseYouTube(url) {
  const out = { videoId: '', listId: '' };
  if (!url) return out;
  const s = String(url);
  let m = s.match(/[?&]list=([a-zA-Z0-9_-]+)/); if (m) out.listId = m[1];
  m = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/); if (m) { out.videoId = m[1]; return out; }
  m = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/); if (m) { out.videoId = m[1]; return out; }
  m = s.match(/\/embed\/([a-zA-Z0-9_-]{11})/); if (m) { out.videoId = m[1]; return out; }
  m = s.match(/\/shorts\/([a-zA-Z0-9_-]{11})/); if (m) { out.videoId = m[1]; return out; }
  return out;
}

// ---- 대시보드/가계부/마감/습관 순수 헬퍼 ----
// 월간 달력 그리드: 월요일 시작 6주(42칸) 날짜 배열
function monthGrid(year, month /* 0-based */) {
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7; // Mon=0
  const cells = [];
  const startDate = new Date(year, month, 1 - startDow);
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    cells.push({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), inMonth: d.getMonth() === month });
  }
  return cells;
}
// 반복 항목이 오늘 체크 대상인지 (이미 오늘 완료했으면 false)
function recurringDueToday(rule, lastDone, todayYmd) {
  if (lastDone === todayYmd) return false;
  const dow = new Date(todayYmd + 'T00:00:00').getDay(); // 0=일
  switch (rule) {
    case 'daily': return true;
    case 'weekday': return dow >= 1 && dow <= 5;
    case 'weekly': return dow === 1; // 매주 월요일 기준
    case 'monthly': return Number(todayYmd.slice(8, 10)) === 1;
    default: return true;
  }
}
function formatWon(n) {
  const v = Math.round(Number(n) || 0);
  const sign = v < 0 ? '-' : '';
  return `${sign}₩${Math.abs(v).toLocaleString('ko-KR')}`;
}
function monthKey(ymd) { return String(ymd || '').slice(0, 7); } // "2026-07"
function sumLedger(items, ym) {
  let income = 0, expense = 0;
  for (const it of items || []) {
    if (ym && monthKey(it.date) !== ym) continue;
    if (it.type === 'income') income += Number(it.amount) || 0;
    else expense += Number(it.amount) || 0;
  }
  return { income, expense, balance: income - expense };
}
// 마감까지 남은 일수(정수). 지났으면 음수.
function daysUntil(dueYmd, todayYmd) {
  const a = new Date(dueYmd + 'T00:00:00').getTime();
  const b = new Date(todayYmd + 'T00:00:00').getTime();
  return Math.round((a - b) / 86400000);
}
function ddayLabel(n) {
  if (n === 0) return 'D-DAY';
  return n > 0 ? `D-${n}` : `D+${-n}`;
}
// 오늘부터 거꾸로 연속 완료 일수
function computeStreak(logObj, todayYmd) {
  const log = logObj || {};
  let streak = 0;
  let d = new Date(todayYmd + 'T00:00:00');
  // 오늘 안 했으면 어제부터 카운트(연속 유지로 간주)
  const key = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  if (!log[key(d)]) d.setDate(d.getDate() - 1);
  while (log[key(d)]) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

// 숫자를 [min,max] 정수로 클램프, 숫자가 아니면 dflt (순수)
function clampInt(v, min, max, dflt) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

// ---- 알림(리마인더) 순수 헬퍼 ----
const DEADLINE_HOUR = 9;               // 마감 알림 시각 (전날/당일 09:00)
const LATE_WINDOW_MS = 60 * 60 * 1000; // 놓친 알림을 1시간까지는 늦게라도 발송

// 중복 방지 키 — 현재 필드로 재계산하므로 일정을 수정/이동하면 자동으로 다시 알림
function eventRemindKey(ev) { return `ev:${ev.id}|${ev.date}T${ev.start}|${ev.remindMin}`; }
// 이벤트 알림 시각(epoch ms). remindMin 없으면 null (로컬 시간 기준)
function eventRemindAt(ev) {
  if (ev.remindMin == null || ev.remindMin === '') return null;
  const t = new Date(`${ev.date}T${ev.start}:00`).getTime();
  if (!Number.isFinite(t)) return null;
  return t - Number(ev.remindMin) * 60000;
}
// 마감 알림 시각: slot 'D1'=전날 09:00, 'D0'=당일 09:00
function deadlineRemindAt(due, slot) {
  const d = new Date(`${due}T00:00:00`);
  if (Number.isNaN(d.getTime())) return NaN;
  if (slot === 'D1') d.setDate(d.getDate() - 1);
  d.setHours(DEADLINE_HOUR, 0, 0, 0);
  return d.getTime();
}
// 지금 울려야 할 알림 목록 (순수). silent=true 는 "너무 늦음 → 발송 없이 기록만"
function dueReminders(evs, dls, fired, now, notifyDl) {
  const out = [];
  const push = (key, at, title, body) => {
    if (!Number.isFinite(at) || fired[key] || now < at) return;
    if (now - at <= LATE_WINDOW_MS) out.push({ key, title, body });
    else out.push({ key, silent: true });
  };
  for (const ev of evs || []) {
    const at = eventRemindAt(ev);
    if (at != null) push(eventRemindKey(ev), at, '일정 알림', `${ev.title} · ${fmt12(ev.start)}`);
  }
  if (notifyDl) {
    for (const dl of dls || []) {
      if (!dl.due || dl.status === '완료') continue;
      push(`dl:${dl.id}|${dl.due}|D1`, deadlineRemindAt(dl.due, 'D1'), '마감 알림', `내일 마감: ${dl.title} (${dl.due})`);
      push(`dl:${dl.id}|${dl.due}|D0`, deadlineRemindAt(dl.due, 'D0'), '마감 알림', `오늘 마감: ${dl.title}`);
    }
  }
  return out;
}

// ===================== 아래는 브라우저(Electron)에서만 실행 =====================
const $ = (s) => (typeof document !== 'undefined' ? document.querySelector(s) : null);

// ---- 저장 ----
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try { await window.api.save({ events, todos, recurring, ledger, works, notes, habits, playlist, banner, bannerCfg, stickers, prefs, firedReminders }); }
    catch (err) { console.error('저장 실패:', err); }
  }, 250);
}

// ---- CRUD ----
function upsertEvent(data) {
  const now = new Date().toISOString();
  if (editingId) {
    const ev = events.find((e) => e.id === editingId);
    if (ev) Object.assign(ev, data, { updatedAt: now });
  } else {
    events.push({ id: crypto.randomUUID(), ...data, createdAt: now, updatedAt: now });
  }
  scheduleSave();
  render();
}
function deleteEvent(id) {
  events = events.filter((e) => e.id !== id);
  scheduleSave();
  render();
}

// ---- 필터 ----
function allCategories() {
  return [...new Set(events.map((e) => e.category).filter(Boolean))].sort();
}
function visibleEventsForDate(dateStr) {
  const q = searchText.trim().toLowerCase();
  return events.filter((e) => {
    if (e.date !== dateStr) return false;
    if (catFilter !== 'all' && e.category !== catFilter) return false;
    if (q && !`${e.title} ${e.notes}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

// ---- 렌더 ----
function render() {
  $('#week-label').textContent = weekRangeLabel(weekStart);
  renderCatFilters();
  renderCatDatalist();
  renderHead();
  renderGutter();
  renderDays();
  renderNowLine();
  // 일정 화면 왼쪽 패널
  renderMiniCal();
  renderTodos();
  renderRecurring();
}

function renderCatFilters() {
  const el = $('#cat-filters');
  const cats = allCategories();
  if (catFilter !== 'all' && !cats.includes(catFilter)) catFilter = 'all';
  el.innerHTML = '';
  const mk = (label, val) => {
    const b = document.createElement('button');
    b.className = 'pill' + (catFilter === val ? ' active' : '');
    b.textContent = val === 'all' ? '전체' : label;
    b.dataset.cat = val;
    b.addEventListener('click', () => { catFilter = val; render(); });
    return b;
  };
  el.appendChild(mk('All', 'all'));
  for (const c of cats) el.appendChild(mk(c, c));
}

function renderCatDatalist() {
  const el = $('#cat-list');
  el.innerHTML = '';
  for (const c of allCategories()) {
    const o = document.createElement('option');
    o.value = c;
    el.appendChild(o);
  }
}

function renderHead() {
  const calHead = $('#cal-head');
  const today = ymd(new Date());
  calHead.querySelectorAll('.day-head').forEach((n) => n.remove());
  weekDates(weekStart).forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'day-head' + (ymd(d) === today ? ' today' : '');
    el.textContent = String(d.getDate());
    calHead.appendChild(el);
  });
}

function renderGutter() {
  const timeGutter = $('#time-gutter');
  timeGutter.innerHTML = '';
  const totalH = (DAY_END - DAY_START) * HOUR_HEIGHT;
  timeGutter.style.height = `${totalH}px`;
  for (let h = DAY_START; h <= DAY_END; h++) {
    const lbl = document.createElement('div');
    lbl.className = 'time-label';
    lbl.style.top = `${(h - DAY_START) * HOUR_HEIGHT}px`;
    lbl.textContent = `${String(h).padStart(2, '0')}:00`;
    timeGutter.appendChild(lbl);
  }
}

function renderDays() {
  const dayCols = $('#day-cols');
  const today = ymd(new Date());
  const totalH = (DAY_END - DAY_START) * HOUR_HEIGHT;
  dayCols.innerHTML = '';
  dayCols.style.height = `${totalH}px`;
  const tmpl = $('#event-template');

  weekDates(weekStart).forEach((d) => {
    const dateStr = ymd(d);
    const col = document.createElement('div');
    col.className = 'day-col' + (dateStr === today ? ' today' : '');

    for (let h = DAY_START; h <= DAY_END; h++) {
      const line = document.createElement('div');
      line.className = 'hour-line';
      line.style.top = `${(h - DAY_START) * HOUR_HEIGHT}px`;
      col.appendChild(line);
    }

    // 빈 곳 클릭 → 새 이벤트 (15분 단위 스냅)
    col.addEventListener('click', (e) => {
      if (e.target !== col && !e.target.classList.contains('hour-line')) return;
      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top;
      let mins = DAY_START * 60 + Math.round((y / HOUR_HEIGHT) * 60 / 15) * 15;
      mins = Math.min(Math.max(mins, DAY_START * 60), DAY_END * 60 - 60);
      openModal(null, { date: dateStr, start: minutesToLabel(mins), end: minutesToLabel(mins + 60) });
    });

    for (const ev of visibleEventsForDate(dateStr)) {
      const startM = timeToMinutes(ev.start);
      const endM = Math.max(timeToMinutes(ev.end), startM + 20);
      const top = minutesToTop(startM);
      const height = ((endM - startM) / 60) * HOUR_HEIGHT;
      const [bg, fg] = categoryColor(ev.category);

      const node = tmpl.content.firstElementChild.cloneNode(true);
      node.style.top = `${Math.max(top, 0)}px`;
      node.style.height = `${Math.max(height - 4, 20)}px`;
      node.style.setProperty('--ev-bg', bg);
      node.style.setProperty('--ev-fg', fg);
      if (ev.confirmed) node.classList.add('confirmed');
      if (height < 44) node.classList.add('compact');
      node.querySelector('.event-title').textContent = ev.title;
      node.querySelector('.event-time').textContent = `${fmt12(ev.start)} - ${fmt12(ev.end)}`;
      node.addEventListener('click', (e) => { e.stopPropagation(); openModal(ev.id); });
      col.appendChild(node);
    }

    dayCols.appendChild(col);
  });
}

function renderNowLine() {
  const dayCols = $('#day-cols');
  if (!dayCols) return;
  document.querySelectorAll('.now-line').forEach((n) => n.remove());
  const now = new Date();
  const todayStr = ymd(now);
  const cols = dayCols.querySelectorAll('.day-col');
  weekDates(weekStart).forEach((d, i) => {
    if (ymd(d) !== todayStr) return;
    const mins = now.getHours() * 60 + now.getMinutes();
    if (mins < DAY_START * 60 || mins > DAY_END * 60) return;
    const line = document.createElement('div');
    line.className = 'now-line';
    line.dataset.time = minutesToLabel(mins);
    line.style.top = `${minutesToTop(mins)}px`;
    cols[i] && cols[i].appendChild(line);
  });
}

// ---- 모달 ----
function openModal(id, prefill) {
  editingId = id || null;
  const ev = id ? events.find((e) => e.id === id) : null;
  $('#modal-title').textContent = ev ? '일정 수정' : '일정 추가';
  $('#delete-event-btn').hidden = !ev;

  $('#f-title').value = ev ? ev.title : '';
  $('#f-date').value = ev ? ev.date : (prefill && prefill.date) || ymd(new Date());
  $('#f-start').value = ev ? ev.start : (prefill && prefill.start) || '09:00';
  $('#f-end').value = ev ? ev.end : (prefill && prefill.end) || '10:00';
  $('#f-category').value = ev ? ev.category : '';
  $('#f-confirmed').checked = ev ? !!ev.confirmed : false;
  $('#f-notes').value = ev ? ev.notes : '';
  const fr = $('#f-remind'); if (fr) fr.value = (ev && ev.remindMin != null) ? String(ev.remindMin) : '';

  $('#modal').hidden = false;
  setTimeout(() => $('#f-title').focus(), 30);
}
function closeModal() { $('#modal').hidden = true; editingId = null; }

// ---- 테마 ----
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const tt = $('#theme-toggle'); if (tt) tt.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  prefs.theme = theme;
  try { localStorage.setItem('theme', theme); } catch (_) {}
}

// ---- 창 셸 (커스텀 타이틀바 / 투명도 / 블러 / 배율) ----
let materialOk = false; // 이 OS에서 미카/아크릴 지원 여부 (window:getState로 확인)

// 창 투명도·흐림을 CSS 표면 알파로 반영 (앱 내부 방식).
// 투명도(windowOpacity)는 항상 적용 → 재질 유무와 무관하게 앱이 직접 반투명.
// 블러 재질이 켜져 있으면 blurIntensity만큼 더 비쳐 창 뒤 재질(블러)이 드러남.
function applyGlassCss() {
  const blurOn = prefs.backgroundMaterial !== 'none' && materialOk;
  const base = clampInt(prefs.windowOpacity, 40, 100, 100);           // 40~100
  const extra = blurOn ? clampInt(prefs.blurIntensity, 0, 80, 30) : 0; // 추가 비침
  const bg = Math.max(base - extra, 30);
  const surface = Math.max(base - Math.round(extra * 0.6), 45); // 패널은 가독성 위해 덜 비침
  const r = document.documentElement.style;
  r.setProperty('--bg-opaque', bg + '%');
  r.setProperty('--surface-opaque', surface + '%');
}
// 저장된 셸 설정을 네이티브 창에 재적용 (시작 시 main이 적용한 값과 동기화 + 미지원 OS 자가치유)
async function applyShell() {
  if (!(window.api && window.api.win)) return;
  try {
    const st = await window.api.win.getState();
    materialOk = !!(st && st.materialSupported);
    document.body.classList.toggle('is-max', !!(st && st.maximized));
  } catch (_) {}
  if (prefs.backgroundMaterial !== 'none') {
    const r = await window.api.win.setMaterial(prefs.backgroundMaterial).catch(() => null);
    if (!r || !r.ok) prefs.backgroundMaterial = 'none'; // 미지원/실패 → 설정 자가치유
  }
  window.api.win.setUiScale(prefs.uiScale);
  applyGlassCss(); // 투명도는 이제 네이티브가 아니라 CSS로 (win.setOpacity 미사용)
}
// 설정 모달의 창/화면 컨트롤을 현재 prefs와 동기화
function syncShellControls() {
  const op = $('#w-opacity'), ov = $('#w-opacity-val'), oh = $('#w-opacity-hint');
  if (op) op.value = String(prefs.windowOpacity); // 투명도·흐림 동시 사용 가능 (비활성화 안 함)
  if (ov) ov.textContent = prefs.windowOpacity + '%';
  if (oh) oh.hidden = true;
  const gl = $('#w-glass'), gv = $('#w-glass-val');
  if (gl) gl.value = String(prefs.blurIntensity);
  if (gv) gv.textContent = prefs.blurIntensity + '%';
  const sc = $('#w-scale'), sv = $('#w-scale-val');
  if (sc) sc.value = String(prefs.uiScale);
  if (sv) sv.textContent = prefs.uiScale + '%';
  const seg = $('#w-material');
  if (seg) seg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('on', b.dataset.m === prefs.backgroundMaterial);
    const unsupported = b.dataset.m !== 'none' && !materialOk;
    b.disabled = unsupported;
    b.title = unsupported ? 'Windows 11(22H2 이상)에서만 지원돼요.' : '';
  });
  const dn = $('#pref-deadline-notify'); if (dn) dn.checked = prefs.notifyDeadlines !== false;
}

// ---- 드래그로 순서 바꾸기 (꾹 눌러 롱프레스) ----
// 화면에 보이는(필터된) 항목만 새 순서로 재배열, 화면 밖 항목은 원위치 유지 (순수)
function reorderByIds(arr, orderedVisibleIds) {
  if (!Array.isArray(arr)) return arr;
  const ids = Array.isArray(orderedVisibleIds) ? orderedVisibleIds.filter((id) => arr.some((x) => x.id === id)) : [];
  if (!ids.length) return arr;
  const visible = new Set(ids);
  const byId = new Map(arr.map((x) => [x.id, x]));
  const queue = ids.map((id) => byId.get(id));
  let qi = 0;
  return arr.map((x) => (visible.has(x.id) ? queue[qi++] : x));
}
// 컨테이너에 롱프레스 드래그 재정렬을 1회 바인딩. commit(orderedIds) 호출.
function enableReorder(container, itemSel, commit) {
  if (!container || container.dataset.reorderBound) return;
  container.dataset.reorderBound = '1';
  let timer = null, dragging = null, startX = 0, startY = 0, didDrag = false, lastDragEnd = 0;
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button, select, input, textarea, a, .note-editor')) return;
    const item = e.target.closest(itemSel);
    if (!item || !container.contains(item)) return;
    startX = e.clientX; startY = e.clientY; didDrag = false;
    clearTimer();
    timer = setTimeout(() => { startDrag(item, e.pointerId); }, 350);
  };
  const startDrag = (item, pointerId) => {
    dragging = item;
    item.classList.add('dragging');
    document.body.classList.add('reordering');
    try { item.setPointerCapture(pointerId); } catch (_) {}
  };
  const onMove = (e) => {
    if (!dragging) {
      if (timer) {
        const dx = Math.abs(e.clientX - startX), dy = Math.abs(e.clientY - startY);
        if (dx > 8 || dy > 8) { clearTimer(); } // 스크롤/드래그선택 → 롱프레스 취소
      }
      return;
    }
    didDrag = true;
    e.preventDefault();
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under && under.closest ? under.closest(itemSel) : null;
    if (target && target !== dragging && container.contains(target)) {
      const rect = target.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      container.insertBefore(dragging, after ? target.nextSibling : target);
    }
  };
  const onUp = () => {
    clearTimer();
    if (dragging) {
      dragging.classList.remove('dragging');
      document.body.classList.remove('reordering');
      const ids = [...container.querySelectorAll(itemSel)].map((el) => el.dataset.id).filter(Boolean);
      dragging = null;
      if (didDrag) { lastDragEnd = Date.now(); commit(ids); }
    }
  };
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
  // 드래그 직후 짧은 시간 내 click만 무시 (메모 모달/음악 재생 오작동 방지)
  container.addEventListener('click', (e) => { if (Date.now() - lastDragEnd < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
}

// ---- 토스트 / 네비게이션 ----
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  // 강제 리플로우 후 show (transition 적용)
  void el.offsetWidth;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 200);
  }, 1800);
}

// 메인 영역 뷰 전환 ([data-view] 기준)
// 탭(뷰)마다 고유 색 — 활성 탭과 그 페이지 상단이 같은 색으로 켜져 "연결된" 느낌
const VIEW_COLORS = {
  home: '#5b6cff', calendar: '#2f9e6b', ledger: '#e08a1e', deadlines: '#e5484d',
  notes: '#0ea5a4', youtube: '#e5487f', files: '#1a73e8',
};
// 설정에서 뷰 색을 노출할 항목 (라벨)
const VIEW_META = [
  { view: 'home', label: '홈' }, { view: 'calendar', label: '일정' },
  { view: 'ledger', label: '가계부' }, { view: 'deadlines', label: '작업 관리' },
  { view: 'notes', label: '메모' },
  { view: 'youtube', label: '음악' }, { view: 'files', label: '파일' },
];
// 뷰 강조색: 사용자 지정(prefs.viewColors) 우선, 없으면 기본 VIEW_COLORS
function viewAccent(view) {
  return (prefs.viewColors && prefs.viewColors[view]) || VIEW_COLORS[view] || cssVar('--primary') || '#5b6cff';
}
function setView(view) {
  currentView = view;
  document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== view; });
  const hdr = document.querySelector('.schedule-header');
  if (hdr) hdr.hidden = view !== 'calendar';
  // 뷰 색을 CSS 변수로 주입 (사이드바 활성 탭 + 페이지 상단이 이 색을 공유)
  const accent = viewAccent(view);
  document.documentElement.style.setProperty('--view-accent', accent);
  updateSbNewLabel(view);
  renderSidebarStats();
  renderStickers();
}
// 사이드바 "새로 만들기" 라벨을 현재 뷰에 맞춤
const SB_NEW_LABEL = {
  calendar: '일정 추가', home: '일정 추가', ledger: '내역 추가', deadlines: '작업 추가',
  notes: '새 메모', youtube: '노래 추가', files: '폴더 열기',
};
function updateSbNewLabel(view) {
  const el = $('#sb-new-label'); if (el) el.textContent = SB_NEW_LABEL[view] || '새로 만들기';
}
// 사이드바 "새로 만들기" — 현재 뷰의 주요 추가 동작
function primaryAdd() {
  switch (currentView) {
    case 'ledger': { const el = $('#l-amount'); if (el) el.focus(); break; }
    case 'deadlines': { const el = $('#d-title'); if (el) el.focus(); break; }
    case 'notes': addNote(); break;
    case 'youtube': { const el = $('#yt-url'); if (el) el.focus(); break; }
    case 'files': pickFolder(); break;
    default: openModal(null); // calendar/home 등
  }
}
// 사이드바 하단 요약(남은 할 일 / 다가오는 마감)
function renderSidebarStats() {
  const today = ymd(new Date());
  const t = $('#sb-stat-todo'); if (t) t.textContent = String(todos.filter((x) => !x.done).length);
  const d = $('#sb-stat-due'); if (d) d.textContent = String(works.filter((w) => w.status !== '완료' && w.due).length);
}
// 상단 검색: 현재 화면 목록을 질의어로 필터 (캘린더는 render()가 searchText를 이미 반영)
const SEARCH_ROW_SEL = '.ledger-row, .deadline-row, .note-card, .yt-row';
function filterCurrentRows() {
  const q = (searchText || '').trim().toLowerCase();
  const section = document.querySelector(`[data-view="${currentView}"]`);
  if (!section) return;
  section.querySelectorAll(SEARCH_ROW_SEL).forEach((row) => {
    const hit = !q || (row.textContent || '').toLowerCase().includes(q);
    row.style.display = hit ? '' : 'none';
  });
}
function applySearch() {
  if (currentView === 'calendar') { render(); return; }
  filterCurrentRows();
}
// 뷰 전환 + 해당 뷰 렌더
function showView(name) {
  setView(name);
  if (name === 'home') renderHome();
  else if (name === 'calendar') render();
  else if (name === 'ledger') renderLedger();
  else if (name === 'deadlines') renderWorks();
  else if (name === 'notes') renderNotes();
  else if (name === 'habits') renderHabits();
  else if (name === 'youtube') renderYouTube();
}
function showCalendar() { setView('calendar'); }
function showFiles() { setView('files'); }
function showPlaceholder(name) {
  setView('placeholder');
  $('#placeholder-icon').innerHTML = icon('panel');
  $('#placeholder-title').textContent = name;
  $('#placeholder-text').textContent = `"${name}" 기능은 아직 준비 중이에요.`;
}
function setActiveNav(li) {
  document.querySelectorAll('[data-nav]').forEach((n) => n.classList.remove('active'));
  li.classList.add('active');
}

// ---- 알림 ----
function notifyToday() {
  const todayStr = ymd(new Date());
  const todays = events.filter((e) => e.date === todayStr);
  if (todays.length === 0) return;
  const first = [...todays].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))[0];
  window.api.notify('오늘 일정', `오늘 ${todays.length}개 · 첫 일정: ${first.title} ${fmt12(first.start)}`);
}

// 30초마다 울릴 알림 확인 — 발송 기록(firedReminders)은 data.json에 저장돼 재시작에도 중복 없음
function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const h of dueReminders(events, works, firedReminders, now, prefs.notifyDeadlines !== false)) {
    firedReminders[h.key] = now;
    changed = true;
    if (!h.silent && window.api && window.api.notify) window.api.notify(h.title, h.body);
  }
  // 수정/삭제로 고아가 된 키 정리 (30일 경과)
  for (const k of Object.keys(firedReminders)) {
    if (now - firedReminders[k] > 30 * 86400000) { delete firedReminders[k]; changed = true; }
  }
  if (changed) scheduleSave();
}

// ---- 파일(드라이브) 화면 ----
let currentFolder = null;
let currentParent = null;

function hasFiles() { return typeof window !== 'undefined' && window.api && window.api.files; }

async function openFiles() {
  showFiles();
  if (!hasFiles()) { toast('이 버전에는 파일 기능이 없어요. 파일을 모두 업데이트하세요.'); return; }
  if (currentFolder) return; // 이미 열려 있으면 유지
  let last = null;
  try { last = localStorage.getItem('lastFolder'); } catch (_) {}
  if (last) { await listFolder(last); return; }
  const h = await window.api.files.home();
  if (h.ok) await listFolder(h.path);
}
async function pickFolder() {
  if (!hasFiles()) return;
  const r = await window.api.files.pickFolder();
  if (r.ok) await listFolder(r.path);
}
async function listFolder(dir) {
  const r = await window.api.files.list(dir);
  if (!r.ok) { toast('폴더를 열 수 없어요' + (r.error ? `: ${r.error}` : '')); return; }
  currentFolder = r.path;
  currentParent = r.parent;
  try { localStorage.setItem('lastFolder', r.path); } catch (_) {}
  renderFiles(r);
}
function goUpFolder() {
  if (currentParent && currentParent !== currentFolder) listFolder(currentParent);
}
function activateEntry(it) {
  if (it.isDir) listFolder(it.path);
  else window.api.files.open(it.path).then((res) => { if (res && !res.ok) toast('파일을 열 수 없어요.'); });
}
function fmtFileDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderFiles(r) {
  $('#files-path').textContent = r.path;
  const items = [...r.items].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // 빠른 액세스: 최근 수정 상위 6
  const recent = [...r.items].sort((a, b) => b.mtime - a.mtime).slice(0, 6);
  const qaWrap = $('#quick-access-wrap');
  const qa = $('#quick-access');
  qa.innerHTML = '';
  if (recent.length) {
    qaWrap.hidden = false;
    for (const it of recent) {
      const c = document.createElement('div');
      c.className = 'qa-card';
      c.innerHTML = '<div class="qa-icon"></div><div class="qa-name"></div><div class="qa-sub"></div>';
      c.querySelector('.qa-icon').innerHTML = fileIcon(it.ext, it.isDir);
      c.querySelector('.qa-name').textContent = it.name;
      c.querySelector('.qa-sub').textContent = it.isDir ? '폴더' : formatSize(it.size);
      c.addEventListener('dblclick', () => activateEntry(it));
      qa.appendChild(c);
    }
  } else {
    qaWrap.hidden = true;
  }

  // 모든 파일 표
  const list = $('#file-list');
  list.innerHTML = '';
  $('#files-empty').hidden = items.length > 0;
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const name = document.createElement('span');
    name.className = 'fc-name';
    const fi = document.createElement('span'); fi.className = 'fi'; fi.innerHTML = fileIcon(it.ext, it.isDir);
    const fn = document.createElement('span'); fn.className = 'fn'; fn.textContent = it.name;
    name.append(fi, fn);
    const kind = document.createElement('span'); kind.className = 'fc-kind'; kind.textContent = kindLabel(it.ext, it.isDir);
    const date = document.createElement('span'); date.className = 'fc-date'; date.textContent = fmtFileDate(it.mtime);
    const size = document.createElement('span'); size.className = 'fc-size'; size.textContent = it.isDir ? '—' : formatSize(it.size);
    row.append(name, kind, date, size);
    row.title = '더블클릭으로 열기';
    row.addEventListener('dblclick', () => activateEntry(it));
    list.appendChild(row);
  }
}

// ---- 색상 사용자 지정 ----
const COLOR_PRESETS = [
  { name: '기본(드라이브)', accent: '#1a73e8', sidebar: '#2f66dc' },
  { name: '드라이브 블루', accent: '#1a73e8', sidebar: '#1b64da' },
  { name: '퍼플', accent: '#6b46e5', sidebar: '#f2effe' },
  { name: '그린', accent: '#2f9e6b', sidebar: '#eaf6ef' },
  { name: '핑크', accent: '#e5487f', sidebar: '#fdeef4' },
  { name: '다크', accent: '#5b6cff', sidebar: '#1b1d27' },
];
let colors = {};
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function applyColors(c) {
  const root = document.documentElement.style;
  if (c && c.accent) {
    root.setProperty('--accent', c.accent);
    root.setProperty('--primary', c.accent);
    root.setProperty('--accent-text', idealText(c.accent));
  }
  if (c && c.sidebar) {
    const t = idealText(c.sidebar);
    const { r, g, b } = hexToRgb(t);
    root.setProperty('--sidebar-bg', c.sidebar);
    root.setProperty('--sidebar-text', t);
    root.setProperty('--sidebar-text-dim', `rgba(${r},${g},${b},0.62)`);
    root.setProperty('--sidebar-active-bg', `rgba(${r},${g},${b},0.14)`);
  }
  if (c && c.pageBg) {
    root.setProperty('--page-bg', c.pageBg);
  }
  if (c && c.panel) {
    root.setProperty('--panel', c.panel);
    // 보조 패널색은 패널과 페이지 배경의 중간 톤으로 파생
    root.setProperty('--panel-2', mix(c.panel, c.pageBg || cssVar('--page-bg') || c.panel, 0.5));
  }
  if (c && c.text) {
    const { r, g, b } = hexToRgb(c.text);
    root.setProperty('--text', c.text);
    root.setProperty('--text-dim', `rgba(${r},${g},${b},0.58)`);
    root.setProperty('--text-mute', `rgba(${r},${g},${b},0.42)`);
  }
}
function saveColors() { prefs.colors = colors; try { localStorage.setItem('colors', JSON.stringify(colors)); } catch (_) {} scheduleSave(); }
function resetColors() {
  colors = {};
  ['--accent', '--primary', '--accent-text', '--sidebar-bg', '--sidebar-text', '--sidebar-text-dim',
    '--sidebar-active-bg', '--page-bg', '--panel', '--panel-2', '--text', '--text-dim', '--text-mute']
    .forEach((v) => document.documentElement.style.removeProperty(v));
  prefs.viewColors = {};
  document.documentElement.style.setProperty('--view-accent', viewAccent(currentView)); // 현재 뷰 색 복구
  saveColors();
  openSettingsModal(); // 입력값 갱신
  toast('기본 색상으로 되돌렸어요.');
}
// 탭 강조색 피커 (설정 모달)
function renderViewColorPickers() {
  const wrap = $('#view-color-list'); if (!wrap) return;
  wrap.innerHTML = '';
  for (const m of VIEW_META) {
    const lab = document.createElement('label'); lab.className = 'vc-item';
    const span = document.createElement('span'); span.textContent = m.label;
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = viewAccent(m.view);
    inp.addEventListener('input', () => {
      if (!prefs.viewColors) prefs.viewColors = {};
      prefs.viewColors[m.view] = inp.value;
      if (currentView === m.view) document.documentElement.style.setProperty('--view-accent', inp.value);
      scheduleSave();
    });
    lab.append(span, inp);
    wrap.appendChild(lab);
  }
}
function renderPresets() {
  const wrap = $('#color-presets');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const p of COLOR_PRESETS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = p.accent;
    b.title = p.name;
    b.addEventListener('click', () => {
      // 강조·사이드바만 프리셋 적용, 페이지/패널/글자 사용자값은 보존
      colors = { ...colors, accent: p.accent, sidebar: p.sidebar };
      applyColors(colors); saveColors();
      $('#c-accent').value = p.accent;
      $('#c-sidebar').value = p.sidebar;
    });
    wrap.appendChild(b);
  }
}
function openSettingsModal() {
  $('#c-title').value = loadTitle();
  $('#c-accent').value = colors.accent || cssVar('--accent') || '#14161f';
  $('#c-sidebar').value = colors.sidebar || cssVar('--sidebar-bg') || '#f3f4f8';
  const setColorInput = (sel, key, fallback) => {
    const el = $(sel); if (!el) return;
    let v = colors[key] || cssVar(fallback) || '';
    // rgba()/파생값이면 색 입력에 못 넣으므로 기본 hex로
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) v = fallback === '--page-bg' ? '#e8e9ee' : fallback === '--panel' ? '#ffffff' : '#1d2030';
    el.value = v;
  };
  setColorInput('#c-pagebg', 'pageBg', '--page-bg');
  setColorInput('#c-panel', 'panel', '--panel');
  setColorInput('#c-text', 'text', '--text');
  renderViewColorPickers();
  syncShellControls();
  $('#settings-modal').hidden = false;
}
function closeSettingsModal() { $('#settings-modal').hidden = true; }

// ---- 앱 자체 업데이트 ----
async function manualUpdateCheck() {
  const st = $('#update-status');
  if (!(window.api.update && window.api.update.check)) { if (st) st.textContent = '업데이트를 사용할 수 없어요.'; return; }
  if (st) st.textContent = '확인 중…';
  try {
    const r = await window.api.update.check();
    if (!r || !r.ok) { if (st) st.textContent = '확인 실패 (인터넷 연결을 확인하세요)'; return; }
    if (r.updateAvailable) {
      if (st) st.textContent = `새 버전 ${r.latest} — 업데이트 중… (곧 재시작)`;
      const a = await window.api.update.apply();
      if (!a.ok && st) st.textContent = '업데이트 실패: ' + a.error;
      // 성공하면 앱이 자동 재시작됨
    } else if (st) {
      st.textContent = `최신 버전이에요 (v${r.current})`;
    }
  } catch (_) { if (st) st.textContent = '확인 실패'; }
}
async function checkUpdateOnStart() {
  if (!(window.api.update && window.api.update.check)) return;
  try {
    const r = await window.api.update.check();
    if (r && r.ok && r.updateAvailable) {
      toast(`새 버전 ${r.latest} 발견 — 업데이트 후 재시작합니다`);
      await window.api.update.apply(); // 성공하면 재시작
    }
  } catch (_) { /* 시작 시엔 조용히 무시 */ }
}

// data-icon 속성을 가진 요소에 SVG 아이콘 주입
function injectIcons() {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
}

// ---- 앱 제목 ----
function applyTitle(str) {
  const t = (str && str.trim()) || '하다';
  const tb = $('#titlebar-title'); if (tb) tb.textContent = t;
  const bt = $('#brand-title'); if (bt) bt.textContent = t;
  const ch = $('#crumb-home'); if (ch) ch.textContent = t;
  const un = $('#user-name'); if (un) un.textContent = t;
  const lg = $('#brand-logo'); if (lg) lg.textContent = [...t][0] || '하';
  prefs.appTitle = t;
  try { localStorage.setItem('appTitle', t); } catch (_) {}
}
function loadTitle() { try { return localStorage.getItem('appTitle') || '하다'; } catch (_) { return '하다'; } }

// ---- 미니 달력 ----
function renderMiniCal() {
  const grid = $('#mini-grid'); if (!grid) return;
  const y = miniMonth.getFullYear(), m = miniMonth.getMonth();
  $('#mini-label').textContent = `${y}년 ${m + 1}월`;
  grid.innerHTML = '';
  const today = ymd(new Date());
  const weekSet = new Set(weekDates(weekStart).map(ymd));
  for (const c of monthGrid(y, m)) {
    const cellYmd = `${c.y}-${String(c.m + 1).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
    const b = document.createElement('button');
    b.className = 'mini-day' + (c.inMonth ? '' : ' out') + (cellYmd === today ? ' today' : '') + (weekSet.has(cellYmd) ? ' in-week' : '');
    b.textContent = c.d;
    b.addEventListener('click', () => { weekStart = startOfWeek(new Date(c.y, c.m, c.d)); render(); });
    grid.appendChild(b);
  }
}

// ---- 할일 ----
function renderTodos() {
  const list = $('#todo-list'); if (!list) return;
  list.innerHTML = '';
  const active = todos.filter((t) => !t.done).length;
  const cnt = $('#todo-count'); if (cnt) cnt.textContent = todos.length ? `${active}/${todos.length}` : '';
  for (const t of todos) {
    const li = document.createElement('li');
    li.className = 'mini-item' + (t.done ? ' done' : '');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = t.done;
    cb.addEventListener('change', () => { t.done = cb.checked; scheduleSave(); renderTodos(); });
    const sp = document.createElement('span'); sp.className = 'mini-item-text'; sp.textContent = t.title;
    const del = document.createElement('button'); del.className = 'mini-del'; del.textContent = '×';
    del.addEventListener('click', () => { todos = todos.filter((x) => x.id !== t.id); scheduleSave(); renderTodos(); });
    li.append(cb, sp, del); list.appendChild(li);
  }
  renderSidebarStats();
}

// ---- 반복 목록 ----
const RULE_LABEL = { daily: '매일', weekday: '평일', weekly: '매주', monthly: '매월' };
// 반복 항목의 날짜별 완료맵 (구버전 lastDone 1일 기록을 흡수)
function recDoneMap(r) {
  if (!r.done || typeof r.done !== 'object') r.done = r.lastDone ? { [r.lastDone]: true } : {};
  return r.done;
}
function recSyncLastDone(r) { const t = ymd(new Date()); r.lastDone = (r.done && r.done[t]) ? t : ''; }
function renderRecurring() {
  const list = $('#recurring-list'); if (!list) return;
  list.innerHTML = '';
  const today = ymd(new Date());
  for (const r of recurring) {
    const map = recDoneMap(r);
    const doneToday = !!map[today];
    const li = document.createElement('li');
    li.className = 'mini-item' + (doneToday ? ' done' : '');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = doneToday;
    cb.addEventListener('change', () => { if (cb.checked) map[today] = true; else delete map[today]; recSyncLastDone(r); scheduleSave(); renderRecurring(); });
    const sp = document.createElement('span'); sp.className = 'mini-item-text rec-open'; sp.textContent = r.title; sp.title = '날짜별 완료 기록 열기';
    sp.addEventListener('click', () => openRecurringModal(r.id));
    const tag = document.createElement('em'); tag.className = 'mini-tag'; tag.textContent = RULE_LABEL[r.rule] || r.rule;
    const del = document.createElement('button'); del.className = 'mini-del'; del.textContent = '×';
    del.addEventListener('click', () => { recurring = recurring.filter((x) => x.id !== r.id); scheduleSave(); renderRecurring(); });
    li.append(cb, sp, tag, del); list.appendChild(li);
  }
}
// ---- 반복 항목 날짜 달력 모달 ----
let recModalId = null;
let recMonth = new Date();
function openRecurringModal(id) {
  const r = recurring.find((x) => x.id === id);
  if (!r) return;
  recModalId = id;
  recMonth = new Date();
  const t = $('#rec-modal-title'); if (t) t.textContent = r.title || '반복 항목';
  renderRecGrid();
  $('#recurring-modal').hidden = false;
}
function closeRecurringModal() { $('#recurring-modal').hidden = true; recModalId = null; renderRecurring(); }
function renderRecGrid() {
  const r = recurring.find((x) => x.id === recModalId); if (!r) return;
  const map = recDoneMap(r);
  const grid = $('#rec-grid'); if (!grid) return;
  const y = recMonth.getFullYear(), m = recMonth.getMonth();
  const lbl = $('#rec-label'); if (lbl) lbl.textContent = `${y}년 ${m + 1}월`;
  grid.innerHTML = '';
  const today = ymd(new Date());
  for (const c of monthGrid(y, m)) {
    const cellYmd = `${c.y}-${String(c.m + 1).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
    const b = document.createElement('button');
    b.className = 'mini-day' + (c.inMonth ? '' : ' out') + (cellYmd === today ? ' today' : '') + (map[cellYmd] ? ' rec-on' : '');
    b.textContent = c.d;
    b.addEventListener('click', () => {
      if (map[cellYmd]) delete map[cellYmd]; else map[cellYmd] = true;
      recSyncLastDone(r); scheduleSave(); renderRecGrid();
    });
    grid.appendChild(b);
  }
}

// ---- 홈(대시보드) ----
function activateNavByTarget(target) {
  const li = [...document.querySelectorAll('[data-nav]')].find((n) => n.dataset.target === target);
  if (li) li.click();
}
// 배너 스타일(높이/줌/위치)을 홈과 모달 미리보기에 함께 적용
function applyBannerStyle() {
  const h = bannerCfg.height || 180, z = (bannerCfg.zoom || 100) / 100;
  const px = (bannerCfg.posX == null ? 50 : bannerCfg.posX), py = (bannerCfg.posY == null ? 50 : bannerCfg.posY);
  const wrap = $('#home-banner'); if (wrap) wrap.style.height = h + 'px';
  for (const id of ['#home-banner-img', '#banner-preview-img']) {
    const im = $(id);
    if (im) { im.style.transform = `scale(${z})`; im.style.objectPosition = `${px}% ${py}%`; }
  }
}
function renderBanner() {
  const img = $('#home-banner-img'); if (!img) return;
  const empty = $('#home-banner-empty');
  const clear = $('#banner-clear');
  applyBannerStyle();
  if (banner) {
    img.src = banner; img.hidden = false;
    if (empty) empty.hidden = true;
    if (clear) clear.hidden = false;
  } else {
    img.hidden = true; img.removeAttribute('src');
    if (empty) empty.hidden = false;
    if (clear) clear.hidden = true;
  }
}
// 배너 편집 모달
function openBannerModal() {
  const pv = $('#banner-preview-img'), pe = $('#banner-preview-empty');
  if (banner) { pv.src = banner; pv.hidden = false; if (pe) pe.hidden = true; }
  else { pv.hidden = true; pv.removeAttribute('src'); if (pe) pe.hidden = false; }
  $('#banner-height').value = String(bannerCfg.height || 180);
  $('#banner-zoom').value = String(bannerCfg.zoom || 100);
  $('#banner-posx').value = String(bannerCfg.posX == null ? 50 : bannerCfg.posX);
  $('#banner-posy').value = String(bannerCfg.posY == null ? 50 : bannerCfg.posY);
  applyBannerStyle();
  $('#banner-modal').hidden = false;
}
function closeBannerModal() { $('#banner-modal').hidden = true; }
function resetBannerCfg() {
  bannerCfg = { height: 180, zoom: 100, posX: 50, posY: 50 };
  openBannerModal(); renderBanner(); scheduleSave();
}
function renderHome() {
  renderBanner();
  const grid = $('#home-grid'); if (!grid) return;
  const today = ymd(new Date());
  const ym = monthKey(today);
  const todayEvents = events.filter((e) => e.date === today).length;
  const activeTodos = todos.filter((t) => !t.done).length;
  const upcoming = works.filter((d) => d.status !== '완료' && d.due).sort((a, b) => a.due.localeCompare(b.due));
  const led = sumLedger(ledger, ym);
  const habitsToday = habits.filter((h) => h.log && h.log[today]).length;
  const cards = [
    { ic: 'calendar', label: '오늘 일정', value: `${todayEvents}건`, view: 'calendar' },
    { ic: 'check', label: '남은 할일', value: `${activeTodos}개`, view: 'calendar' },
    { ic: 'clock', label: '다가오는 마감', value: upcoming.length ? `${upcoming[0].title} · ${ddayLabel(daysUntil(upcoming[0].due, today))}` : '없음', view: 'deadlines' },
    { ic: 'wallet', label: '이번 달 지출', value: formatWon(led.expense), view: 'ledger' },
    { ic: 'check', label: '진행중 작업', value: works.filter((w) => w.status === '진행중').length + '건', view: 'deadlines' },
    { ic: 'check', label: '오늘 습관', value: habits.length ? `${habitsToday}/${habits.length}` : '없음', view: 'habits' },
  ];
  grid.innerHTML = '';
  cards.forEach((c, i) => {
    const el = document.createElement('button');
    el.className = 'home-card' + (i === 0 ? ' feature' : ''); // 첫 카드는 강조색 채움(참고 이미지)
    el.innerHTML = '<div class="hc-icon"></div><div class="hc-label"></div><div class="hc-value"></div>';
    el.querySelector('.hc-icon').innerHTML = icon(c.ic);
    el.querySelector('.hc-label').textContent = c.label;
    el.querySelector('.hc-value').textContent = c.value;
    el.addEventListener('click', () => activateNavByTarget(c.view));
    grid.appendChild(el);
  });
}

// ---- 가계부 ----
function renderLedger() {
  const monthEl = $('#ledger-month');
  if (monthEl && !monthEl.value) monthEl.value = monthKey(ymd(new Date()));
  const ym = (monthEl && monthEl.value) || monthKey(ymd(new Date()));
  const s = sumLedger(ledger, ym);
  $('#ledger-summary').innerHTML =
    `<div class="lsum income"><span>수입</span><strong>${formatWon(s.income)}</strong></div>` +
    `<div class="lsum expense"><span>지출</span><strong>${formatWon(s.expense)}</strong></div>` +
    `<div class="lsum balance"><span>잔액</span><strong>${formatWon(s.balance)}</strong></div>`;
  const list = $('#ledger-list'); list.innerHTML = '';
  let items = ledger.filter((it) => monthKey(it.date) === ym);
  if (!prefs.manual.ledger) items = items.sort((a, b) => b.date.localeCompare(a.date));
  if (!items.length) { list.innerHTML = '<div class="empty-hint">이 달 내역이 없어요.</div>'; return; }
  // 표 헤더 행 (참고의 ALL FILES 헤더)
  const head = document.createElement('div');
  head.className = 'ledger-row ledger-head';
  head.innerHTML = '<span></span><span class="lr-date">날짜</span><span class="lr-cat">분류</span><span class="lr-memo">메모</span><span class="lr-amt">금액</span><span></span>';
  list.appendChild(head);
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'ledger-row ' + it.type;
    row.dataset.id = it.id;
    const mk = (cls, txt) => { const s2 = document.createElement('span'); s2.className = cls; s2.textContent = txt; return s2; };
    const ico = document.createElement('span');
    ico.className = 'file-ico lr-ico';
    ico.style.color = it.type === 'income' ? '#34a853' : '#ea4335';
    ico.innerHTML = icon('wallet');
    row.append(
      ico,
      mk('lr-date', it.date.slice(5)),
      mk('lr-cat', it.category || (it.type === 'income' ? '수입' : '지출')),
      mk('lr-memo', it.memo || ''),
      mk('lr-amt', (it.type === 'income' ? '+' : '-') + formatWon(it.amount)),
    );
    const del = document.createElement('button'); del.className = 'mini-del'; del.textContent = '×';
    del.addEventListener('click', () => { ledger = ledger.filter((x) => x.id !== it.id); scheduleSave(); renderLedger(); });
    row.appendChild(del);
    list.appendChild(row);
  }
  filterCurrentRows();
}

// ---- 작업 관리 (마감·커미션·외주 통합) ----
const WORK_STATUS = ['대기', '진행중', '완료'];
const WORK_ORDER = { 대기: 0, 진행중: 1, 완료: 2 };
function renderWorks() {
  const list = $('#deadline-list'); if (!list) return;
  const today = ymd(new Date());
  const monthEl = $('#deadline-month');
  if (monthEl && monthEl.value !== deadlineMonth) monthEl.value = deadlineMonth;

  // 월 필터 적용 (deadlineMonth '' = 전체)
  const scope = deadlineMonth ? works.filter((d) => monthKey(d.due) === deadlineMonth) : works;

  // 상단 요약: 상태별 건수 + 금액 합계 (필터 범위 기준)
  const cnt = (st) => scope.filter((d) => d.status === st).length;
  const totalAll = scope.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const totalOpen = scope.filter((d) => d.status !== '완료').reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const sum = $('#deadline-summary');
  if (sum) {
    const label = deadlineMonth ? deadlineMonth.replace('-', '년 ') + '월' : '전체';
    sum.innerHTML =
      `<div class="lsum"><span>대기</span><strong>${cnt('대기')}건</strong></div>` +
      `<div class="lsum"><span>진행중</span><strong>${cnt('진행중')}건</strong></div>` +
      `<div class="lsum income"><span>완료</span><strong>${cnt('완료')}건</strong></div>` +
      `<div class="lsum"><span>${label} 금액</span><strong>${formatWon(totalAll)}</strong></div>` +
      `<div class="lsum"><span>미완료 금액</span><strong>${formatWon(totalOpen)}</strong></div>`;
  }

  const items = prefs.manual.works ? [...scope] : [...scope].sort((a, b) =>
    (WORK_ORDER[a.status] - WORK_ORDER[b.status]) || String(a.due || '').localeCompare(String(b.due || '')));
  list.innerHTML = '';
  if (!items.length) { list.innerHTML = '<div class="empty-hint">등록된 작업이 없어요.</div>'; return; }

  for (const it of items) {
    const doneStatus = it.status === '완료';
    const n = it.due ? daysUntil(it.due, today) : null;
    const row = document.createElement('div');
    row.className = 'deadline-row' + (doneStatus ? ' done' : '');
    row.dataset.id = it.id;
    let cls = '';
    if (!doneStatus && n !== null) { if (n < 0) cls = 'overdue'; else if (n === 0) cls = 'today'; else if (n <= 3) cls = 'soon'; }

    const body = document.createElement('div'); body.className = 'dl-body';
    const title = document.createElement('div'); title.className = 'dl-title'; title.textContent = it.title;
    const metaBits = [];
    if (it.client) metaBits.push(it.client);
    if (it.contact) metaBits.push(it.contact);
    if (it.platform) metaBits.push(it.platform);
    if (it.type) metaBits.push(it.type);
    if (it.amount) metaBits.push(formatWon(it.amount));
    if (it.due) metaBits.push(it.due);
    if (it.notes) metaBits.push(it.notes);
    const sub = document.createElement('div'); sub.className = 'dl-sub'; sub.textContent = metaBits.join(' · ');
    // 진행도
    const prog = document.createElement('div'); prog.className = 'dl-progress';
    const bar = document.createElement('div'); bar.className = 'dl-bar';
    const fill = document.createElement('div'); fill.className = 'dl-bar-fill';
    const pct = Math.max(0, Math.min(100, Number(it.progress) || 0));
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    const range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '5'; range.value = String(pct);
    const pctLabel = document.createElement('span'); pctLabel.className = 'dl-pct'; pctLabel.textContent = pct + '%';
    range.addEventListener('input', () => { it.progress = Number(range.value); fill.style.width = it.progress + '%'; pctLabel.textContent = it.progress + '%'; scheduleSave(); });
    prog.append(bar, range, pctLabel);
    body.append(title, sub, prog);
    // 제목/정보줄 클릭 → 편집 모달 (진행률 슬라이더 영역은 제외)
    body.classList.add('dl-clickable');
    body.addEventListener('click', (e) => { if (e.target.closest('.dl-progress')) return; openWorkModal(it.id); });

    // 상태 셀렉트 (완료 체크 대체)
    const sel = document.createElement('select'); sel.className = 'mini-select dl-status';
    for (const st of WORK_STATUS) { const o = document.createElement('option'); o.value = st; o.textContent = st; if (it.status === st) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { it.status = sel.value; it.done = sel.value === '완료'; scheduleSave(); renderWorks(); });

    const badge = document.createElement('span'); badge.className = 'dl-badge ' + cls; badge.textContent = doneStatus ? '완료' : (n === null ? '' : ddayLabel(n));
    const del = document.createElement('button'); del.className = 'mini-del'; del.textContent = '×';
    del.addEventListener('click', () => { works = works.filter((x) => x.id !== it.id); scheduleSave(); renderWorks(); });
    row.append(body, sel, badge, del);
    list.appendChild(row);
  }
  filterCurrentRows();
  renderSidebarStats();
}

// ---- 작업 항목 편집 모달 (메모 포함 전체 필드) ----
let editingWorkId = null;
function openWorkModal(id) {
  const w = works.find((x) => x.id === id);
  if (!w) return;
  editingWorkId = id;
  $('#w-title').value = w.title || '';
  $('#w-client').value = w.client || '';
  $('#w-contact').value = w.contact || '';
  $('#w-platform').value = w.platform || '';
  $('#w-type').value = w.type || '';
  $('#w-amount').value = w.amount ? String(w.amount) : '';
  $('#w-status').value = WORK_STATUS.includes(w.status) ? w.status : '대기';
  $('#w-due').value = w.due || '';
  $('#w-notes').value = w.notes || '';
  $('#work-modal').hidden = false;
  setTimeout(() => $('#w-title').focus(), 30);
}
function closeWorkModal() { $('#work-modal').hidden = true; editingWorkId = null; }
function saveWorkModal() {
  const w = works.find((x) => x.id === editingWorkId);
  if (!w) { closeWorkModal(); return; }
  const title = $('#w-title').value.trim(); const due = $('#w-due').value;
  if (!title || !due) { toast('제목과 마감일을 입력하세요.'); return; }
  const status = $('#w-status').value;
  Object.assign(w, {
    title, due, status, done: status === '완료',
    client: $('#w-client').value.trim(),
    contact: $('#w-contact').value.trim(),
    platform: $('#w-platform').value.trim(),
    type: $('#w-type').value.trim(),
    amount: Number($('#w-amount').value) || 0,
    notes: $('#w-notes').value.trim(),
  });
  scheduleSave(); renderWorks(); closeWorkModal();
}
function deleteWorkModal() {
  if (editingWorkId && confirm('이 작업을 삭제할까요?')) {
    works = works.filter((x) => x.id !== editingWorkId);
    scheduleSave(); renderWorks(); closeWorkModal();
  }
}

// ---- 메모 (서식 툴바 + contenteditable) ----
const NOTE_TOOLS = [
  { cmd: 'bold', label: 'B', title: '굵게', style: 'font-weight:700' },
  { cmd: 'italic', label: 'I', title: '기울임', style: 'font-style:italic' },
  { cmd: 'underline', label: 'U', title: '밑줄', style: 'text-decoration:underline' },
  { cmd: 'formatBlock', arg: 'H1', label: 'H1', title: '큰 제목' },
  { cmd: 'formatBlock', arg: 'H2', label: 'H2', title: '중간 제목' },
  { cmd: 'formatBlock', arg: 'H3', label: 'H3', title: '작은 제목' },
  { cmd: 'insertUnorderedList', label: '•', title: '글머리 목록' },
  { cmd: 'insertOrderedList', label: '1.', title: '번호 목록' },
];
// 글자색 / 형광펜 프리셋
const NOTE_TEXT_COLORS = ['#1d2030', '#e5484d', '#2f6bb0', '#2f8f5b'];
const NOTE_HILITE_COLORS = ['#fff3a3', '#c7f0d2', '#ffd6e7'];
function noteHtml(nt) {
  if (typeof nt.html === 'string') return nt.html;
  return textToHtml(nt.text || '');
}
// 미리보기 텍스트 (제목 한 줄 + 본문 스니펫)
function notePreview(nt) {
  const txt = stripHtml(noteHtml(nt));
  return txt || '';
}
// 메모 서식 툴바를 barEl에 구성 (editorEl 대상, nt에 저장)
function buildNoteToolbar(barEl, editorEl, nt) {
  barEl.innerHTML = '';
  const save = () => { nt.html = editorEl.innerHTML; delete nt.text; nt.updatedAt = new Date().toISOString(); scheduleSave(); };
  const runCmd = (cmd, arg) => {
    editorEl.focus();
    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    document.execCommand(cmd, false, arg || null);
    save();
  };
  for (const t of NOTE_TOOLS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'nt-btn'; b.title = t.title;
    b.textContent = t.label; if (t.style) b.setAttribute('style', t.style);
    b.addEventListener('mousedown', (e) => { e.preventDefault(); runCmd(t.cmd, t.arg); });
    barEl.appendChild(b);
  }
  for (const col of NOTE_TEXT_COLORS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'nt-color'; b.title = '글자색';
    b.style.color = col; b.textContent = 'A';
    b.addEventListener('mousedown', (e) => { e.preventDefault(); runCmd('foreColor', col); });
    barEl.appendChild(b);
  }
  for (const col of NOTE_HILITE_COLORS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'nt-hilite'; b.title = '형광펜';
    b.style.background = col;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      editorEl.focus();
      try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
      if (!document.execCommand('hiliteColor', false, col)) document.execCommand('backColor', false, col);
      save();
    });
    barEl.appendChild(b);
  }
}
function renderNotes() {
  const grid = $('#notes-grid'); if (!grid) return;
  grid.innerHTML = '';
  if (!notes.length) { grid.innerHTML = '<div class="empty-hint">메모가 없어요. "+ 새 메모"로 시작하세요.</div>'; return; }
  for (const nt of notes) {
    const card = document.createElement('div'); card.className = 'note-card';
    card.dataset.id = nt.id;
    card.title = '클릭해서 편집';
    const del = document.createElement('button'); del.className = 'mini-del'; del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      notes = notes.filter((x) => x.id !== nt.id); scheduleSave(); renderNotes();
    });

    const preview = document.createElement('div'); preview.className = 'note-card-preview';
    const txt = notePreview(nt);
    if (txt) preview.textContent = txt;
    else { preview.classList.add('empty'); preview.textContent = '빈 메모'; }

    const date = document.createElement('div'); date.className = 'note-card-date';
    date.textContent = nt.updatedAt ? new Date(nt.updatedAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '';

    card.append(del, preview, date);
    card.addEventListener('click', () => openNoteModal(nt.id));
    grid.appendChild(card);
  }
  filterCurrentRows();
}
// ---- 메모 편집 모달 ----
let noteModalId = null;
function openNoteModal(id) {
  const nt = notes.find((x) => x.id === id);
  if (!nt) return;
  noteModalId = id;
  const editor = $('#note-modal-editor');
  const bar = $('#note-modal-bar');
  const modal = $('#note-modal');
  if (!editor || !bar || !modal) return;
  editor.innerHTML = noteHtml(nt);
  editor.oninput = () => { nt.html = editor.innerHTML; delete nt.text; nt.updatedAt = new Date().toISOString(); scheduleSave(); };
  buildNoteToolbar(bar, editor, nt);
  const del = $('#note-modal-del');
  if (del) del.onclick = () => {
    notes = notes.filter((x) => x.id !== noteModalId); scheduleSave();
    closeNoteModal();
  };
  modal.hidden = false;
  editor.focus();
}
function closeNoteModal() {
  const modal = $('#note-modal');
  if (modal) modal.hidden = true;
  noteModalId = null;
  renderNotes();
}
function addNote() {
  const nt = { id: crypto.randomUUID(), html: '', updatedAt: new Date().toISOString() };
  notes.unshift(nt);
  scheduleSave(); renderNotes();
  openNoteModal(nt.id);
}

// ---- 습관 ----
function renderHabits() {
  const list = $('#habit-list'); if (!list) return;
  const today = ymd(new Date());
  const last7 = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); last7.push(ymd(d)); }
  list.innerHTML = '';
  if (!habits.length) { list.innerHTML = '<div class="empty-hint">습관을 추가해 매일 체크하세요.</div>'; return; }
  const dowKo = ['일', '월', '화', '수', '목', '금', '토'];
  for (const h of habits) {
    if (!h.log) h.log = {};
    const streak = computeStreak(h.log, today);
    const card = document.createElement('div'); card.className = 'habit-card';
    const head = document.createElement('div'); head.className = 'habit-head';
    const nm = document.createElement('strong'); nm.textContent = h.name;
    const sk = document.createElement('span'); sk.className = 'habit-streak'; sk.textContent = `연속 ${streak}일`;
    const del = document.createElement('button'); del.className = 'mini-del'; del.textContent = '×';
    del.addEventListener('click', () => { habits = habits.filter((x) => x.id !== h.id); scheduleSave(); renderHabits(); });
    head.append(nm, sk, del);
    const days = document.createElement('div'); days.className = 'habit-days';
    for (const dYmd of last7) {
      const b = document.createElement('button');
      b.className = 'habit-day' + (h.log[dYmd] ? ' on' : '');
      b.innerHTML = `<i>${dowKo[new Date(dYmd + 'T00:00:00').getDay()]}</i><b>${Number(dYmd.slice(8))}</b>`;
      b.addEventListener('click', () => { if (h.log[dYmd]) delete h.log[dYmd]; else h.log[dYmd] = true; scheduleSave(); renderHabits(); });
      days.appendChild(b);
    }
    card.append(head, days);
    list.appendChild(card);
  }
}

// ---- 유튜브 음악 플레이어 ----
// 실제 유튜브 페이지 URL (앱 새 창에서 재생 → 임베드 제약 없음)
function ytWatchUrl(t) {
  // 정확히 이 영상만 재생 (list= 라디오/믹스가 붙으면 다른 곡이 나오므로 제거)
  if (t.videoId) return `https://www.youtube.com/watch?v=${t.videoId}`;
  if (t.listId) return `https://www.youtube.com/playlist?list=${t.listId}`;
  return t.url || '';
}
// 백그라운드 오디오로 재생 (영상 창 없이)
function playTrack(id) {
  const t = playlist.find((x) => x.id === id);
  if (!t) return;
  // 개별 영상 ID가 없는(재생목록 전용) 트랙은 어떤 곡이 나올지 보장 못 함 → 재생 불가
  if (!t.videoId) { toast('재생목록 링크는 재생할 수 없어요. 재생목록 안의 개별 영상 링크로 추가해주세요.'); return; }
  ytCurrent = id;
  const url = ytWatchUrl(t);
  if (window.api.youtube && window.api.youtube.play) {
    window.api.youtube.play(url);
    ytPlaying = true;
  } else if (window.api.open) {
    window.api.open.external(url); // 구버전 폴백
  }
  renderNowPlaying();
  renderYouTube();
}
function ytToggle() {
  if (!ytCurrent || !(window.api.youtube)) return;
  if (ytPlaying) { window.api.youtube.pause(); ytPlaying = false; }
  else { window.api.youtube.resume(); ytPlaying = true; }
  renderNowPlaying();
}
function ytStop() {
  if (window.api.youtube) window.api.youtube.stop();
  ytPlaying = false; ytCurrent = null;
  renderNowPlaying(); renderYouTube();
}
// 목록에서 curId 다음 트랙 id (없으면 null) — 순서대로 재생 (순수)
function nextTrackId(list, curId) {
  if (!Array.isArray(list)) return null;
  const i = list.findIndex((x) => x.id === curId);
  if (i < 0 || i + 1 >= list.length) return null;
  return list[i + 1].id;
}
// 반복 모드 반영해 다음 재생 id 결정 (순수). null이면 정지.
function resolveNextId(list, curId, repeat) {
  if (repeat === 'one') return curId || null;
  const n = nextTrackId(list, curId);
  if (n) return n;
  if (repeat === 'all' && Array.isArray(list) && list.length) return list[0].id;
  return null;
}
// 현재 곡 종료 → 반복 모드에 따라 다음 곡/처음/현재 재생, 아니면 정지
function playNext() {
  const n = resolveNextId(playlist, ytCurrent, prefs.ytRepeat);
  if (n) playTrack(n);
  else ytStop();
}
const YT_REPEAT_LABEL = { off: '반복 없음', all: '전체 반복', one: '1곡 반복' };
function cycleRepeat() {
  prefs.ytRepeat = prefs.ytRepeat === 'off' ? 'all' : prefs.ytRepeat === 'all' ? 'one' : 'off';
  scheduleSave();
  renderNowPlaying();
}
function renderNowPlaying() {
  const title = $('#yt-np-title'), toggle = $('#yt-toggle'), stop = $('#yt-stop'), rep = $('#yt-repeat');
  const cur = playlist.find((x) => x.id === ytCurrent);
  if (title) title.textContent = cur ? (cur.title || cur.url) : '재생 중인 곡이 없어요';
  if (toggle) { toggle.textContent = ytPlaying ? '일시정지' : '재생'; toggle.disabled = !cur; }
  if (stop) stop.disabled = !cur;
  if (rep) { rep.textContent = YT_REPEAT_LABEL[prefs.ytRepeat] || '반복 없음'; rep.classList.toggle('active', prefs.ytRepeat !== 'off'); }
  const vol = $('#yt-volume');
  if (vol && Number(vol.value) !== prefs.ytVolume) vol.value = String(prefs.ytVolume);
}
function renderYouTube() {
  renderNowPlaying();
  const list = $('#yt-list'); if (!list) return;
  list.innerHTML = '';
  if (!playlist.length) { list.innerHTML = '<div class="empty-hint">유튜브 링크를 추가해 재생목록을 만들어보세요.</div>'; return; }
  for (const t of playlist) {
    const row = document.createElement('div'); row.className = 'yt-row' + (t.id === ytCurrent ? ' playing' : ''); row.dataset.id = t.id;
    const play = document.createElement('button'); play.className = 'yt-play ico'; play.innerHTML = icon('play');
    play.title = '노래 재생 (오디오)';
    play.addEventListener('click', () => playTrack(t.id));
    const name = document.createElement('span'); name.className = 'yt-title'; name.textContent = t.title || t.url;
    name.addEventListener('click', () => playTrack(t.id));
    const del = document.createElement('button'); del.className = 'mini-del'; del.textContent = '×';
    del.addEventListener('click', () => { playlist = playlist.filter((x) => x.id !== t.id); if (ytCurrent === t.id) ytStop(); scheduleSave(); renderYouTube(); });
    row.append(play, name, del);
    list.appendChild(row);
  }
  filterCurrentRows();
}

// ---- 홈 배너 ----
async function setBanner() {
  if (!(window.api.image && window.api.image.pick)) { toast('업데이트가 필요해요(배너).'); return; }
  const r = await window.api.image.pick();
  if (!r || !r.ok) { if (r && r.error && r.error !== 'CANCELED') toast('이미지 오류: ' + r.error); return; }
  banner = r.dataUrl; scheduleSave(); renderBanner(); refreshBannerPreview();
}
function clearBanner() { banner = ''; scheduleSave(); renderBanner(); refreshBannerPreview(); }
function refreshBannerPreview() {
  const pv = $('#banner-preview-img'), pe = $('#banner-preview-empty');
  if (!pv) return;
  if (banner) { pv.src = banner; pv.hidden = false; if (pe) pe.hidden = true; }
  else { pv.hidden = true; pv.removeAttribute('src'); if (pe) pe.hidden = false; }
  applyBannerStyle();
}

// ---- 스티커 (탭별, 드래그) ----
async function addSticker() {
  if (!(window.api.image && window.api.image.pick)) { toast('업데이트가 필요해요(스티커).'); return; }
  const r = await window.api.image.pick();
  if (!r || !r.ok) { if (r && r.error && r.error !== 'CANCELED') toast('이미지 오류: ' + r.error); return; }
  stickers.push({ id: crypto.randomUUID(), view: currentView, src: r.dataUrl, x: 40, y: 40, w: 120 });
  scheduleSave(); renderStickers();
  toast('스티커를 추가했어요. 드래그해서 옮기세요.');
}
function renderStickers() {
  const layer = $('#sticker-layer'); if (!layer) return;
  layer.innerHTML = '';
  for (const s of stickers.filter((x) => x.view === currentView)) {
    const el = document.createElement('div');
    el.className = 'sticker';
    el.style.left = (s.x || 0) + 'px';
    el.style.top = (s.y || 0) + 'px';
    el.style.width = (s.w || 120) + 'px';
    const img = document.createElement('img'); img.src = s.src; img.draggable = false; img.alt = '스티커';
    const del = document.createElement('button'); del.className = 'sticker-del'; del.textContent = '×';
    del.addEventListener('click', () => { stickers = stickers.filter((x) => x.id !== s.id); scheduleSave(); renderStickers(); });
    el.append(img, del);
    // 드래그 이동
    el.addEventListener('pointerdown', (e) => {
      if (e.target === del) return;
      e.preventDefault();
      const layerRect = layer.getBoundingClientRect();
      const offX = e.clientX - layerRect.left - (s.x || 0);
      const offY = e.clientY - layerRect.top - (s.y || 0);
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const move = (ev) => {
        s.x = Math.max(0, ev.clientX - layerRect.left - offX);
        s.y = Math.max(0, ev.clientY - layerRect.top - offY);
        el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
      };
      const up = () => {
        el.classList.remove('dragging');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        scheduleSave();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    layer.appendChild(el);
  }
}

// ---- 데이터 백업 ----
async function exportData() {
  if (!(window.api.data && window.api.data.export)) { toast('업데이트가 필요해요(백업 기능).'); return; }
  const payload = { events, todos, recurring, ledger, works, notes, habits, playlist, banner, bannerCfg, stickers, prefs, firedReminders };
  const r = await window.api.data.export(payload);
  if (r && r.ok) toast('데이터를 저장했어요.');
  else if (r && r.error && r.error !== 'CANCELED') toast('내보내기 실패: ' + r.error);
}
async function importData() {
  if (!(window.api.data && window.api.data.import)) { toast('업데이트가 필요해요(백업 기능).'); return; }
  const r = await window.api.data.import();
  if (!r || !r.ok) { if (r && r.error && r.error !== 'CANCELED') toast('가져오기 실패: ' + r.error); return; }
  const d = r.data || {};
  const arr = (k) => (Array.isArray(d[k]) ? d[k] : []);
  events = Array.isArray(d.events) ? d.events : migrate(d);
  todos = arr('todos'); recurring = arr('recurring'); ledger = arr('ledger');
  works = loadWorks(d); // 신형 works 또는 구형 deadlines+commissions 자동 병합
  notes = arr('notes'); habits = arr('habits');
  playlist = arr('playlist');
  banner = typeof d.banner === 'string' ? d.banner : '';
  bannerCfg = (d.bannerCfg && typeof d.bannerCfg === 'object') ? { height: 180, zoom: 100, posX: 50, posY: 50, ...d.bannerCfg } : { height: 180, zoom: 100, posX: 50, posY: 50 };
  stickers = arr('stickers');
  firedReminders = (d.firedReminders && typeof d.firedReminders === 'object') ? d.firedReminders : {};
  if (d.prefs && typeof d.prefs === 'object') {
    prefs = { theme: 'light', colors: {}, appTitle: '하다', sidebarCollapsed: false, ...d.prefs };
    colors = prefs.colors || {};
    // 가져온 설정 정규화 (범위 밖 값 방지)
    prefs.ytVolume = clampInt(prefs.ytVolume, 0, 100, 100);
    prefs.windowOpacity = clampInt(prefs.windowOpacity, 40, 100, 100);
    prefs.backgroundMaterial = ['none', 'mica', 'acrylic'].includes(prefs.backgroundMaterial) ? prefs.backgroundMaterial : 'none';
    prefs.blurIntensity = clampInt(prefs.blurIntensity, 0, 80, 30);
    prefs.uiScale = clampInt(prefs.uiScale, 80, 150, 100);
    prefs.notifyDeadlines = (typeof prefs.notifyDeadlines === 'boolean') ? prefs.notifyDeadlines : true;
    // 수동 정렬 플래그: 구형 deadlines/commissions → works 로 병합
    const m = (prefs.manual && typeof prefs.manual === 'object') ? prefs.manual : {};
    prefs.manual = { ledger: !!m.ledger, works: !!(m.works || m.deadlines || m.commissions) };
    applyTheme(prefs.theme); applyColors(colors); applyTitle(prefs.appTitle);
    applyShell();
    if (window.api.youtube && window.api.youtube.setVolume) window.api.youtube.setVolume(prefs.ytVolume);
  }
  scheduleSave();
  closeSettingsModal();
  render();
  toast('데이터를 가져왔어요.');
}

// ---- 이벤트 바인딩 ----
function bindUI() {
  const form = $('#event-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const start = $('#f-start').value;
    let end = $('#f-end').value;
    if (timeToMinutes(end) <= timeToMinutes(start)) {
      end = minutesToLabel(timeToMinutes(start) + 60);
    }
    const frv = $('#f-remind') ? $('#f-remind').value : '';
    upsertEvent({
      title: $('#f-title').value.trim(),
      date: $('#f-date').value,
      start, end,
      category: $('#f-category').value.trim(),
      confirmed: $('#f-confirmed').checked,
      notes: $('#f-notes').value,
      remindMin: frv === '' ? null : Number(frv),
    });
    closeModal();
  });
  $('#delete-event-btn').addEventListener('click', () => {
    if (editingId && confirm('이 일정을 삭제할까요?')) { deleteEvent(editingId); closeModal(); }
  });
  $('#cancel-btn').addEventListener('click', closeModal);
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#modal').hidden) closeModal();
    else if ($('#work-modal') && !$('#work-modal').hidden) closeWorkModal();
    else if ($('#recurring-modal') && !$('#recurring-modal').hidden) closeRecurringModal();
    else if (!$('#settings-modal').hidden) closeSettingsModal();
    else if (!$('#banner-modal').hidden) closeBannerModal();
    else if ($('#note-modal') && !$('#note-modal').hidden) closeNoteModal();
  });

  // 작업 편집 모달
  const workForm = $('#work-form');
  if (workForm) workForm.addEventListener('submit', (e) => { e.preventDefault(); saveWorkModal(); });
  const wc = $('#work-close'); if (wc) wc.addEventListener('click', closeWorkModal);
  const wcn = $('#work-cancel'); if (wcn) wcn.addEventListener('click', closeWorkModal);
  const wd = $('#work-del'); if (wd) wd.addEventListener('click', deleteWorkModal);
  const wm = $('#work-modal'); if (wm) wm.addEventListener('click', (e) => { if (e.target === wm) closeWorkModal(); });

  // 반복 항목 날짜 달력 모달
  const rc = $('#rec-close'); if (rc) rc.addEventListener('click', closeRecurringModal);
  const rdn = $('#rec-done'); if (rdn) rdn.addEventListener('click', closeRecurringModal);
  const rm = $('#recurring-modal'); if (rm) rm.addEventListener('click', (e) => { if (e.target === rm) closeRecurringModal(); });
  const rp = $('#rec-prev'); if (rp) rp.addEventListener('click', () => { recMonth = new Date(recMonth.getFullYear(), recMonth.getMonth() - 1, 1); renderRecGrid(); });
  const rn = $('#rec-next'); if (rn) rn.addEventListener('click', () => { recMonth = new Date(recMonth.getFullYear(), recMonth.getMonth() + 1, 1); renderRecGrid(); });

  $('#add-event-btn').addEventListener('click', () => openModal(null));
  $('#prev-week').addEventListener('click', () => { weekStart = addDays(weekStart, -7); render(); });
  $('#next-week').addEventListener('click', () => { weekStart = addDays(weekStart, 7); render(); });
  $('#today-btn').addEventListener('click', () => { weekStart = startOfWeek(new Date()); render(); });


  // 사이드바 메뉴 내비게이션 (Schedule=캘린더, 나머지=각 뷰)
  document.querySelectorAll('[data-nav]').forEach((li) => {
    li.addEventListener('click', () => {
      if (li.id === 'nav-settings') { openSettingsModal(); return; }
      const target = li.dataset.target;
      if (!target) return;
      setActiveNav(li);
      const cur = $('#crumb-cur');
      if (cur) cur.textContent = li.textContent.trim();
      if (target === 'files') { openFiles(); return; }
      showView(target);
    });
  });

  // 설정(색상) 모달
  $('#settings-close').addEventListener('click', closeSettingsModal);
  $('#settings-done').addEventListener('click', closeSettingsModal);
  $('#settings-modal').addEventListener('click', (e) => { if (e.target === $('#settings-modal')) closeSettingsModal(); });
  $('#c-accent').addEventListener('input', () => { colors.accent = $('#c-accent').value; applyColors(colors); saveColors(); });
  $('#c-sidebar').addEventListener('input', () => { colors.sidebar = $('#c-sidebar').value; applyColors(colors); saveColors(); });
  const bindColor = (sel, key) => { const el = $(sel); if (el) el.addEventListener('input', () => { colors[key] = el.value; applyColors(colors); saveColors(); }); };
  bindColor('#c-pagebg', 'pageBg');
  bindColor('#c-panel', 'panel');
  bindColor('#c-text', 'text');
  $('#c-reset').addEventListener('click', resetColors);
  $('#c-title').addEventListener('input', () => { applyTitle($('#c-title').value); scheduleSave(); });
  $('#data-export').addEventListener('click', exportData);
  $('#data-import').addEventListener('click', importData);
  const upBtn = $('#update-check'); if (upBtn) upBtn.addEventListener('click', manualUpdateCheck);
  renderPresets();

  // 창 / 화면 설정 (투명도·블러·배율) — 투명도는 앱 내부(CSS) 방식이라 블러와 동시 사용 가능
  const wOp = $('#w-opacity');
  if (wOp) wOp.addEventListener('input', () => {
    prefs.windowOpacity = Number(wOp.value);
    const ov = $('#w-opacity-val'); if (ov) ov.textContent = prefs.windowOpacity + '%';
    applyGlassCss();
    scheduleSave();
  });
  const wMat = $('#w-material');
  if (wMat) wMat.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', async () => {
    if (!window.api.win) return;
    const r = await window.api.win.setMaterial(b.dataset.m);
    if (!r || !r.ok) {
      toast(r && r.reason === 'UNSUPPORTED' ? '블러는 Windows 11(22H2 이상)에서만 지원돼요.' : '블러를 적용할 수 없어요.');
      return;
    }
    prefs.backgroundMaterial = b.dataset.m;
    applyGlassCss(); syncShellControls(); scheduleSave();
  }));
  const wGl = $('#w-glass');
  if (wGl) wGl.addEventListener('input', () => {
    prefs.blurIntensity = Number(wGl.value);
    const gv = $('#w-glass-val'); if (gv) gv.textContent = prefs.blurIntensity + '%';
    applyGlassCss(); scheduleSave();
  });
  const wSc = $('#w-scale');
  if (wSc) wSc.addEventListener('input', () => {
    prefs.uiScale = Number(wSc.value);
    const sv = $('#w-scale-val'); if (sv) sv.textContent = prefs.uiScale + '%';
    if (window.api.win) window.api.win.setUiScale(prefs.uiScale);
    scheduleSave();
  });
  // 마감 자동 알림 토글
  const dn = $('#pref-deadline-notify');
  if (dn) dn.addEventListener('change', () => { prefs.notifyDeadlines = dn.checked; scheduleSave(); });

  // 미니 달력 이동
  $('#mini-prev').addEventListener('click', () => { miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() - 1, 1); renderMiniCal(); });
  $('#mini-next').addEventListener('click', () => { miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() + 1, 1); renderMiniCal(); });

  // 할일
  $('#todo-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#todo-input').value.trim(); if (!v) return;
    todos.unshift({ id: crypto.randomUUID(), title: v, done: false, createdAt: new Date().toISOString() });
    $('#todo-input').value = ''; scheduleSave(); renderTodos();
  });
  // 반복
  $('#recurring-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#recurring-input').value.trim(); if (!v) return;
    recurring.unshift({ id: crypto.randomUUID(), title: v, rule: $('#recurring-rule').value, lastDone: '' });
    $('#recurring-input').value = ''; scheduleSave(); renderRecurring();
  });

  // 가계부
  // 가계부 수입/지출 토글
  $('#l-type-toggle').querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      ledgerType = b.dataset.t;
      $('#l-type-toggle').querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('on', x === b));
    });
  });
  $('#ledger-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = Number($('#l-amount').value);
    const date = $('#l-date').value || ymd(new Date());
    if (!amount) { toast('금액을 입력하세요.'); return; }
    ledger.unshift({ id: crypto.randomUUID(), date, type: ledgerType, amount, category: $('#l-category').value.trim(), memo: $('#l-memo').value.trim() });
    $('#l-amount').value = ''; $('#l-category').value = ''; $('#l-memo').value = '';
    scheduleSave(); renderLedger();
  });
  $('#ledger-month').addEventListener('change', renderLedger);

  // 작업 월 필터
  $('#deadline-month').addEventListener('change', () => { deadlineMonth = $('#deadline-month').value; renderWorks(); });
  $('#deadline-all').addEventListener('click', () => { deadlineMonth = ''; $('#deadline-month').value = ''; renderWorks(); });

  // 작업 관리 (마감·커미션·외주 통합)
  $('#deadline-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#d-title').value.trim(); const due = $('#d-due').value;
    if (!title || !due) return;
    const status = $('#d-status').value;
    works.push({
      id: crypto.randomUUID(), title, due,
      client: $('#d-client').value.trim(),
      contact: $('#d-contact').value.trim(),
      platform: $('#d-platform').value.trim(),
      type: $('#d-type').value.trim(),
      amount: Number($('#d-amount').value) || 0,
      status, done: status === '완료',
      notes: $('#d-notes').value.trim(), progress: 0,
    });
    ['d-title', 'd-client', 'd-contact', 'd-platform', 'd-type', 'd-amount', 'd-due', 'd-notes'].forEach((id) => { $('#' + id).value = ''; });
    scheduleSave(); renderWorks();
  });

  // 유튜브
  $('#yt-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('#yt-url').value.trim(); if (!url) return;
    const p = parseYouTube(url);
    // 개별 영상 ID가 없는 재생목록 링크는 어떤 곡이 나올지 보장할 수 없어 거부 (오재생 방지)
    if (!p.videoId) {
      toast(p.listId ? '재생목록 링크는 지원하지 않아요. 재생목록 안의 개별 영상 링크를 넣어주세요.' : '유효한 유튜브 링크가 아니에요.');
      return;
    }
    const t = { id: crypto.randomUUID(), title: $('#yt-title-in').value.trim() || url, url, videoId: p.videoId, listId: p.listId };
    playlist.push(t);
    $('#yt-url').value = ''; $('#yt-title-in').value = '';
    scheduleSave(); renderYouTube();
    playTrack(t.id);
  });
  const ytT = $('#yt-toggle'); if (ytT) ytT.addEventListener('click', ytToggle);
  const ytS = $('#yt-stop'); if (ytS) ytS.addEventListener('click', ytStop);
  const ytR = $('#yt-repeat'); if (ytR) ytR.addEventListener('click', cycleRepeat);
  // 음량 슬라이더 (드래그 중 실시간 반영 — 광고 음소거와 분리돼 광고 후에도 음량 유지)
  const ytV = $('#yt-volume');
  if (ytV) ytV.addEventListener('input', () => {
    prefs.ytVolume = Number(ytV.value);
    if (window.api.youtube && window.api.youtube.setVolume) window.api.youtube.setVolume(prefs.ytVolume);
    scheduleSave();
  });
  // 곡 끝나면 목록 다음 곡 자동 재생
  if (window.api.youtube && window.api.youtube.onEnded) window.api.youtube.onEnded(playNext);
  // 트레이 메뉴 재생 제어
  if (window.api.onTrayControl) window.api.onTrayControl((action) => {
    if (action === 'playpause') ytToggle();
    else if (action === 'next') playNext();
  });

  // 꾹 눌러 드래그로 순서 바꾸기
  enableReorder($('#yt-list'), '.yt-row', (ids) => { playlist = reorderByIds(playlist, ids); scheduleSave(); renderYouTube(); });
  enableReorder($('#notes-grid'), '.note-card', (ids) => { notes = reorderByIds(notes, ids); scheduleSave(); renderNotes(); });
  enableReorder($('#ledger-list'), '.ledger-row', (ids) => { ledger = reorderByIds(ledger, ids); prefs.manual.ledger = true; scheduleSave(); renderLedger(); });
  enableReorder($('#deadline-list'), '.deadline-row', (ids) => { works = reorderByIds(works, ids); prefs.manual.works = true; scheduleSave(); renderWorks(); });
  // "자동 정렬" 복귀 버튼
  const autoBtn = (sel, key, render) => { const b = $(sel); if (b) b.addEventListener('click', () => { prefs.manual[key] = false; scheduleSave(); render(); }); };
  autoBtn('#ledger-auto', 'ledger', renderLedger);
  autoBtn('#deadline-auto', 'works', renderWorks);

  // 메모
  $('#note-add').addEventListener('click', addNote);
  $('#note-modal-close').addEventListener('click', closeNoteModal);
  $('#note-modal-done').addEventListener('click', closeNoteModal);
  $('#note-modal').addEventListener('click', (e) => { if (e.target === $('#note-modal')) closeNoteModal(); });

  // 홈 배너 / 편집 모달 / 스티커
  $('#banner-edit').addEventListener('click', openBannerModal);
  $('#banner-clear').addEventListener('click', clearBanner);
  $('#banner-close').addEventListener('click', closeBannerModal);
  $('#banner-done').addEventListener('click', closeBannerModal);
  $('#banner-modal').addEventListener('click', (e) => { if (e.target === $('#banner-modal')) closeBannerModal(); });
  $('#banner-set').addEventListener('click', setBanner);
  $('#banner-reset').addEventListener('click', resetBannerCfg);
  const bcfg = (key, id) => $('#' + id).addEventListener('input', () => { bannerCfg[key] = Number($('#' + id).value); applyBannerStyle(); scheduleSave(); });
  bcfg('height', 'banner-height'); bcfg('zoom', 'banner-zoom'); bcfg('posX', 'banner-posx'); bcfg('posY', 'banner-posy');
  $('#btn-sticker').addEventListener('click', addSticker);

  // 커스텀 타이틀바: 창 최소화 / 최대화·복원 / 닫기
  if (window.api.win) {
    const tbMin = $('#tb-min'), tbMax = $('#tb-max'), tbClose = $('#tb-close');
    if (tbMin) tbMin.addEventListener('click', () => window.api.win.minimize());
    if (tbMax) tbMax.addEventListener('click', async () => {
      const r = await window.api.win.maximizeToggle();
      document.body.classList.toggle('is-max', !!(r && r.maximized));
    });
    if (tbClose) tbClose.addEventListener('click', () => window.api.win.close());
    window.api.win.onMaximized((v) => document.body.classList.toggle('is-max', v));
  }

  // 상단바: 검색 · 설정 · 사용자 칩
  const ts = $('#top-search');
  if (ts) ts.addEventListener('input', () => { searchText = ts.value; applySearch(); });
  const bst = $('#btn-settings-top'); if (bst) bst.addEventListener('click', openSettingsModal);
  const uc = $('#user-chip'); if (uc) uc.addEventListener('click', openSettingsModal);

  // 준비중 패널 → Schedule 복귀
  $('#placeholder-back').addEventListener('click', () => {
    const sched = [...document.querySelectorAll('[data-nav]')]
      .find((n) => n.querySelector('span') && n.querySelector('span').textContent.trim() === '일정');
    if (sched) setActiveNav(sched);
    showCalendar();
  });

  // 사이드바 접기/펼치기 (상태는 db.prefs에 저장)
  const sidebar = document.querySelector('.sidebar');
  if (prefs.sidebarCollapsed) sidebar.classList.add('collapsed');
  const toggleSidebar = () => {
    sidebar.classList.toggle('collapsed');
    prefs.sidebarCollapsed = sidebar.classList.contains('collapsed');
    try { localStorage.setItem('sidebarCollapsed', prefs.sidebarCollapsed ? '1' : '0'); } catch (_) {}
    scheduleSave();
  };
  $('#sidebar-collapse').addEventListener('click', toggleSidebar);
  document.querySelector('.brand').addEventListener('click', () => {
    if (sidebar.classList.contains('collapsed')) toggleSidebar();
  });
  const sbNew = $('#sb-new'); if (sbNew) sbNew.addEventListener('click', primaryAdd);
  const fPick = $('#files-pick'); if (fPick) fPick.addEventListener('click', pickFolder);
  const fUp = $('#files-up'); if (fUp) fUp.addEventListener('click', goUpFolder);

  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
    scheduleSave();
  });
}

// ---- 초기화 ----
async function init() {
  // 1) 데이터 먼저 로드 (설정도 여기서 복원 — localStorage는 origin이 바뀌면 초기화됨)
  let data = {};
  try {
    data = await window.api.load();
    events = migrate(data);
    const arr = (k) => (data && Array.isArray(data[k])) ? data[k] : [];
    todos = arr('todos');
    recurring = arr('recurring');
    ledger = arr('ledger');
    works = loadWorks(data); // 신형 works 또는 구형 deadlines+commissions 자동 병합
    notes = arr('notes');
    habits = arr('habits');
    playlist = arr('playlist');
    banner = typeof data.banner === 'string' ? data.banner : '';
    bannerCfg = (data.bannerCfg && typeof data.bannerCfg === 'object') ? { height: 180, zoom: 100, posX: 50, posY: 50, ...data.bannerCfg } : { height: 180, zoom: 100, posX: 50, posY: 50 };
    stickers = arr('stickers');
  } catch (err) {
    console.error('불러오기 실패:', err);
    events = [];
  }

  // 2) 설정 복원: db.prefs 우선, 없으면 구 localStorage에서 마이그레이션
  const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } };
  const p = (data && data.prefs && typeof data.prefs === 'object') ? data.prefs : {};
  prefs.theme = p.theme || lsGet('theme', 'light');
  try { prefs.colors = p.colors || JSON.parse(lsGet('colors', '{}')) || {}; } catch (_) { prefs.colors = p.colors || {}; }
  prefs.viewColors = (p.viewColors && typeof p.viewColors === 'object') ? p.viewColors : {};
  prefs.ytRepeat = (p.ytRepeat === 'all' || p.ytRepeat === 'one') ? p.ytRepeat : 'off';
  // 수동 정렬 플래그: 구형 deadlines/commissions 플래그를 works 하나로 병합
  const pm = (p.manual && typeof p.manual === 'object') ? p.manual : {};
  prefs.manual = { ledger: !!pm.ledger, works: !!(pm.works || pm.deadlines || pm.commissions) };
  prefs.appTitle = p.appTitle || lsGet('appTitle', '하다');
  prefs.sidebarCollapsed = (typeof p.sidebarCollapsed === 'boolean') ? p.sidebarCollapsed : (lsGet('sidebarCollapsed', '0') === '1');
  prefs.ytVolume = clampInt(p.ytVolume, 0, 100, 100);
  prefs.windowOpacity = clampInt(p.windowOpacity, 40, 100, 100);
  prefs.backgroundMaterial = ['none', 'mica', 'acrylic'].includes(p.backgroundMaterial) ? p.backgroundMaterial : 'none';
  prefs.blurIntensity = clampInt(p.blurIntensity, 0, 80, 30);
  prefs.uiScale = clampInt(p.uiScale, 80, 150, 100);
  prefs.notifyDeadlines = (typeof p.notifyDeadlines === 'boolean') ? p.notifyDeadlines : true;
  prefs.uiRevamp = p.uiRevamp || '';
  firedReminders = (data && data.firedReminders && typeof data.firedReminders === 'object') ? data.firedReminders : {};

  // Google Drive 리스킨 1회 적용: 저장된 커스텀 색을 새 기본 룩(:root 블루)으로 교체.
  // 이후 사용자가 다시 색을 지정하면 그 값 유지(플래그로 1회만).
  if (prefs.uiRevamp !== 'drive') {
    prefs.colors = {};
    prefs.uiRevamp = 'drive';
    try { localStorage.removeItem('colors'); } catch (_) {}
    scheduleSave();
  }

  colors = prefs.colors;
  applyTheme(prefs.theme);
  applyColors(colors);
  applyTitle(prefs.appTitle);
  applyShell(); // 창 투명도/블러/배율을 네이티브 창과 동기화 (main이 시작 시 적용한 값과 정합)
  injectIcons();

  deadlineMonth = monthKey(ymd(new Date())); // 마감 기본: 이번 달
  bindUI();
  const ld = $('#l-date'); if (ld) ld.value = ymd(new Date()); // 가계부 기본 날짜

  setView('calendar'); // 초기 뷰 색(--view-accent) 적용 + hidden 상태 정합
  render();
  notifyToday();

  // 저장된 음량을 메인 프로세스에 전달 (다음 재생부터 적용)
  if (window.api.youtube && window.api.youtube.setVolume) window.api.youtube.setVolume(prefs.ytVolume);

  if (nowTimer) clearInterval(nowTimer);
  nowTimer = setInterval(renderNowLine, 60 * 1000);
  // 일정·마감 알림 스케줄러 (30초 주기 + 시작 직후 1회 — 꺼져 있던 사이 놓친 알림 처리)
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = setInterval(checkReminders, 30 * 1000);
  checkReminders();

  renderStickers(); // 초기 뷰(일정) 스티커 표시

  // 현재 시각 근처로 스크롤
  const body = $('.cal-body');
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  if (body) body.scrollTop = Math.max(minutesToTop(nowMins) - 120, 0);

  checkUpdateOnStart(); // 시작 시 업데이트 자동 확인(+자동 적용)
}

// Electron 렌더러에서만 실행
if (typeof window !== 'undefined' && window.api) {
  init();
}

// 유닛테스트용 export (node 환경)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    startOfWeek, addDays, weekDates, ymd, timeToMinutes, minutesToLabel,
    fmt12, weekRangeLabel, minutesToTop, categoryColor, migrate,
    formatSize, fileIcon, kindLabel, hexToRgb, luminance, idealText,
    monthGrid, recurringDueToday, formatWon, monthKey, sumLedger,
    daysUntil, ddayLabel, computeStreak, icon, parseYouTube, textToHtml, migrateWork, loadWorks,
    mix, stripHtml, ytWatchUrl, nextTrackId, resolveNextId, reorderByIds, VIEW_COLORS, VIEW_META, viewAccent,
    clampInt, eventRemindKey, eventRemindAt, deadlineRemindAt, dueReminders,
    DAY_START, DAY_END, HOUR_HEIGHT,
  };
}
