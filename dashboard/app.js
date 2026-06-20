// 업무 대시보드 — 단일 사용자, localStorage 저장. 백엔드 없음.
const KEY = "dashboard_state";
const COLUMNS = [
  { id: "todo",  name: "할 일" },
  { id: "doing", name: "진행 중" },
  { id: "done",  name: "완료" },
];
// 이모지 대신 인라인 SVG (테마/색 제어, 플랫폼 일관성)
const CAL_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>';

// ----- 상태 -----
function load() {
  const raw = localStorage.getItem(KEY);
  if (raw) return JSON.parse(raw);
  // 첫 실행 시드
  const pid = uid();
  return {
    activeProject: pid,
    projects: [{ id: pid, name: "내 프로젝트" }],
    cards: [
      { id: uid(), projectId: pid, title: "여기로 카드를 드래그해 보세요", desc: "", status: "todo",  priority: "med",  due: "", labels: ["예시"] },
      { id: uid(), projectId: pid, title: "카드를 클릭하면 편집 모달이 열려요", desc: "", status: "doing", priority: "high", due: "", labels: [] },
      { id: uid(), projectId: pid, title: "완료된 일", desc: "", status: "done", priority: "low", due: "", labels: [] },
    ],
  };
}

let state = load();
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
function uid() { return crypto.randomUUID(); }

// ----- 필터 (순수함수) -----
function matchesFilters(card, q, prio, label) {
  if (prio && card.priority !== prio) return false;
  if (label && !card.labels.includes(label)) return false;
  if (q) {
    const hay = (card.title + " " + card.desc).toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  return true;
}

// ----- DOM 참조 -----
const $ = (id) => document.getElementById(id);
const board = $("board");
const projectSelect = $("projectSelect");
const labelFilter = $("labelFilter");
const searchInput = $("search");
const priorityFilterEl = $("priorityFilter");

// ----- 렌더 -----
function render() {
  const q = searchInput.value.trim();
  const prio = priorityFilterEl.value;
  const label = labelFilter.value;

  // 프로젝트 드롭다운
  projectSelect.innerHTML = state.projects
    .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
    .join("");
  projectSelect.value = state.activeProject;

  const projectCards = state.cards.filter((c) => c.projectId === state.activeProject);

  // 라벨 필터 옵션 (현재 프로젝트의 라벨 집합)
  const labels = [...new Set(projectCards.flatMap((c) => c.labels))].sort();
  labelFilter.innerHTML =
    `<option value="">라벨 전체</option>` +
    labels.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
  labelFilter.value = labels.includes(label) ? label : "";

  // 컬럼 + 카드
  const visible = projectCards.filter((c) => matchesFilters(c, q, prio, labelFilter.value));
  board.innerHTML = COLUMNS.map((col) => {
    const colCards = visible.filter((c) => c.status === col.id);
    return `
      <div class="column" data-status="${col.id}">
        <h2>${col.name} <span class="count">${colCards.length}</span></h2>
        <div class="cards">${colCards.map(cardHTML).join("")}</div>
        <button class="add-card" data-status="${col.id}">+ 카드 추가</button>
      </div>`;
  }).join("");
}

function cardHTML(c) {
  const labels = c.labels.map((l) => `<span class="label-chip">${esc(l)}</span>`).join("");
  const due = c.due
    ? `<span class="due${isOverdue(c) ? " overdue" : ""}">${CAL_SVG} ${c.due}</span>`
    : "";
  return `
    <div class="card prio-${c.priority}" draggable="true" data-id="${c.id}">
      <div class="title">${esc(c.title)}</div>
      <div class="meta">${due}${labels}</div>
    </div>`;
}

function isOverdue(c) {
  return c.due && c.status !== "done" && c.due < today();
}
function today() { return new Date().toISOString().slice(0, 10); }

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

// ----- 드래그앤드롭 (네이티브) -----
let draggingId = null;
board.addEventListener("dragstart", (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  draggingId = card.dataset.id;
  card.classList.add("dragging");
});
board.addEventListener("dragend", (e) => {
  e.target.closest(".card")?.classList.remove("dragging");
  draggingId = null;
});
board.addEventListener("dragover", (e) => {
  const col = e.target.closest(".column");
  if (!col) return;
  e.preventDefault();
  col.classList.add("dragover");
});
board.addEventListener("dragleave", (e) => {
  e.target.closest(".column")?.classList.remove("dragover");
});
board.addEventListener("drop", (e) => {
  const col = e.target.closest(".column");
  if (!col || !draggingId) return;
  e.preventDefault();
  col.classList.remove("dragover");
  const card = state.cards.find((c) => c.id === draggingId);
  if (card) { card.status = col.dataset.status; save(); render(); }
});

// ----- 클릭: 카드 편집 / 카드 추가 -----
board.addEventListener("click", (e) => {
  const addBtn = e.target.closest(".add-card");
  if (addBtn) return openModal(null, addBtn.dataset.status);
  const card = e.target.closest(".card");
  if (card) openModal(card.dataset.id);
});

// ----- 모달 -----
const modal = $("modal");
let editingId = null;   // null이면 신규 카드
let newStatus = "todo";

function openModal(id, status) {
  editingId = id;
  const c = id ? state.cards.find((x) => x.id === id) : null;
  newStatus = c ? c.status : (status || "todo");
  $("m-title").value = c ? c.title : "";
  $("m-desc").value = c ? c.desc : "";
  $("m-priority").value = c ? c.priority : "med";
  $("m-due").value = c ? c.due : "";
  $("m-labels").value = c ? c.labels.join(", ") : "";
  $("m-delete").style.display = id ? "" : "none";
  modal.classList.remove("hidden");
  $("m-title").focus();
}
function closeModal() { modal.classList.add("hidden"); editingId = null; }

$("m-save").addEventListener("click", () => {
  const title = $("m-title").value.trim();
  if (!title) return $("m-title").focus();
  const labels = $("m-labels").value.split(",").map((s) => s.trim()).filter(Boolean);
  const data = {
    title,
    desc: $("m-desc").value.trim(),
    priority: $("m-priority").value,
    due: $("m-due").value,
    labels,
  };
  if (editingId) {
    Object.assign(state.cards.find((c) => c.id === editingId), data);
  } else {
    state.cards.push({ id: uid(), projectId: state.activeProject, status: newStatus, ...data });
  }
  save(); render(); closeModal();
});
$("m-delete").addEventListener("click", () => {
  if (!confirm("이 카드를 삭제할까요?")) return;
  state.cards = state.cards.filter((c) => c.id !== editingId);
  save(); render(); closeModal();
});
$("m-cancel").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
// Enter로 저장 (제목 칸은 Enter, 본문은 줄바꿈 보존 위해 Cmd/Ctrl+Enter)
modal.addEventListener("keydown", (e) => {
  if (e.isComposing) return;   // 한글 IME 조합 중 Enter 중복 방지
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.target.id === "m-title")) {
    e.preventDefault();
    $("m-save").click();
  }
});

// ----- 헤더 컨트롤 -----
projectSelect.addEventListener("change", () => {
  state.activeProject = projectSelect.value;
  save(); render();
});
$("newProjectBtn").addEventListener("click", () => {
  const name = prompt("새 프로젝트 이름")?.trim();
  if (!name) return;
  const id = uid();
  state.projects.push({ id, name });
  state.activeProject = id;
  save(); render();
});
searchInput.addEventListener("input", render);
priorityFilterEl.addEventListener("change", render);
labelFilter.addEventListener("change", render);

render();

// ponytail: 핵심 필터 로직 자체 점검 (콘솔에서만, UI 영향 없음)
console.assert(matchesFilters({ title: "버그 수정", desc: "", priority: "high", labels: ["긴급"] }, "버그", "high", "긴급"), "filter: 모두 일치해야 통과");
console.assert(!matchesFilters({ title: "문서", desc: "", priority: "low", labels: [] }, "", "high", ""), "filter: 우선순위 불일치는 제외");
