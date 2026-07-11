'use strict';

// ------- 상태 -------
/** @type {{id:string,title:string,done:boolean,dueDate:string|null,tags:string[],notes:string,createdAt:string,updatedAt:string}[]} */
let tasks = [];
let statusFilter = 'all'; // all | active | done
let tagFilter = null; // 선택된 태그 문자열 or null
let searchText = '';

// ------- DOM 참조 -------
const $ = (sel) => document.querySelector(sel);
const addForm = $('#add-form');
const titleInput = $('#title-input');
const dueInput = $('#due-input');
const tagsInput = $('#tags-input');
const searchInput = $('#search-input');
const taskList = $('#task-list');
const emptyState = $('#empty-state');
const statsEl = $('#stats');
const tagFiltersEl = $('#tag-filters');
const statusFiltersEl = $('#status-filters');
const themeToggle = $('#theme-toggle');
const template = $('#task-template');

// ------- 유틸 -------
function nowISO() {
  return new Date().toISOString();
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseTags(raw) {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// 저장 디바운스 (연속 변경을 모아 한 번에 저장)
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await window.api.save({ tasks });
    } catch (err) {
      console.error('저장 실패:', err);
    }
  }, 250);
}

// ------- CRUD -------
function addTask(title, dueDate, tags) {
  const t = {
    id: crypto.randomUUID(),
    title: title.trim(),
    done: false,
    dueDate: dueDate || null,
    tags: tags || [],
    notes: '',
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  tasks.unshift(t);
  scheduleSave();
  render();
}

function updateTask(id, patch) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch, { updatedAt: nowISO() });
  scheduleSave();
}

function deleteTask(id) {
  tasks = tasks.filter((x) => x.id !== id);
  scheduleSave();
  render();
}

// ------- 필터링 -------
function getVisibleTasks() {
  const q = searchText.trim().toLowerCase();
  return tasks.filter((t) => {
    if (statusFilter === 'active' && t.done) return false;
    if (statusFilter === 'done' && !t.done) return false;
    if (tagFilter && !t.tags.includes(tagFilter)) return false;
    if (q) {
      const hay = `${t.title} ${t.notes}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ------- 렌더 -------
function render() {
  renderTagFilters();
  renderStats();

  const visible = getVisibleTasks();
  taskList.innerHTML = '';

  if (tasks.length === 0) {
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent =
      '아직 할 일이 없어요. 위에 첫 할 일을 추가해 보세요! ✍️';
  } else if (visible.length === 0) {
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = '조건에 맞는 할 일이 없어요.';
  } else {
    emptyState.hidden = true;
  }

  for (const t of visible) {
    taskList.appendChild(renderTask(t));
  }
}

function renderTask(t) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.id = t.id;
  if (t.done) node.classList.add('done');

  const check = node.querySelector('.task-check');
  check.checked = t.done;
  check.addEventListener('change', () => {
    updateTask(t.id, { done: check.checked });
    render();
  });

  const titleEl = node.querySelector('.task-title');
  const titleEdit = node.querySelector('.task-title-edit');
  titleEl.textContent = t.title;

  // 마감일 표시
  const dueEl = node.querySelector('.task-due');
  if (t.dueDate) {
    dueEl.textContent = `📅 ${t.dueDate}`;
    const today = todayStr();
    if (!t.done && t.dueDate < today) dueEl.classList.add('overdue');
    else if (!t.done && t.dueDate === today) dueEl.classList.add('today');
  }

  // 태그 표시
  const tagsEl = node.querySelector('.task-tags');
  for (const tag of t.tags) {
    const span = document.createElement('span');
    span.className = 'tag';
    span.textContent = `#${tag}`;
    tagsEl.appendChild(span);
  }

  // 메모 토글
  const noteBtn = node.querySelector('.note-btn');
  const notesWrap = node.querySelector('.task-notes');
  const notesArea = node.querySelector('.notes-area');
  notesArea.value = t.notes;
  if (t.notes) noteBtn.classList.add('has-note');
  noteBtn.addEventListener('click', () => {
    notesWrap.hidden = !notesWrap.hidden;
    if (!notesWrap.hidden) notesArea.focus();
  });
  notesArea.addEventListener('input', () => {
    updateTask(t.id, { notes: notesArea.value });
  });

  // 수정(인라인)
  const editBtn = node.querySelector('.edit-btn');
  editBtn.addEventListener('click', () => {
    const editing = !titleEdit.hidden;
    if (editing) {
      commitEdit();
    } else {
      titleEdit.value = t.title;
      titleEl.hidden = true;
      titleEdit.hidden = false;
      titleEdit.focus();
      titleEdit.select();
    }
  });
  function commitEdit() {
    const v = titleEdit.value.trim();
    if (v) {
      updateTask(t.id, { title: v });
      titleEl.textContent = v;
    }
    titleEdit.hidden = true;
    titleEl.hidden = false;
  }
  titleEdit.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitEdit();
    else if (e.key === 'Escape') {
      titleEdit.hidden = true;
      titleEl.hidden = false;
    }
  });
  titleEdit.addEventListener('blur', commitEdit);

  // 삭제
  node.querySelector('.del-btn').addEventListener('click', () => {
    deleteTask(t.id);
  });

  return node;
}

function renderStats() {
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  const active = total - done;
  statsEl.textContent = total
    ? `전체 ${total} · 진행중 ${active} · 완료 ${done}`
    : '';
}

function renderTagFilters() {
  const allTags = [...new Set(tasks.flatMap((t) => t.tags))].sort();
  tagFiltersEl.innerHTML = '';
  // 존재하지 않는 태그가 선택돼 있으면 해제
  if (tagFilter && !allTags.includes(tagFilter)) tagFilter = null;
  for (const tag of allTags) {
    const chip = document.createElement('button');
    chip.className = 'tag-chip' + (tagFilter === tag ? ' active' : '');
    chip.textContent = `#${tag}`;
    chip.addEventListener('click', () => {
      tagFilter = tagFilter === tag ? null : tag;
      render();
    });
    tagFiltersEl.appendChild(chip);
  }
}

// ------- 마감일 알림 -------
function checkDueNotifications() {
  const today = todayStr();
  const due = tasks.filter((t) => !t.done && t.dueDate && t.dueDate <= today);
  if (due.length === 0) return;
  const overdue = due.filter((t) => t.dueDate < today).length;
  const dueToday = due.length - overdue;
  const parts = [];
  if (dueToday) parts.push(`오늘 마감 ${dueToday}건`);
  if (overdue) parts.push(`지난 마감 ${overdue}건`);
  window.api.notify('할 일 알림 ⏰', parts.join(', ') + '이 있어요.');
}

// ------- 이벤트 바인딩 -------
addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;
  addTask(title, dueInput.value || null, parseTags(tagsInput.value));
  titleInput.value = '';
  dueInput.value = '';
  tagsInput.value = '';
  titleInput.focus();
});

statusFiltersEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  statusFilter = btn.dataset.filter;
  statusFiltersEl.querySelectorAll('.chip').forEach((c) =>
    c.classList.toggle('active', c === btn)
  );
  render();
});

searchInput.addEventListener('input', () => {
  searchText = searchInput.value;
  render();
});

// ------- 테마 -------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  try {
    localStorage.setItem('theme', theme);
  } catch (_) {
    /* 무시 */
  }
}
themeToggle.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
});

// ------- 초기화 -------
async function init() {
  // 테마 복원 (기본: 다크)
  let saved = 'dark';
  try {
    saved = localStorage.getItem('theme') || 'dark';
  } catch (_) {
    /* 무시 */
  }
  applyTheme(saved);

  try {
    const data = await window.api.load();
    tasks = Array.isArray(data && data.tasks) ? data.tasks : [];
  } catch (err) {
    console.error('불러오기 실패:', err);
    tasks = [];
  }

  render();
  checkDueNotifications();
  // 1시간마다 마감일 재확인
  setInterval(checkDueNotifications, 60 * 60 * 1000);
}

init();
