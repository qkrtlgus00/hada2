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
let alarms = [];      // [{id,at:'YYYY-MM-DDTHH:MM',title}] 사용자가 지정한 날짜+시간 알람
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
  windowTransparent: false, // 기본 불투명(솔리드). 켜면 바탕화면 비침
  notifyDeadlines: true,
  deadlineNotifyTime: '09:00', // 마감 알림 시각(HH:MM) — 전날·당일 이 시각에
  hideStickerTools: false, // 켜면 스티커 클릭 시 버튼 툴바(잠금·투명·앞·뒤·×) 안 뜸
  manual: { ledger: false, works: false },
};
let miniMonth = new Date(); // 미니 달력이 보는 달
let weekStart = startOfWeek(new Date()); // 현재 보는 주의 월요일
let selectedDay = ymd(new Date()); // 할일이 보여줄 날짜(미니 달력에서 선택). 기본 오늘
let dayCursor = ymd(new Date()); // 자정 넘김 감지용 마지막 처리 날짜
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
    paid: !!r.paid,
    ledgerId: r.ledgerId || '',
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
// 반복 항목이 특정 날짜에 대상인지. 지정 날짜(dates)가 있으면 그 날짜에만, 없으면 규칙대로.
function recurringDueOn(rule, dates, dayYmd) {
  if (dates && typeof dates === 'object' && Object.keys(dates).length) return !!dates[dayYmd];
  const dow = new Date(dayYmd + 'T00:00:00').getDay(); // 0=일
  switch (rule) {
    case 'daily': return true;
    case 'weekday': return dow >= 1 && dow <= 5;
    case 'weekly': return dow === 1; // 매주 월요일 기준
    case 'monthly': return Number(dayYmd.slice(8, 10)) === 1;
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
// 그달 지출을 카테고리별로 합산 (내림차순). 빈 카테고리는 '기타'
function sumByCategory(items, ym) {
  const map = new Map();
  for (const it of items || []) {
    if (it.type !== 'expense') continue;
    if (ym && monthKey(it.date) !== ym) continue;
    const cat = (it.category && it.category.trim()) || '기타';
    map.set(cat, (map.get(cat) || 0) + (Number(it.amount) || 0));
  }
  return [...map.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
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

// 중복 방지 키 — 현재 필드로 재계산 (수정/이동 시 새 키). 과거로 바뀐 알림은 disarm으로 무음 처리.
function eventRemindKey(ev) { return `ev:${ev.id}|${ev.date}T${ev.start}|${ev.remindMin}`; }
function workRemindKey(w, slot) { return `dl:${w.id}|${w.due}|${slot}`; }
// 방금 만들거나 수정한 항목의 '이미 지난' 알림을 발송기록에 표시(무음) → 재발송 방지.
// 미래로 재설정하면 새 키가 미표시 상태라 정상적으로 그 시각에 1회 울림.
function disarmPastEventReminder(ev) {
  if (!ev) return;
  const at = eventRemindAt(ev);
  if (at != null && at <= Date.now()) firedReminders[eventRemindKey(ev)] = Date.now();
}
function disarmPastWorkReminders(w) {
  if (!w || !w.due) return;
  const now = Date.now();
  for (const slot of ['D1', 'D0']) {
    const at = deadlineRemindAt(w.due, slot);
    if (Number.isFinite(at) && at <= now) firedReminders[workRemindKey(w, slot)] = now;
  }
}
// 이벤트 알림 시각(epoch ms). remindMin 없으면 null (로컬 시간 기준)
function eventRemindAt(ev) {
  if (ev.remindMin == null || ev.remindMin === '') return null;
  const t = new Date(`${ev.date}T${ev.start}:00`).getTime();
  if (!Number.isFinite(t)) return null;
  return t - Number(ev.remindMin) * 60000;
}
// 마감 알림 시각: slot 'D1'=전날, 'D0'=당일. 시각은 설정(prefs.deadlineNotifyTime, 기본 09:00).
function deadlineRemindAt(due, slot) {
  const d = new Date(`${due}T00:00:00`);
  if (Number.isNaN(d.getTime())) return NaN;
  if (slot === 'D1') d.setDate(d.getDate() - 1);
  const t = /^(\d{1,2}):(\d{2})$/.exec(prefs && prefs.deadlineNotifyTime);
  const h = t ? Math.min(23, Number(t[1])) : DEADLINE_HOUR;
  const m = t ? Math.min(59, Number(t[2])) : 0;
  d.setHours(h, m, 0, 0);
  return d.getTime();
}
// 지금 울려야 할 알림 목록 (순수). silent=true 는 "너무 늦음 → 발송 없이 기록만"
function dueReminders(evs, dls, alrms, fired, now, notifyDl) {
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
      push(workRemindKey(dl, 'D1'), deadlineRemindAt(dl.due, 'D1'), '마감 알림', `내일 마감: ${dl.title} (${dl.due})`);
      push(workRemindKey(dl, 'D0'), deadlineRemindAt(dl.due, 'D0'), '마감 알림', `오늘 마감: ${dl.title}`);
    }
  }
  for (const a of alrms || []) {
    if (!a || !a.at) continue;
    push('alarm:' + a.id, new Date(a.at).getTime(), '알람', a.title || '알람');
  }
  return out;
}

// ===================== 아래는 브라우저(Electron)에서만 실행 =====================
const $ = (s) => (typeof document !== 'undefined' ? document.querySelector(s) : null);

// ---- 저장 ----
let saveTimer = null;
let saveRetry = null;
let saveDirty = false; // 예약/미완료 저장이 있으면 true (종료 시 flush 판단용)
function snapshot() {
  return { events, todos, recurring, ledger, works, notes, habits, alarms, playlist, banner, bannerCfg, stickers, prefs, firedReminders };
}
function scheduleSave() {
  saveDirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await window.api.save(snapshot());
      saveDirty = false;
      if (saveRetry) { clearTimeout(saveRetry); saveRetry = null; }
    } catch (err) {
      console.error('저장 실패:', err);
      toast('저장 실패 — 디스크 공간이나 권한을 확인하세요. 자동 재시도 중…');
      if (!saveRetry) saveRetry = setTimeout(() => { saveRetry = null; scheduleSave(); }, 5000); // 성공할 때까지 재시도
    }
  }, 250);
}

// ---- CRUD ----
function upsertEvent(data) {
  const now = new Date().toISOString();
  let target;
  if (editingId) {
    const ev = events.find((e) => e.id === editingId);
    if (ev) { Object.assign(ev, data, { updatedAt: now }); target = ev; }
  } else {
    target = { id: crypto.randomUUID(), ...data, createdAt: now, updatedAt: now };
    events.push(target);
  }
  disarmPastEventReminder(target); // 과거 시각으로 만든/바꾼 알림은 다시 안 울리게
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
  renderAlarms();
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
      node.dataset.id = ev.id;
      node.addEventListener('click', (e) => { e.stopPropagation(); openModal(ev.id); });
      const rz = document.createElement('div'); rz.className = 'event-resize'; rz.title = '드래그로 길이 조절'; node.appendChild(rz);
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

// ---- 창 셸 (커스텀 타이틀바 / 투명도 / 블러 / 배율) ----
let materialOk = false; // 이 OS에서 미카/아크릴 지원 여부 (window:getState로 확인)

// 창 투명도·흐림을 CSS 표면 알파로 반영 (창 자체가 transparent라 실제 바탕화면이 비침).
// 페이지(여백)는 더 강하게 비치고(하한 낮음), 표면(사이드바/본문)은 글자 뒤 최소 대비를 위해
// 덜 비치게(하한 높음) 한다. 글자는 여기에 더해 text-shadow로 항상 또렷하게 보호.
function applyGlassCss() {
  const root = document.documentElement;
  // 불투명 모드: 표면을 100% 불투명 + 각진 모서리로 강제(즉시 전환, 창은 계속 투명이지만 완전 솔리드처럼 보임)
  if (!prefs.windowTransparent) {
    root.classList.add('app-opaque');
    root.classList.remove('glass-frost');
    root.style.setProperty('--bg-opaque', '100%');
    root.style.setProperty('--surface-opaque', '100%');
    root.style.setProperty('--glass-blur', '0px');
    return;
  }
  root.classList.remove('app-opaque');
  const r = document.documentElement.style;
  // 뿌연 유리(프로스트): 네이티브 재질 없이 CSS 우윳빛 막 → 바탕 은은히 비침, 깜빡임 없음(재질 안 켬)
  if (prefs.backgroundMaterial === 'frost') {
    root.classList.add('glass-frost');
    const op = clampInt(prefs.windowOpacity, 15, 100, 100);
    const fog = clampInt(prefs.blurIntensity, 0, 100, 30); // 위에 얹는 유리 질감 농도(미카 블러는 고정)
    r.setProperty('--bg-opaque', Math.max(Math.round(op * 0.3), 12) + '%');        // 가볍게 → 네이티브 미카 블러가 비쳐 보임
    r.setProperty('--surface-opaque', Math.max(Math.round(op * 0.6), 45) + '%');
    r.setProperty('--frost-veil', (4 + Math.round(fog * 0.3)) + '%');             // 4~34% 가벼운 유리 질감(미카 위에)
    r.setProperty('--glass-blur', '0px');
    return;
  }
  root.classList.remove('glass-frost');
  // '블러 강도'(0~100)는 재질(미카/아크릴)과 무관하게 항상 적용 — 실제 블러 + 비침을 함께 키움
  const base = clampInt(prefs.windowOpacity, 15, 100, 100);           // 15~100
  const extra = clampInt(prefs.blurIntensity, 0, 100, 30);            // 0~100
  const bg = Math.max(base - extra, 4);                      // 페이지 여백: 하한 4%
  const surface = Math.max(base - Math.round(extra * 0.6), 12); // 표면: 하한 12%(가독성은 text-shadow로 보호)
  r.setProperty('--bg-opaque', bg + '%');
  r.setProperty('--surface-opaque', surface + '%');
  r.setProperty('--glass-blur', Math.round(extra * 0.28) + 'px'); // 0~100 → 0~28px 실제 backdrop 블러
}
// 저장된 셸 설정을 네이티브 창에 재적용 (시작 시 main이 적용한 값과 동기화 + 미지원 OS 자가치유)
async function applyShell() {
  if (!(window.api && window.api.win)) return;
  try {
    const st = await window.api.win.getState();
    materialOk = !!(st && st.materialSupported);
    document.body.classList.toggle('is-max', !!(st && st.maximized));
  } catch (_) {}
  // 진짜 배경 블러 = 미카뿐(아크릴은 깜빡임이라 제거). '미카'·'뿌연' 둘 다 네이티브 미카 사용.
  if (prefs.backgroundMaterial === 'mica' || prefs.backgroundMaterial === 'frost') {
    const r = await window.api.win.setMaterial('mica').catch(() => null);
    // 미카 미지원(Win10 등): 순수 '미카'는 none으로 자가치유, '뿌연'은 CSS 질감으로 유지
    if ((!r || !r.ok) && prefs.backgroundMaterial === 'mica') prefs.backgroundMaterial = 'none';
  }
  window.api.win.setUiScale(prefs.uiScale);
  applyGlassCss(); // 투명도는 이제 네이티브가 아니라 CSS로 (win.setOpacity 미사용)
}
// 설정 모달의 창/화면 컨트롤을 현재 prefs와 동기화
function syncShellControls() {
  const tr = $('#w-transparent'); if (tr) tr.checked = !!prefs.windowTransparent;
  const op = $('#w-opacity'), ov = $('#w-opacity-val'), oh = $('#w-opacity-hint');
  if (op) { op.value = String(prefs.windowOpacity); op.disabled = !prefs.windowTransparent; } // 투명 효과 꺼짐 → 투명도 무의미
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
    // 미카/아크릴만 네이티브 지원 필요 (없음·뿌연은 CSS라 항상 사용 가능)
    const unsupported = (b.dataset.m === 'mica' || b.dataset.m === 'acrylic') && !materialOk;
    b.disabled = unsupported;
    b.title = unsupported ? 'Windows 11(22H2 이상)에서만 지원돼요.' : '';
  });
  const dn = $('#pref-deadline-notify'); if (dn) dn.checked = prefs.notifyDeadlines !== false;
  const dt = $('#pref-deadline-time'); if (dt) dt.value = prefs.deadlineNotifyTime || '09:00';
  const hst = $('#pref-hide-sticker-tools'); if (hst) hst.checked = !!prefs.hideStickerTools;
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

// 일정 블록을 꾹 눌러(롱프레스) 드래그해 시간/요일을 옮기기. #day-cols에 1회 위임 바인딩.
function enableEventDrag() {
  const host = $('#day-cols');
  if (!host || host.dataset.dragBound) return;
  host.dataset.dragBound = '1';
  let timer = null, node = null, ev = null, dragging = false;
  let startX = 0, startY = 0, grabOffsetY = 0, durationM = 60, didDrag = false, lastDragEnd = 0;
  let dropMins = 0, dropColIdx = 0;
  let resizing = false, startM = 0, dropEndMins = 0; // 아래 가장자리 길이 조절
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const reset = () => { clearTimer(); node = null; ev = null; dragging = false; didDrag = false; resizing = false; };
  const startDrag = (pid) => {
    if (!node) return;
    dragging = true;
    node.classList.add('event-dragging');
    document.body.classList.add('reordering');
    try { node.setPointerCapture(pid); } catch (_) {}
  };
  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const target = e.target.closest('.event');
    if (!target || !host.contains(target)) return;
    const found = events.find((x) => x.id === target.dataset.id);
    if (!found) return;
    node = target; ev = found; dragging = false; didDrag = false;
    // 아래 가장자리 핸들 → 즉시 길이 조절(롱프레스 없이)
    if (e.target.closest('.event-resize')) {
      resizing = true;
      startM = timeToMinutes(ev.start);
      dropEndMins = timeToMinutes(ev.end);
      node.classList.add('event-resizing');
      try { node.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    startX = e.clientX; startY = e.clientY;
    grabOffsetY = e.clientY - target.getBoundingClientRect().top;
    durationM = Math.max(timeToMinutes(ev.end) - timeToMinutes(ev.start), 20);
    dropMins = timeToMinutes(ev.start);
    dropColIdx = [...host.querySelectorAll('.day-col')].indexOf(target.parentElement);
    const pid = e.pointerId;
    clearTimer();
    timer = setTimeout(() => startDrag(pid), 350);
  };
  const onMove = (e) => {
    if (resizing) {
      didDrag = true; e.preventDefault();
      const colRect = node.parentElement.getBoundingClientRect();
      let end = DAY_START * 60 + Math.round(((e.clientY - colRect.top) / HOUR_HEIGHT) * 60 / 15) * 15;
      end = Math.max(startM + 20, Math.min(end, DAY_END * 60)); // 최소 20분, DAY_END 클램프
      node.style.height = `${Math.max((end - startM) / 60 * HOUR_HEIGHT - 4, 20)}px`;
      dropEndMins = end;
      return;
    }
    if (!dragging) {
      if (timer) {
        const dx = Math.abs(e.clientX - startX), dy = Math.abs(e.clientY - startY);
        if (dx > 8 || dy > 8) clearTimer(); // 스크롤/선택 의도 → 롱프레스 취소
      }
      return;
    }
    didDrag = true;
    e.preventDefault();
    // 드래그 노드를 잠시 통과시켜 포인터 아래의 요일 열을 판정
    node.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    node.style.pointerEvents = '';
    const cols = [...host.querySelectorAll('.day-col')];
    let col = under && under.closest ? under.closest('.day-col') : null;
    if (!col || !host.contains(col)) col = node.parentElement;
    const colRect = col.getBoundingClientRect();
    let mins = DAY_START * 60 + Math.round(((e.clientY - grabOffsetY - colRect.top) / HOUR_HEIGHT) * 60 / 15) * 15;
    mins = Math.min(Math.max(mins, DAY_START * 60), DAY_END * 60 - durationM);
    if (node.parentElement !== col) col.appendChild(node);
    node.style.top = `${minutesToTop(mins)}px`;
    dropMins = mins;
    dropColIdx = cols.indexOf(col);
  };
  const onUp = () => {
    clearTimer();
    if (resizing) {
      node.classList.remove('event-resizing');
      if (didDrag && ev) {
        const ne = minutesToLabel(dropEndMins);
        if (ne !== ev.end) {
          ev.end = ne; ev.updatedAt = new Date().toISOString();
          disarmPastEventReminder(ev);
          scheduleSave();
        }
        lastDragEnd = Date.now(); // 리사이즈 직후 click(수정모달) 억제
        render();
      }
      reset(); return;
    }
    if (dragging) {
      node.classList.remove('event-dragging');
      document.body.classList.remove('reordering');
      if (didDrag && ev && dropColIdx >= 0) {
        const newDate = ymd(weekDates(weekStart)[dropColIdx] || new Date());
        const newStart = minutesToLabel(dropMins);
        const newEnd = minutesToLabel(dropMins + durationM);
        if (newDate !== ev.date || newStart !== ev.start || newEnd !== ev.end) {
          ev.date = newDate; ev.start = newStart; ev.end = newEnd;
          ev.updatedAt = new Date().toISOString();
          disarmPastEventReminder(ev); // 과거로 옮긴 알림은 다시 울리지 않게
          scheduleSave();
        }
        lastDragEnd = Date.now();
        render();
      }
    }
    reset();
  };
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  // 드래그 직후 뒤따르는 click(=수정 모달)만 무시
  host.addEventListener('click', (e) => { if (Date.now() - lastDragEnd < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
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
  notes: '#0ea5a4', youtube: '#e5487f',
};
// 설정에서 뷰 색을 노출할 항목 (라벨)
const VIEW_META = [
  { view: 'home', label: '홈' }, { view: 'calendar', label: '일정' },
  { view: 'ledger', label: '가계부' }, { view: 'deadlines', label: '작업 관리' },
  { view: 'notes', label: '메모' },
  { view: 'youtube', label: '음악' },
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
  renderSidebarStats();
  renderStickers();
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
  const key = 'today:' + todayStr;
  if (firedReminders[key]) return; // 오늘 이미 요약 알림함 → 재시작/새로고침 시 중복 방지
  const todays = events.filter((e) => e.date === todayStr);
  if (todays.length === 0) return;
  firedReminders[key] = Date.now();
  scheduleSave();
  const first = [...todays].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))[0];
  window.api.notify('오늘 일정', `오늘 ${todays.length}개 · 첫 일정: ${first.title} ${fmt12(first.start)}`);
}

// 30초마다 울릴 알림 확인 — 발송 기록(firedReminders)은 data.json에 저장돼 재시작에도 중복 없음
function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const h of dueReminders(events, works, alarms, firedReminders, now, prefs.notifyDeadlines !== false)) {
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
    b.className = 'mini-day' + (c.inMonth ? '' : ' out') + (cellYmd === today ? ' today' : '') + (cellYmd === selectedDay ? ' selected' : '') + (weekSet.has(cellYmd) ? ' in-week' : '');
    b.textContent = c.d;
    b.addEventListener('click', () => { selectedDay = cellYmd; weekStart = startOfWeek(new Date(c.y, c.m, c.d)); render(); });
    grid.appendChild(b);
  }
}

// ---- 할일 ----
// 날짜 없는 옛 할일에 date를 채움(생성일 기준, 없으면 오늘)
function migrateTodoDates() {
  const today = ymd(new Date());
  for (const t of todos) {
    if (!t.date) t.date = t.createdAt ? ymd(new Date(t.createdAt)) : today;
  }
}
// 미완료이면서 오늘 이전인 할일을 오늘로 이동. 이동한 개수 반환
function rolloverTodos() {
  const today = ymd(new Date());
  let moved = 0;
  for (const t of todos) {
    if (!t.date) t.date = today;
    if (!t.done && t.date < today) { t.date = today; moved++; }
  }
  return moved;
}
// 자정을 넘겼으면 롤오버 + (오늘을 보고 있었으면) 선택일 전진 후 재렌더
function maybeRollDay() {
  const today = ymd(new Date());
  if (today === dayCursor) return;
  const wasOnToday = (selectedDay === dayCursor);
  dayCursor = today;
  const moved = rolloverTodos();
  if (wasOnToday) selectedDay = today;
  if (moved) scheduleSave();
  render();
}
// 할일 카드 상단 날짜 라벨 (오늘이면 '오늘 ·' 접두)
function todoDayLabel(dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const dow = DOW_KO[(new Date(y, m - 1, d).getDay() + 6) % 7];
  const base = `${m}/${d} (${dow})`;
  return dayStr === ymd(new Date()) ? `오늘 · ${base}` : base;
}
function renderTodos() {
  const list = $('#todo-list'); if (!list) return;
  list.innerHTML = '';
  const today = ymd(new Date());
  const dayTodos = todos.filter((t) => (t.date || today) === selectedDay);
  const active = dayTodos.filter((t) => !t.done).length;
  const cnt = $('#todo-count'); if (cnt) cnt.textContent = dayTodos.length ? `${active}/${dayTodos.length}` : '';
  const lbl = $('#todo-day-label'); if (lbl) lbl.textContent = todoDayLabel(selectedDay);
  const tbtn = $('#todo-today'); if (tbtn) tbtn.hidden = (selectedDay === today);
  for (const t of dayTodos) {
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
  const day = selectedDay; // 선택한 날짜에 해당하는 반복만 표시
  for (const r of recurring) {
    if (!recurringDueOn(r.rule, r.dates, day)) continue; // 그날 대상이 아니면 안 뜸
    const hasDates = r.dates && Object.keys(r.dates).length > 0;
    const map = recDoneMap(r);
    const doneOnDay = !!map[day];
    const li = document.createElement('li');
    li.className = 'mini-item' + (doneOnDay ? ' done' : '');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = doneOnDay;
    cb.addEventListener('change', () => { if (cb.checked) map[day] = true; else delete map[day]; recSyncLastDone(r); scheduleSave(); renderRecurring(); });
    const sp = document.createElement('span'); sp.className = 'mini-item-text rec-open'; sp.textContent = r.title; sp.title = '날짜 지정 달력 열기'; sp.style.cursor = 'pointer';
    sp.addEventListener('click', () => openRecurringModal(r.id));
    const tag = document.createElement('em'); tag.className = 'mini-tag'; tag.textContent = hasDates ? '지정일' : (RULE_LABEL[r.rule] || r.rule); tag.style.cursor = 'pointer';
    tag.addEventListener('click', () => openRecurringModal(r.id));
    const cal = document.createElement('button'); cal.type = 'button'; cal.className = 'rec-cal-btn'; cal.textContent = '📅'; cal.title = '날짜 지정 (이 날짜에만 뜨게)';
    cal.addEventListener('click', (e) => { e.stopPropagation(); openRecurringModal(r.id); });
    const del = document.createElement('button'); del.className = 'mini-del'; del.textContent = '×';
    del.addEventListener('click', () => { recurring = recurring.filter((x) => x.id !== r.id); scheduleSave(); renderRecurring(); });
    li.append(cb, sp, tag, cal, del); list.appendChild(li);
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
  if (!r.dates || typeof r.dates !== 'object') r.dates = {};
  const map = r.dates; // 완료가 아니라 '이 날짜에 뜨게' 지정 맵
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
      scheduleSave(); renderRecGrid();
    });
    grid.appendChild(b);
  }
}

// ---- 알람 (사용자 지정 날짜+시간에 1회 알림) ----
function fmtAlarmAt(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return String(at || '');
  let h = d.getHours(); const min = String(d.getMinutes()).padStart(2, '0');
  const ap = h < 12 ? '오전' : '오후'; h %= 12; if (h === 0) h = 12;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${ap} ${h}:${min}`;
}
function renderAlarms() {
  const list = $('#alarm-list'); if (!list) return;
  list.innerHTML = '';
  const now = Date.now();
  const sorted = alarms.slice().sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  for (const a of sorted) {
    const past = new Date(a.at).getTime() < now; // 이미 지난(울린) 알람은 흐리게
    const li = document.createElement('li');
    li.className = 'mini-item' + (past ? ' done' : '');
    const sp = document.createElement('span'); sp.className = 'mini-item-text'; sp.textContent = a.title || '알람';
    const tag = document.createElement('em'); tag.className = 'mini-tag'; tag.textContent = fmtAlarmAt(a.at);
    const del = document.createElement('button'); del.className = 'mini-del'; del.textContent = '×';
    del.addEventListener('click', () => { alarms = alarms.filter((x) => x.id !== a.id); scheduleSave(); renderAlarms(); });
    li.append(sp, tag, del); list.appendChild(li);
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
    if (im) {
      const pan = Math.max(0, z - 1); // 줌으로 생긴 넘침(overflow)만큼 팬 가능
      const tx = (50 - px) * pan, ty = (50 - py) * pan; // 좌우/상하 이동(object-position로 안 되는 가로 보완)
      im.style.transform = `translate(${tx}%, ${ty}%) scale(${z})`;
      im.style.objectPosition = `${px}% ${py}%`;
    }
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
// 홈 카드 선택 인덱스 (1번 클릭=선택, 다시 클릭/더블클릭=진입)
let homeSelectedIdx = -1;
function renderHome() {
  renderBanner();
  const grid = $('#home-grid'); if (!grid) return;
  const today = ymd(new Date());
  const ym = monthKey(today);
  const todayEvents = events.filter((e) => e.date === today).length;
  const activeTodos = todos.filter((t) => !t.done).length;
  const upcoming = works.filter((d) => d.status !== '완료' && d.due).sort((a, b) => a.due.localeCompare(b.due));
  const led = sumLedger(ledger, ym);
  const recentNote = notes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  const memoPreview = recentNote ? (notePreview(recentNote).slice(0, 24) || '(빈 메모)') : '없음';
  const cards = [
    { ic: 'calendar', label: '오늘 일정', value: `${todayEvents}건`, view: 'calendar' },
    { ic: 'check', label: '남은 할일', value: `${activeTodos}개`, view: 'calendar' },
    { ic: 'clock', label: '다가오는 마감', value: upcoming.length ? `${upcoming[0].title} · ${ddayLabel(daysUntil(upcoming[0].due, today))}` : '없음', view: 'deadlines' },
    { ic: 'wallet', label: '이번 달 지출', value: formatWon(led.expense), view: 'ledger' },
    { ic: 'check', label: '진행중 작업', value: works.filter((w) => w.status === '진행중').length + '건', view: 'deadlines' },
    { ic: 'note', label: '메모', value: memoPreview, view: 'notes' },
  ];
  grid.innerHTML = '';
  cards.forEach((c, i) => {
    const el = document.createElement('button');
    el.className = 'home-card' + (i === homeSelectedIdx ? ' selected' : '');
    el.innerHTML = '<div class="hc-icon"></div><div class="hc-label"></div><div class="hc-value"></div>';
    el.querySelector('.hc-icon').innerHTML = icon(c.ic);
    el.querySelector('.hc-label').textContent = c.label;
    el.querySelector('.hc-value').textContent = c.value;
    // 1번 클릭 = 선택(강조), 이미 선택된 카드 다시 클릭 = 진입. 더블클릭 = 항상 진입.
    el.addEventListener('click', () => {
      if (homeSelectedIdx === i) { activateNavByTarget(c.view); return; }
      homeSelectedIdx = i;
      grid.querySelectorAll('.home-card').forEach((n, idx) => n.classList.toggle('selected', idx === homeSelectedIdx));
    });
    el.addEventListener('dblclick', () => activateNavByTarget(c.view));
    grid.appendChild(el);
  });
}

// ---- 가계부 ----
// 가계부 카테고리별 지출 통계 (도넛 + 막대). 라이브러리 없이 순수 CSS
function renderLedgerStats(ym) {
  const box = $('#ledger-stats'); if (!box) return;
  const cats = sumByCategory(ledger, ym);
  const total = cats.reduce((s, c) => s + c.total, 0);
  if (!cats.length || total <= 0) { box.innerHTML = ''; box.hidden = true; return; }
  box.hidden = false;
  const max = cats[0].total;
  let acc = 0;
  const segs = cats.map((c) => {
    const start = (acc / total) * 360; acc += c.total; const end = (acc / total) * 360;
    return `${categoryColor(c.category)[1]} ${start}deg ${end}deg`;
  }).join(', ');
  const rows = cats.map((c) => {
    const pct = Math.round((c.total / total) * 100);
    const w = Math.max((c.total / max) * 100, 3);
    const col = categoryColor(c.category)[1];
    return `<div class="lstat-row">`
      + `<span class="lstat-name"><i class="lstat-dot" style="background:${col}"></i>${textToHtml(c.category)}</span>`
      + `<span class="lstat-bar"><span class="lstat-bar-fill" style="width:${w}%;background:${col}"></span></span>`
      + `<span class="lstat-amt">${formatWon(c.total)} <em>${pct}%</em></span>`
      + `</div>`;
  }).join('');
  box.innerHTML =
    `<div class="lstat-head">이 달 지출 분석</div>`
    + `<div class="lstat-body">`
    + `<div class="lstat-donut" style="background:conic-gradient(${segs})"><div class="lstat-hole"><span>지출</span><strong>${formatWon(total)}</strong></div></div>`
    + `<div class="lstat-rows">${rows}</div>`
    + `</div>`;
}
function renderLedger() {
  const monthEl = $('#ledger-month');
  if (monthEl && !monthEl.value) monthEl.value = monthKey(ymd(new Date()));
  const ym = (monthEl && monthEl.value) || monthKey(ymd(new Date()));
  const s = sumLedger(ledger, ym);
  $('#ledger-summary').innerHTML =
    `<div class="lsum income"><span>수입</span><strong>${formatWon(s.income)}</strong></div>` +
    `<div class="lsum expense"><span>지출</span><strong>${formatWon(s.expense)}</strong></div>` +
    `<div class="lsum balance"><span>잔액</span><strong>${formatWon(s.balance)}</strong></div>`;
  renderLedgerStats(ym);
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
      `<div class="lsum"><span>미완료 금액</span><strong>${formatWon(totalOpen)}</strong></div>` +
      `<div class="lsum"><span>미수금</span><strong>${formatWon(scope.filter((d) => d.status === '완료' && !d.paid).reduce((s, d) => s + (Number(d.amount) || 0), 0))}</strong></div>`;
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
    del.addEventListener('click', () => deleteWork(it.id));
    row.append(body, sel);
    if (Number(it.amount) > 0) {
      const paidBtn = document.createElement('button');
      paidBtn.type = 'button';
      paidBtn.className = 'dl-paid' + (it.paid ? ' on' : '');
      paidBtn.textContent = it.paid ? '입금완료' : '미수금';
      paidBtn.title = '클릭하면 입금 상태 전환 (입금 시 가계부 수입 자동 기록)';
      paidBtn.addEventListener('click', (e) => { e.stopPropagation(); setWorkPaid(it, !it.paid); });
      row.append(paidBtn);
    }
    row.append(badge, del);
    list.appendChild(row);
  }
  filterCurrentRows();
  renderSidebarStats();
}

// 작업 입금 상태 토글 + 가계부 '수입' 자동 연동 (ledgerId로 중복 방지)
function setWorkPaid(w, paid) {
  if (!w) return;
  const amt = Number(w.amount) || 0;
  if (paid && amt > 0) {
    const e = w.ledgerId ? ledger.find((x) => x.id === w.ledgerId) : null;
    if (e) { e.amount = amt; e.memo = w.title || ''; } // 이미 연동됨 → 금액/메모 동기화
    else {
      const entry = { id: crypto.randomUUID(), date: ymd(new Date()), type: 'income', amount: amt, category: '작업 입금', memo: w.title || '' };
      ledger.unshift(entry);
      w.ledgerId = entry.id;
    }
  } else if (w.ledgerId) { // 미입금/금액0 → 연동된 수입 제거
    ledger = ledger.filter((x) => x.id !== w.ledgerId);
    w.ledgerId = '';
  }
  w.paid = !!paid;
  scheduleSave(); renderWorks(); renderLedger();
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
  const wp = $('#w-paid'); if (wp) wp.checked = !!w.paid;
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
  disarmPastWorkReminders(w); // 과거 마감으로 바꾼 알림은 다시 안 울리게
  setWorkPaid(w, $('#w-paid') ? $('#w-paid').checked : !!w.paid); // 입금 상태 반영 + 가계부 연동 + 저장/렌더
  closeWorkModal();
}
// 작업 삭제 — 입금 연동으로 만들어진 가계부 수입도 함께 회수(유령 수입 방지)
function deleteWork(id) {
  const w = works.find((x) => x.id === id);
  if (w && w.ledgerId) ledger = ledger.filter((x) => x.id !== w.ledgerId);
  works = works.filter((x) => x.id !== id);
  scheduleSave(); renderWorks(); renderLedger();
}
function deleteWorkModal() {
  if (editingWorkId && confirm('이 작업을 삭제할까요?')) {
    deleteWork(editingWorkId); closeWorkModal();
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

// ---- 스티커 (탭별, 드래그·크기·회전·투명도·앞뒤·잠금) ----
async function addSticker() {
  if (!(window.api.image && window.api.image.pick)) { toast('업데이트가 필요해요(스티커).'); return; }
  const r = await window.api.image.pick();
  if (!r || !r.ok) { if (r && r.error && r.error !== 'CANCELED') toast('이미지 오류: ' + r.error); return; }
  const fx = 0.5, fy = 0.5; // 새 스티커는 레이어(창) 정중앙에 (렌더 시 translate(-50%,-50%) 중심 기준)
  stickers.push({ id: crypto.randomUUID(), view: currentView, src: r.dataUrl, fx, fy, w: 120, rot: 0, opacity: 100, locked: false });
  scheduleSave(); renderStickers();
  toast('스티커를 추가했어요. 드래그로 이동, 모서리로 크기/회전, 위 버튼으로 꾸며요.');
}
let selectedStickerId = null; // 클릭으로 선택된 스티커 → 버튼 툴바 고정 표시
function markStickerSelection() {
  const layer = $('#sticker-layer'); if (!layer) return;
  layer.querySelectorAll('.sticker').forEach((n) => n.classList.toggle('selected', n.dataset.id === selectedStickerId));
}
function renderStickers() {
  const layer = $('#sticker-layer'); if (!layer) return;
  layer.innerHTML = '';
  for (const s of stickers.filter((x) => x.view === currentView)) {
    const rot = Number(s.rot) || 0;
    const opacity = s.opacity == null ? 100 : Number(s.opacity);
    const locked = !!s.locked;
    const el = document.createElement('div');
    el.className = 'sticker' + (locked ? ' locked' : '') + (s.id === selectedStickerId ? ' selected' : '');
    el.dataset.id = s.id;
    el.style.width = (s.w || 120) + 'px';
    el.style.opacity = String(Math.max(0, Math.min(100, opacity)) / 100);
    const hasFrac = (typeof s.fx === 'number' && typeof s.fy === 'number');
    if (hasFrac) {
      // 위치를 레이어의 분수(중심 기준)로 → 창 크기가 바뀌어도 CSS가 상대 위치(가운데면 가운데) 유지
      el.style.left = (s.fx * 100) + '%';
      el.style.top = (s.fy * 100) + '%';
      el.style.transform = 'translate(-50%, -50%) rotate(' + rot + 'deg)';
    } else {
      // 옛 절대 px 스티커: 우선 그대로 그리고 이미지 로드 후 중심 분수로 마이그레이션
      el.style.left = (s.x || 0) + 'px';
      el.style.top = (s.y || 0) + 'px';
      el.style.transform = 'rotate(' + rot + 'deg)';
    }
    const img = document.createElement('img'); img.src = s.src; img.draggable = false; img.alt = '스티커';
    el.appendChild(img);

    // 툴바 (hover 표시)
    const tools = document.createElement('div'); tools.className = 'sticker-tools';
    const mkBtn = (label, title, fn) => {
      const b = document.createElement('button'); b.className = 'st-btn'; b.textContent = label; b.title = title;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    const lockBtn = mkBtn(locked ? '해제' : '잠금', locked ? '잠금 해제' : '고정', () => { s.locked = !locked; scheduleSave(); renderStickers(); });
    tools.appendChild(lockBtn);
    if (!locked) {
      tools.appendChild(mkBtn('투명', '투명도 바꾸기', () => { s.opacity = (opacity <= 40 ? 100 : opacity - 30); scheduleSave(); renderStickers(); }));
      tools.appendChild(mkBtn('앞', '맨 앞으로', () => { stickers = stickers.filter((x) => x.id !== s.id); stickers.push(s); scheduleSave(); renderStickers(); }));
      tools.appendChild(mkBtn('뒤', '맨 뒤로', () => { stickers = stickers.filter((x) => x.id !== s.id); stickers.unshift(s); scheduleSave(); renderStickers(); }));
      tools.appendChild(mkBtn('×', '삭제', () => { stickers = stickers.filter((x) => x.id !== s.id); scheduleSave(); renderStickers(); }));
    }
    el.appendChild(tools);
    // 이미지 로드(높이 확정) 후: 옛 px면 중심 분수로 마이그레이션, 그리고 툴바 위/아래(잘림 방지) 판정
    const onReady = () => {
      if (!el.isConnected) return; // 이전 렌더의 잔류 콜백(분리된 요소) 무시 → 잘못된 좌표(0) 저장 방지
      const lw = layer.clientWidth || 1, lh = layer.clientHeight || 1;
      const lr = layer.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.width < 1 || lr.width < 1) return; // 아직 레이아웃 전(뷰 숨김 등) → 다음 렌더에서 재시도
      if (typeof s.fx !== 'number' || typeof s.fy !== 'number') {
        s.fx = Math.max(0, Math.min(1, (r.left + r.width / 2 - lr.left) / lw));
        s.fy = Math.max(0, Math.min(1, (r.top + r.height / 2 - lr.top) / lh));
        el.style.left = (s.fx * 100) + '%';
        el.style.top = (s.fy * 100) + '%';
        el.style.transform = 'translate(-50%, -50%) rotate(' + (Number(s.rot) || 0) + 'deg)';
        scheduleSave();
      }
      tools.classList.toggle('below', (r.top - lr.top) < 40);
    };
    // setTimeout(백그라운드 창에서도 실행 — rAF는 창이 가려지면 멈춰 마이그레이션이 안 됨)
    if (img.complete && img.naturalHeight) setTimeout(onReady, 0);
    else img.addEventListener('load', onReady);

    if (!locked) {
      // 크기 조절 핸들 (우하단)
      const resize = document.createElement('div'); resize.className = 'st-handle st-resize'; resize.title = '드래그로 크기 조절';
      resize.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        selectedStickerId = s.id; markStickerSelection(); // 크기조절 시작 시 툴바·핸들 고정
        const startX = e.clientX, startW = s.w || 120;
        resize.setPointerCapture(e.pointerId);
        const move = (ev) => { s.w = Math.max(40, Math.min(600, startW + (ev.clientX - startX))); el.style.width = s.w + 'px'; };
        const up = () => { resize.removeEventListener('pointermove', move); resize.removeEventListener('pointerup', up); scheduleSave(); };
        resize.addEventListener('pointermove', move); resize.addEventListener('pointerup', up);
      });
      el.appendChild(resize);
      // 회전 핸들 (상단 중앙)
      const rotH = document.createElement('div'); rotH.className = 'st-handle st-rot'; rotH.title = '드래그로 회전 (Shift=15° 스냅)';
      rotH.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        selectedStickerId = s.id; markStickerSelection(); // 회전 시작 시 툴바·핸들 고정
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        rotH.setPointerCapture(e.pointerId);
        const move = (ev) => {
          let deg = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
          if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
          s.rot = Math.round(deg);
          el.style.transform = (typeof s.fx === 'number' ? 'translate(-50%, -50%) ' : '') + 'rotate(' + s.rot + 'deg)';
        };
        const up = () => { rotH.removeEventListener('pointermove', move); rotH.removeEventListener('pointerup', up); scheduleSave(); };
        rotH.addEventListener('pointermove', move); rotH.addEventListener('pointerup', up);
      });
      el.appendChild(rotH);
    }

    // 클릭 = 선택(버튼 툴바 고정) / 드래그 = 이동. 핸들·툴바(버튼)는 자체 처리라 제외.
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.st-handle, .sticker-tools')) return;
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      let moved = false;
      const layerRect = layer.getBoundingClientRect();
      const lw = layer.clientWidth || 1, lh = layer.clientHeight || 1;
      const rr = el.getBoundingClientRect();
      const cx0 = rr.left + rr.width / 2 - layerRect.left; // 현재 중심(px, 레이어 기준)
      const cy0 = rr.top + rr.height / 2 - layerRect.top;
      const offX = e.clientX - layerRect.left - cx0; // 커서와 중심의 차
      const offY = e.clientY - layerRect.top - cy0;
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4) {
          moved = true;
          selectedStickerId = s.id; markStickerSelection(); // 드래그 시작 즉시 툴바 고정(따라다니게)
        }
        if (locked || !moved) return; // 잠금은 이동 불가; 임계 넘기 전엔 대기(클릭 판정용)
        el.classList.add('dragging');
        // 중심을 레이어의 분수로 저장 → 창 크기 바뀌어도 상대 위치(가운데) 유지
        s.fx = Math.max(0, Math.min(1, (ev.clientX - layerRect.left - offX) / lw));
        s.fy = Math.max(0, Math.min(1, (ev.clientY - layerRect.top - offY) / lh));
        el.style.left = (s.fx * 100) + '%';
        el.style.top = (s.fy * 100) + '%';
        el.style.transform = 'translate(-50%, -50%) rotate(' + (Number(s.rot) || 0) + 'deg)';
        const r2 = el.getBoundingClientRect();
        tools.classList.toggle('below', (r2.top - layerRect.top) < 40); // 위/아래로 끌 때 툴바 위치 실시간 전환
      };
      const up = (ev) => {
        el.classList.remove('dragging');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        if (moved) { selectedStickerId = s.id; markStickerSelection(); scheduleSave(); return; } // 이동(드래그) 후 선택 유지
        // 클릭(안 움직임): 밑에 사이드바 탭/버튼이 있으면 그걸 우선 실행(탭 우선), 없으면 스티커 선택 토글
        const navEl = document.elementsFromPoint(ev.clientX, ev.clientY)
          .map((n) => (n.closest ? n.closest('[data-nav], #sidebar-collapse, .brand') : null))
          .find(Boolean);
        if (navEl) { selectedStickerId = null; markStickerSelection(); navEl.click(); } // 탭 우선
        else { selectedStickerId = (selectedStickerId === s.id ? null : s.id); markStickerSelection(); } // 스티커 선택 토글
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
  const payload = { events, todos, recurring, ledger, works, notes, habits, alarms, playlist, banner, bannerCfg, stickers, prefs, firedReminders };
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
  notes = arr('notes'); habits = arr('habits'); alarms = arr('alarms');
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
    prefs.windowOpacity = clampInt(prefs.windowOpacity, 15, 100, 100);
    if (prefs.backgroundMaterial === 'acrylic') prefs.backgroundMaterial = 'frost'; // 아크릴 제거 → 뿌연으로 전환
    prefs.backgroundMaterial = ['none', 'frost', 'mica'].includes(prefs.backgroundMaterial) ? prefs.backgroundMaterial : 'none';
    prefs.blurIntensity = clampInt(prefs.blurIntensity, 0, 100, 30);
    prefs.uiScale = clampInt(prefs.uiScale, 80, 150, 100);
    prefs.windowTransparent = (typeof prefs.windowTransparent === 'boolean') ? prefs.windowTransparent : false;
    prefs.notifyDeadlines = (typeof prefs.notifyDeadlines === 'boolean') ? prefs.notifyDeadlines : true;
    prefs.hideStickerTools = (typeof prefs.hideStickerTools === 'boolean') ? prefs.hideStickerTools : false;
    prefs.deadlineNotifyTime = /^([01]?\d|2[0-3]):[0-5]\d$/.test(prefs.deadlineNotifyTime) ? prefs.deadlineNotifyTime : '09:00';
    // 수동 정렬 플래그: 구형 deadlines/commissions → works 로 병합
    const m = (prefs.manual && typeof prefs.manual === 'object') ? prefs.manual : {};
    prefs.manual = { ledger: !!m.ledger, works: !!(m.works || m.deadlines || m.commissions) };
    applyColors(colors); applyTitle(prefs.appTitle);
    applyShell();
    document.body.classList.toggle('hide-sticker-tools', !!prefs.hideStickerTools);
    if (window.api.youtube && window.api.youtube.setVolume) window.api.youtube.setVolume(prefs.ytVolume);
  }
  scheduleSave();
  closeSettingsModal();
  render();
  toast('데이터를 가져왔어요.');
}

// ---- 이벤트 바인딩 ----
function bindUI() {
  // 종료·새로고침 직전, 예약된 저장이 남아 있으면 동기적으로 flush (마지막 변경 유실 방지)
  window.addEventListener('beforeunload', () => {
    if (saveDirty && window.api.saveSync) { try { window.api.saveSync(snapshot()); saveDirty = false; } catch (_) {} }
  });
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

  // 창 / 화면 설정 (투명 효과 토글 · 투명도 · 블러 · 배율)
  const wTr = $('#w-transparent');
  if (wTr) wTr.addEventListener('change', () => {
    prefs.windowTransparent = wTr.checked; // 즉시 전환(재시작 불필요)
    // 켤 때 투명도가 사실상 불투명이면 자동으로 낮춰 바로 비치게 (안 그러면 토글만으론 변화 없음)
    if (wTr.checked && prefs.windowOpacity >= 95) prefs.windowOpacity = 80;
    applyGlassCss(); syncShellControls(); scheduleSave();
  });
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
    const m = b.dataset.m;
    let nativeM = (m === 'mica' || m === 'frost') ? 'mica' : 'none'; // 뿌연도 진짜 흐림 위해 미카 사용
    let r = await window.api.win.setMaterial(nativeM);
    if ((!r || !r.ok) && m === 'frost') { nativeM = 'none'; r = await window.api.win.setMaterial('none'); } // 미카 미지원(Win10) → 뿌연은 CSS 질감만
    if (!r || !r.ok) {
      toast(r && r.reason === 'UNSUPPORTED' ? '블러는 Windows 11(22H2 이상)에서만 지원돼요.' : '블러를 적용할 수 없어요.');
      return;
    }
    prefs.backgroundMaterial = m;
    // 재질·뿌연 유리는 투명이 켜져 있어야 보임 → 자동 ON
    if (m !== 'none' && !prefs.windowTransparent) prefs.windowTransparent = true;
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
  // 마감 자동 알림 토글 + 알림 시각
  const dn = $('#pref-deadline-notify');
  if (dn) dn.addEventListener('change', () => { prefs.notifyDeadlines = dn.checked; scheduleSave(); });
  const dt = $('#pref-deadline-time');
  if (dt) dt.addEventListener('change', () => { if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(dt.value)) { prefs.deadlineNotifyTime = dt.value; scheduleSave(); } });
  // 스티커 버튼 툴바 숨기기 토글
  const hst = $('#pref-hide-sticker-tools');
  if (hst) hst.addEventListener('change', () => { prefs.hideStickerTools = hst.checked; document.body.classList.toggle('hide-sticker-tools', hst.checked); scheduleSave(); });

  // 미니 달력 이동
  $('#mini-prev').addEventListener('click', () => { miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() - 1, 1); renderMiniCal(); });
  $('#mini-next').addEventListener('click', () => { miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() + 1, 1); renderMiniCal(); });

  // 할일 (보고 있는 날짜에 추가)
  $('#todo-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#todo-input').value.trim(); if (!v) return;
    todos.unshift({ id: crypto.randomUUID(), title: v, done: false, date: selectedDay, createdAt: new Date().toISOString() });
    $('#todo-input').value = ''; scheduleSave(); renderTodos();
  });
  // 할일 '오늘' 버튼: 오늘로 복귀
  const todoToday = $('#todo-today');
  if (todoToday) todoToday.addEventListener('click', () => { selectedDay = ymd(new Date()); miniMonth = new Date(); weekStart = startOfWeek(new Date()); render(); });
  // 반복
  $('#recurring-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#recurring-input').value.trim(); if (!v) return;
    recurring.unshift({ id: crypto.randomUUID(), title: v, rule: $('#recurring-rule').value, lastDone: '' });
    $('#recurring-input').value = ''; scheduleSave(); renderRecurring();
  });

  const alarmForm = $('#alarm-form');
  if (alarmForm) alarmForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const when = $('#alarm-when').value; // 'YYYY-MM-DDTHH:MM'
    if (!when) { toast('알람 날짜·시간을 골라주세요.'); return; }
    const title = $('#alarm-input').value.trim();
    alarms.unshift({ id: crypto.randomUUID(), at: when, title });
    $('#alarm-input').value = ''; $('#alarm-when').value = '';
    scheduleSave(); renderAlarms(); checkReminders();
    toast('알람을 추가했어요.');
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
    const w = {
      id: crypto.randomUUID(), title, due,
      client: $('#d-client').value.trim(),
      contact: $('#d-contact').value.trim(),
      platform: $('#d-platform').value.trim(),
      type: $('#d-type').value.trim(),
      amount: Number($('#d-amount').value) || 0,
      status, done: status === '완료',
      notes: $('#d-notes').value.trim(), progress: 0,
    };
    works.push(w);
    disarmPastWorkReminders(w); // 과거 마감으로 만든 알림은 다시 안 울리게
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
    const manual = $('#yt-title-in').value.trim();
    const t = { id: crypto.randomUUID(), title: manual || url, url, videoId: p.videoId, listId: p.listId };
    playlist.push(t);
    $('#yt-url').value = ''; $('#yt-title-in').value = '';
    scheduleSave(); renderYouTube();
    playTrack(t.id);
    // 제목을 비웠으면 실제 영상 제목을 비동기로 채움 (재생은 기다리지 않음)
    if (!manual && window.api.youtube && window.api.youtube.fetchTitle) {
      window.api.youtube.fetchTitle(ytWatchUrl(t)).then((r) => {
        if (r && r.ok && r.title && playlist.some((x) => x.id === t.id)) { t.title = r.title; scheduleSave(); renderYouTube(); }
      }).catch(() => {});
    }
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
  enableEventDrag(); // 일정 블록 꾹 눌러 드래그로 시간/요일 이동
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
    // 사이드바 폭이 바뀌면 본문(스티커 레이어) 크기도 바뀜 → 전환 후 스티커 재배치/툴바 재판정
    setTimeout(renderStickers, 280);
  };
  $('#sidebar-collapse').addEventListener('click', toggleSidebar);
  document.querySelector('.brand').addEventListener('click', () => {
    if (sidebar.classList.contains('collapsed')) toggleSidebar();
  });

  // 스티커 바깥을 누르면 선택 해제(버튼 툴바 숨김). 스티커/버튼 위 클릭은 유지.
  document.addEventListener('pointerdown', (e) => {
    if (selectedStickerId && !e.target.closest('.sticker')) { selectedStickerId = null; markStickerSelection(); }
  });
  // 홈 빠른 액세스 카드: 카드 바깥을 누르면 선택(강조) 해제
  document.addEventListener('pointerdown', (e) => {
    if (homeSelectedIdx >= 0 && !e.target.closest('.home-card')) {
      homeSelectedIdx = -1;
      document.querySelectorAll('#home-grid .home-card.selected').forEach((n) => n.classList.remove('selected'));
    }
  });
  // 창 크기가 바뀌면 위치는 CSS(%)가 알아서 따라가고, 툴바 위/아래(잘림 방지) 방향만 다시 판정
  let stickerResizeTO = null;
  window.addEventListener('resize', () => {
    clearTimeout(stickerResizeTO);
    stickerResizeTO = setTimeout(() => {
      const layer = $('#sticker-layer'); if (!layer) return;
      const lr = layer.getBoundingClientRect();
      layer.querySelectorAll('.sticker').forEach((el) => {
        const tools = el.querySelector('.sticker-tools'); if (!tools) return;
        const r = el.getBoundingClientRect();
        tools.classList.toggle('below', (r.top - lr.top) < 40);
      });
    }, 150);
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
    migrateTodoDates(); // 옛 할일에 date 채움
    if (rolloverTodos()) scheduleSave(); // 앱이 꺼진 사이 자정을 넘겼으면 미완료 할일 오늘로 이동
    recurring = arr('recurring');
    ledger = arr('ledger');
    works = loadWorks(data); // 신형 works 또는 구형 deadlines+commissions 자동 병합
    notes = arr('notes');
    habits = arr('habits');
    alarms = arr('alarms');
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
  prefs.theme = 'light'; // 다크모드 제거 — 라이트 전용
  try { localStorage.removeItem('theme'); } catch (_) {} // 스테일 다크 값 정리
  try { prefs.colors = p.colors || JSON.parse(lsGet('colors', '{}')) || {}; } catch (_) { prefs.colors = p.colors || {}; }
  prefs.viewColors = (p.viewColors && typeof p.viewColors === 'object') ? p.viewColors : {};
  prefs.ytRepeat = (p.ytRepeat === 'all' || p.ytRepeat === 'one') ? p.ytRepeat : 'off';
  // 수동 정렬 플래그: 구형 deadlines/commissions 플래그를 works 하나로 병합
  const pm = (p.manual && typeof p.manual === 'object') ? p.manual : {};
  prefs.manual = { ledger: !!pm.ledger, works: !!(pm.works || pm.deadlines || pm.commissions) };
  prefs.appTitle = p.appTitle || lsGet('appTitle', '하다');
  prefs.sidebarCollapsed = (typeof p.sidebarCollapsed === 'boolean') ? p.sidebarCollapsed : (lsGet('sidebarCollapsed', '0') === '1');
  prefs.ytVolume = clampInt(p.ytVolume, 0, 100, 100);
  prefs.windowOpacity = clampInt(p.windowOpacity, 15, 100, 100);
  const _bm = (p.backgroundMaterial === 'acrylic') ? 'frost' : p.backgroundMaterial; // 아크릴 제거 → 뿌연
  prefs.backgroundMaterial = ['none', 'frost', 'mica'].includes(_bm) ? _bm : 'none';
  prefs.blurIntensity = clampInt(p.blurIntensity, 0, 100, 30);
  prefs.uiScale = clampInt(p.uiScale, 80, 150, 100);
  prefs.windowTransparent = (typeof p.windowTransparent === 'boolean') ? p.windowTransparent : false;
  prefs.notifyDeadlines = (typeof p.notifyDeadlines === 'boolean') ? p.notifyDeadlines : true;
  prefs.hideStickerTools = (typeof p.hideStickerTools === 'boolean') ? p.hideStickerTools : false;
  prefs.deadlineNotifyTime = /^([01]?\d|2[0-3]):[0-5]\d$/.test(p.deadlineNotifyTime) ? p.deadlineNotifyTime : '09:00';
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
  applyColors(colors);
  applyTitle(prefs.appTitle);
  applyGlassCss(); // 불투명/투명 표면 알파를 즉시 반영 (시작 시 깜빡임 방지)
  applyShell(); // 창 배율/재질을 네이티브 창과 동기화 (materialOk 확정 후 재적용)
  document.body.classList.toggle('hide-sticker-tools', !!prefs.hideStickerTools); // 스티커 버튼 툴바 표시 여부
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
  nowTimer = setInterval(() => { maybeRollDay(); renderNowLine(); }, 60 * 1000);
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
    hexToRgb, luminance, idealText,
    monthGrid, recurringDueOn, formatWon, monthKey, sumLedger, sumByCategory,
    daysUntil, ddayLabel, computeStreak, icon, parseYouTube, textToHtml, migrateWork, loadWorks,
    mix, stripHtml, ytWatchUrl, nextTrackId, resolveNextId, reorderByIds, VIEW_COLORS, VIEW_META, viewAccent,
    clampInt, eventRemindKey, eventRemindAt, deadlineRemindAt, dueReminders,
    DAY_START, DAY_END, HOUR_HEIGHT,
  };
}
