// portcath-studio.js — Port Cath Scheduling Studio

// ── State (global, loaded/saved by app.js) ───────────────────────────────────
let portCathSessionConfig = [];
let portCathActionHistory = [];

let pcStudioYear  = new Date().getFullYear();
let pcStudioMonth = new Date().getMonth();
let _pcsAutoNavDone = false; // auto-navigate to most recent month with data, once

// ── Month / day names ─────────────────────────────────────────────────────────
const PCS_MONTHS_AR = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

// ── Date helpers ──────────────────────────────────────────────────────────────
function pcsDateStr(year, month1, day) {
  return `${year}-${String(month1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function pcsDayName(dateStr) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return days[new Date(dateStr + 'T00:00:00').getDay()];
}

function pcsFormatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${pcsDayName(dateStr)}, ${PCS_MONTHS_AR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function pcsPatientsOnDate(dateStr) {
  return portCathList.filter(p => p.date === dateStr);
}

function pcsCountStatus(patients, status) {
  return patients.filter(p => (p.status || 'confirmed') === status).length;
}

// Returns sorted array of "YYYY-MM" strings that have any patients or session config
function pcsGetAllDataMonths() {
  const months = new Set();
  portCathList.forEach(p => {
    if (p.date && p.date.length >= 7) months.add(p.date.substring(0, 7));
  });
  portCathSessionConfig.forEach(c => {
    if (c.date && c.date.length >= 7) months.add(c.date.substring(0, 7));
  });
  return [...months].sort();
}

function pcsMonthStats() {
  const m1 = pcStudioMonth + 1;
  const prefix = `${pcStudioYear}-${String(m1).padStart(2,'0')}-`;
  const configActiveDates = new Set(
    portCathSessionConfig.filter(c => c.date.startsWith(prefix) && c.isActive).map(c => c.date)
  );
  // Count orphan dates (have patients, no config entry) as active days too
  portCathList
    .filter(p => p.date && p.date.startsWith(prefix) && !portCathSessionConfig.find(c => c.date === p.date))
    .forEach(p => configActiveDates.add(p.date));
  const activeDays = configActiveDates.size;
  const totalPatients = portCathList.filter(p => p.date && p.date.startsWith(prefix)).length;
  return { activeDays, totalPatients };
}

// ── Calendar Dashboard ────────────────────────────────────────────────────────
function pcsRenderCalendarDashboard() {
  const year  = pcStudioYear;
  const month = pcStudioMonth; // 0-based
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const firstDay  = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Build lookup maps
  const prefix = `${year}-${String(month+1).padStart(2,'0')}-`;
  const sessionDates = new Set(portCathSessionConfig.filter(c => c.date.startsWith(prefix) && c.isActive).map(c => c.date));
  const patientMap = {};
  portCathList.forEach(p => {
    if (p.date && p.date.startsWith(prefix) && !['cancelled','noshow','apologized'].includes(p.status || '')) {
      patientMap[p.date] = (patientMap[p.date] || 0) + 1;
    }
  });

  // Stats
  const totalSessions = sessionDates.size || Object.keys(patientMap).length;
  const totalPats = Object.values(patientMap).reduce((a,b) => a+b, 0);
  const confirmedPats = portCathList.filter(p => p.date && p.date.startsWith(prefix) && !['cancelled','noshow','apologized'].includes(p.status)).length;

  // Day headers (Sun → Sat)
  const dayHeaders = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    .map(d => `<div class="pcs-cal-dh">${d}</div>`).join('');

  // Build cells
  let cells = '';
  let cellIdx = 0;

  // Leading empty cells
  for (let i = 0; i < firstDay; i++) {
    cells += `<div class="pcs-cal-cell pcs-cal-empty" style="--ci:${cellIdx++}"></div>`;
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const count   = patientMap[dateStr] || 0;
    const isSess  = sessionDates.has(dateStr);
    const isToday = dateStr === todayStr;
    const isPast  = dateStr < todayStr;
    const dow     = (firstDay + d - 1) % 7;
    const isWeekend = dow === 0 || dow === 6;
    const hasData = count > 0;

    let cls = 'pcs-cal-cell';
    if (isToday)   cls += ' pcs-cal-today';
    if (isSess)    cls += ' pcs-cal-session';
    if (hasData)   cls += ' pcs-cal-has-patients';
    if (isPast)    cls += ' pcs-cal-past';
    if (isWeekend) cls += ' pcs-cal-weekend';

    const badge = hasData
      ? `<span class="pcs-cal-badge" style="--bi:${cellIdx}">${count}</span>`
      : '';

    const sessionDot = isSess && !hasData
      ? `<span class="pcs-cal-dot"></span>`
      : '';

    const clickable = hasData || isSess
      ? `onclick="pcsOpenDayModal('${dateStr}')" role="button" tabindex="0" aria-label="${d} ${PCS_MONTHS_AR[month]}, ${count} patients"`
      : '';

    cells += `
      <div class="${cls}" style="--ci:${cellIdx++}" ${clickable}>
        <span class="pcs-cal-day-num">${d}</span>
        ${badge}${sessionDot}
      </div>`;
  }

  // Trailing empty cells to complete last row
  const total = firstDay + daysInMonth;
  const trailing = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 0; i < trailing; i++) {
    cells += `<div class="pcs-cal-cell pcs-cal-empty" style="--ci:${cellIdx++}"></div>`;
  }

  return `
    <div class="pcs-dashboard">
      <div class="pcs-dash-stats">
        <div class="pcs-dash-stat" style="--si:0">
          <span class="pcs-dash-stat-num">${totalSessions}</span>
          <span class="pcs-dash-stat-label">Session Days</span>
        </div>
        <div class="pcs-dash-stat" style="--si:1">
          <span class="pcs-dash-stat-num">${totalPats}</span>
          <span class="pcs-dash-stat-label">Total Patients</span>
        </div>
        <div class="pcs-dash-stat" style="--si:2">
          <span class="pcs-dash-stat-num">${confirmedPats}</span>
          <span class="pcs-dash-stat-label">Confirmed</span>
        </div>
        <div class="pcs-dash-stat" style="--si:3">
          <span class="pcs-dash-stat-num">${totalPats - confirmedPats}</span>
          <span class="pcs-dash-stat-label">Cancelled / Absent</span>
        </div>
      </div>

      <div class="pcs-cal-grid-wrap">
        <div class="pcs-cal-day-headers">${dayHeaders}</div>
        <div class="pcs-cal-grid">${cells}</div>
      </div>

      <div class="pcs-cal-legend">
        <span class="pcs-leg-item"><span class="pcs-leg-dot pcs-leg-session"></span>Session day</span>
        <span class="pcs-leg-item"><span class="pcs-leg-dot pcs-leg-patients"></span>Has patients</span>
        <span class="pcs-leg-item"><span class="pcs-leg-dot pcs-leg-today"></span>Today</span>
      </div>
    </div>`;
}

function pcsCalJumpToDay(dateStr) {
  // Open the card and scroll to it
  const card = document.getElementById(`pcs-card-${dateStr}`);
  if (!card) return;
  if (!card.classList.contains('open')) {
    card.classList.add('open');
    const list = card.querySelector('.pcs-patient-list');
    if (list) list.style.display = 'block';
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('pcs-card-flash');
  setTimeout(() => card.classList.remove('pcs-card-flash'), 900);
}

// ── Day Modal ─────────────────────────────────────────────────────────────────

function _pcsDayModalBodyHTML(dateStr) {
  const patients  = portCathList.filter(p => p.date === dateStr);
  const confirmed = patients.filter(p => !['cancelled','noshow','apologized'].includes(p.status || ''));
  const inactive  = patients.filter(p => ['cancelled','noshow','apologized'].includes(p.status || ''));

  const chips = [
    confirmed.length  > 0 ? `<span class="pcs-chip pcs-chip-green">${confirmed.length} Confirmed</span>` : '',
    patients.filter(p => (p.status||'') === 'cancelled').length  > 0 ? `<span class="pcs-chip pcs-chip-red">${patients.filter(p=>(p.status||'')==='cancelled').length} Cancelled</span>` : '',
    patients.filter(p => (p.status||'') === 'noshow').length     > 0 ? `<span class="pcs-chip pcs-chip-yellow">${patients.filter(p=>(p.status||'')==='noshow').length} No-Show</span>` : '',
    patients.filter(p => (p.status||'') === 'apologized').length > 0 ? `<span class="pcs-chip pcs-chip-grey">${patients.filter(p=>(p.status||'')==='apologized').length} Apologized</span>` : '',
  ].filter(Boolean).join('');

  const historyItems = portCathActionHistory
    .filter(h => h.fromDate === dateStr || h.toDate === dateStr)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 8);

  const patientRows = patients.length === 0
    ? `<div class="pcs-modal-empty">No patients scheduled for this day.</div>`
    : patients.map((p,i) => `<div class="pcs-modal-prow" style="animation-delay:calc(60ms + ${i} * 40ms)">${pcsRenderPatientRowModal(p)}</div>`).join('');

  const historyRows = historyItems.length === 0
    ? `<div class="pcs-modal-hist-empty">No history recorded.</div>`
    : historyItems.map(h => pcsRenderHistoryItem(h)).join('');

  return `
    <div class="pcs-modal-chips">${chips || '<span class="pcs-chip pcs-chip-grey">No patients</span>'}</div>
    <div class="pcs-modal-patient-list" id="pcs-modal-plist-${dateStr}">
      ${patientRows}
    </div>
    <details class="pcs-modal-history-wrap">
      <summary class="pcs-modal-history-toggle">History (${historyItems.length} event${historyItems.length===1?'':'s'})</summary>
      <div class="pcs-modal-history-body">${historyRows}</div>
    </details>`;
}

function pcsOpenDayModal(dateStr) {
  pcsCloseDayModal(true);

  const patients = portCathList.filter(p => p.date === dateStr);
  const activeCount = patients.filter(p => !['cancelled','noshow','apologized'].includes(p.status||'')).length;
  const label = pcsFormatDate(dateStr);

  const overlay = document.createElement('div');
  overlay.id = 'pcs-day-modal-overlay';
  overlay.className = 'pcs-modal-overlay';
  overlay._dateStr = dateStr;
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', `Session — ${label}`);

  overlay.innerHTML = `
    <div class="pcs-modal-panel" id="pcs-day-modal-panel">
      <div class="pcs-modal-header">
        <div class="pcs-modal-header-left">
          <span class="pcs-modal-eyebrow">Session Day</span>
          <h2 class="pcs-modal-title">${label}</h2>
        </div>
        <div class="pcs-modal-header-right">
          <span class="pcs-modal-count-badge" id="pcs-modal-count-badge">${activeCount} patient${activeCount!==1?'s':''}</span>
          <button class="pcs-modal-add-btn" onclick="pcsOpenAddPatientForDay('${dateStr}')" aria-label="Add patient" title="Add patient on this day">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <button class="pcs-modal-close" onclick="pcsCloseDayModal()" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="pcs-modal-body" id="pcs-modal-body">
        ${_pcsDayModalBodyHTML(dateStr)}
      </div>
      <div class="pcs-modal-footer">
        <button class="pcs-modal-action-btn pcs-modal-btn-print" onclick="pcsPrint('${dateStr}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
          Print
        </button>
        <button class="pcs-modal-action-btn pcs-modal-btn-word" onclick="pcsExportWord('${dateStr}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          Export Word
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay._escHandler = (e) => { if (e.key === 'Escape') pcsCloseDayModal(); };
  document.addEventListener('keydown', overlay._escHandler);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) pcsCloseDayModal(); });

  requestAnimationFrame(() => overlay.classList.add('pcs-modal-open'));
}

function pcsOpenAddPatientForDay(dateStr) {
  openAddModal('portcath');
  const dateInput = document.getElementById('pc-date');
  if (dateInput) dateInput.value = dateStr;
}

// Called after any action that mutates portCathList — refreshes open modal in-place
function pcsRefreshDayModal() {
  const overlay = document.getElementById('pcs-day-modal-overlay');
  if (!overlay || !overlay._dateStr) return;
  const dateStr = overlay._dateStr;

  const body = document.getElementById('pcs-modal-body');
  if (body) {
    body.innerHTML = _pcsDayModalBodyHTML(dateStr);
  }

  // Update patient count badge
  const badge = document.getElementById('pcs-modal-count-badge');
  if (badge) {
    const ac = portCathList.filter(p => p.date === dateStr && !['cancelled','noshow','apologized'].includes(p.status||'')).length;
    badge.textContent = `${ac} patient${ac !== 1 ? 's' : ''}`;
  }
}

function pcsCloseDayModal(immediate) {
  const overlay = document.getElementById('pcs-day-modal-overlay');
  if (!overlay) return;
  if (overlay._escHandler) document.removeEventListener('keydown', overlay._escHandler);
  // Clear any fixed-positioned more menus before removing
  document.querySelectorAll('.pcs-more-menu.active').forEach(m => {
    m.classList.remove('active');
    m.style.cssText = '';
  });
  if (immediate) { overlay.remove(); return; }
  overlay.classList.remove('pcs-modal-open');
  overlay.classList.add('pcs-modal-closing');
  setTimeout(() => overlay.remove(), 320);
}

// ── Entry point ───────────────────────────────────────────────────────────────
function renderPortCathStudio() {
  const section = document.getElementById('tab-portcath');
  if (!section) return;

  // On first open, jump to the most recent month that has data if current month is empty
  if (!_pcsAutoNavDone) {
    _pcsAutoNavDone = true;
    const curPrefix = `${pcStudioYear}-${String(pcStudioMonth + 1).padStart(2,'0')}-`;
    const curHasData =
      portCathList.some(p => p.date && p.date.startsWith(curPrefix)) ||
      portCathSessionConfig.some(c => c.date.startsWith(curPrefix));
    if (!curHasData) {
      const allMonths = pcsGetAllDataMonths();
      if (allMonths.length > 0) {
        const latest = allMonths[allMonths.length - 1];
        pcStudioYear  = parseInt(latest.substring(0, 4));
        pcStudioMonth = parseInt(latest.substring(5, 7)) - 1;
      }
    }
  }

  const { activeDays, totalPatients } = pcsMonthStats();

  section.innerHTML = `
    <div class="pcs-root" id="pcs-root">
      <div class="pcs-blob pcs-blob-1"></div>
      <div class="pcs-blob pcs-blob-2"></div>
      <div class="pcs-inner">

        <div class="pcs-header">
          <div class="pcs-header-left">
            <div class="pcs-eyebrow">Port Cath Studio</div>
            <h1>Port Cath Schedule</h1>
            <div class="pcs-subtitle">
              ${PCS_MONTHS_AR[pcStudioMonth]} ${pcStudioYear} —
              ${activeDays} ${activeDays === 1 ? 'session day' : 'session days'} ·
              ${totalPatients} patients
            </div>
          </div>
          <div class="pcs-header-actions">
            <button class="pcs-btn" onclick="pcsOpenConfig()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M12 2v2M12 20v2M2 12h2M20 12h2M19.07 19.07l-1.41-1.41M4.93 19.07l1.41-1.41"/></svg>
              Configure Days
            </button>
            <button class="pcs-btn pcs-btn-primary" onclick="openAddModal('portcath')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Patient
            </button>
            <button class="pcs-btn pcs-btn-waiting" onclick="pcsOpenWaitingAddModal()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
              Waiting List
            </button>
            <button class="pcs-btn" onclick="pcsPrint()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Print
            </button>
            <button class="pcs-btn" onclick="pcsExportWord()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              Export Word
            </button>
          </div>
        </div>

        <div class="pcs-search-wrap">
          <svg class="pcs-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="pcs-search-input" class="pcs-search-input"
                 placeholder="Search patient by name, file #, or phone — anywhere in Port Cath..."
                 autocomplete="off"
                 oninput="pcsRenderSearchResults()"
                 onkeydown="pcsHandleSearchKey(event)"
                 onfocus="pcsRenderSearchResults()">
          <div class="pcs-search-results" id="pcs-search-results"></div>
        </div>

        <div class="pcs-section-divider pcs-section-divider-waiting">
          <span class="pcs-section-label">Waiting List</span>
        </div>
        <div id="pcs-waiting-container">
          ${pcsRenderWaitingList()}
        </div>

        <div class="pcs-month-nav">
          <button class="pcs-nav-btn" onclick="pcsNavigateMonth(-1)">&#8250;</button>
          <span class="pcs-month-label">${PCS_MONTHS_AR[pcStudioMonth]} ${pcStudioYear}</span>
          <button class="pcs-nav-btn" onclick="pcsNavigateMonth(1)">&#8249;</button>
        </div>

        ${pcsRenderCalendarDashboard()}

        <div class="pcs-section-divider">
          <span class="pcs-section-label">Session Days</span>
        </div>

        <div id="pcs-cards-container">
          ${pcsRenderDayCards()}
        </div>

      </div>
    </div>
  `;

  // Close more menus when clicking outside
  document.removeEventListener('click', pcsCloseAllMoreMenus);
  document.addEventListener('click', pcsCloseAllMoreMenus);

  // Close patient search results when clicking outside the search box
  document.removeEventListener('click', pcsCloseSearchOnOutsideClick);
  document.addEventListener('click', pcsCloseSearchOnOutsideClick);

  // Keep the day modal in sync if it's open
  pcsRefreshDayModal();
}

// ── Patient Search ────────────────────────────────────────────────────────────
function pcsSearchPatients(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  return portCathList.filter(p =>
    (p.name && String(p.name).toLowerCase().includes(q)) ||
    (p.fileNumber && String(p.fileNumber).toLowerCase().includes(q)) ||
    (p.phone && String(p.phone).toLowerCase().includes(q))
  ).slice(0, 10);
}

function pcsRenderSearchResults() {
  const input     = document.getElementById('pcs-search-input');
  const resultsEl = document.getElementById('pcs-search-results');
  if (!input || !resultsEl) return;

  const query = input.value.trim();
  if (query.length === 0) {
    resultsEl.classList.remove('active');
    resultsEl.innerHTML = '';
    return;
  }

  const matches = pcsSearchPatients(query);
  resultsEl.classList.add('active');

  if (matches.length === 0) {
    resultsEl.innerHTML = `<div class="pcs-search-empty">No patient found for "${query}"</div>`;
    return;
  }

  resultsEl.innerHTML = matches.map(p => {
    const locationLabel = p.status === 'waiting' || !p.date
      ? 'Waiting List'
      : pcsFormatDate(p.date);
    return `
      <button type="button" class="pcs-search-result" onclick="pcsGoToSearchResult('${p.id}')">
        <span class="pcs-search-result-main">
          <strong>${p.name}</strong>
          <small>File # ${p.fileNumber}${p.phone ? ` · ${p.phone}` : ''}</small>
        </span>
        <span class="pcs-search-result-loc ${p.status === 'waiting' || !p.date ? 'pcs-search-loc-waiting' : ''}">${locationLabel}</span>
      </button>`;
  }).join('');
}

function pcsCloseSearchResults() {
  const resultsEl = document.getElementById('pcs-search-results');
  if (resultsEl) { resultsEl.classList.remove('active'); resultsEl.innerHTML = ''; }
}

function pcsCloseSearchOnOutsideClick(e) {
  const wrap = document.querySelector('.pcs-search-wrap');
  if (wrap && !wrap.contains(e.target)) pcsCloseSearchResults();
}

function pcsHandleSearchKey(event) {
  if (event.key === 'Escape') {
    event.currentTarget.value = '';
    pcsCloseSearchResults();
  }
  if (event.key === 'Enter') {
    const first = pcsSearchPatients(event.currentTarget.value)[0];
    if (first) pcsGoToSearchResult(first.id);
  }
}

function pcsGoToSearchResult(patientId) {
  const patient = portCathList.find(p => p.id === patientId);
  if (!patient) return;

  pcsCloseSearchResults();
  const input = document.getElementById('pcs-search-input');
  if (input) { input.value = ''; input.blur(); }

  if (patient.status === 'waiting' || !patient.date) {
    renderPortCathStudio();
    window.setTimeout(() => {
      const row = document.querySelector(`#pcs-waiting-container [data-patient-id="${patient.id}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('pcs-search-flash');
        setTimeout(() => row.classList.remove('pcs-search-flash'), 1800);
      }
    }, 80);
    return;
  }

  const [y, m] = patient.date.split('-').map(Number);
  pcStudioYear  = y;
  pcStudioMonth = m - 1;
  renderPortCathStudio();

  window.setTimeout(() => {
    pcsOpenDayModal(patient.date);
    window.setTimeout(() => {
      const row = document.querySelector(`#pcs-modal-body [data-patient-id="${patient.id}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('pcs-search-flash');
        setTimeout(() => row.classList.remove('pcs-search-flash'), 1800);
      }
    }, 120);
  }, 80);
}

// ── Month navigation ──────────────────────────────────────────────────────────
function pcsNavigateMonth(delta) {
  pcStudioMonth += delta;
  if (pcStudioMonth < 0)  { pcStudioMonth = 11; pcStudioYear--; }
  if (pcStudioMonth > 11) { pcStudioMonth = 0;  pcStudioYear++; }
  renderPortCathStudio();
}

// ── Day cards ─────────────────────────────────────────────────────────────────
function pcsRenderDayCards() {
  const m1 = pcStudioMonth + 1;
  const prefix = `${pcStudioYear}-${String(m1).padStart(2,'0')}-`;

  const configDays = portCathSessionConfig.filter(c => c.date.startsWith(prefix));
  const configDateSet = new Set(configDays.map(c => c.date));

  // Include any patient dates that have no session config entry (legacy/imported data)
  const orphanDates = [
    ...new Set(
      portCathList
        .filter(p => p.date && p.date.startsWith(prefix) && !configDateSet.has(p.date))
        .map(p => p.date)
    )
  ].map(date => ({ date, isActive: true, _orphan: true }));

  const allDays = [...configDays, ...orphanDates]
    .sort((a, b) => a.date.localeCompare(b.date));

  if (allDays.length === 0) {
    const otherMonths = pcsGetAllDataMonths().filter(ym => {
      const [y, m] = ym.split('-').map(Number);
      return !(y === pcStudioYear && m === pcStudioMonth + 1);
    });
    const monthLinks = otherMonths.length
      ? `<div style="margin-top:20px;">
          <p style="font-size:0.8rem;font-weight:600;color:var(--text-muted);margin-bottom:10px;">Months with existing data:</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${otherMonths.map(ym => {
              const [y, m] = ym.split('-').map(Number);
              const label = `${PCS_MONTHS_AR[m - 1]} ${y}`;
              return `<button class="pcs-btn" onclick="pcStudioYear=${y};pcStudioMonth=${m-1};renderPortCathStudio()">${label}</button>`;
            }).join('')}
          </div>
        </div>`
      : '';
    return `
      <div class="pcs-empty">
        <h3>No session days this month</h3>
        <p>Click "Configure Days" to set Port Cath session days for this month.</p>
        <button class="pcs-btn pcs-btn-primary" onclick="pcsOpenConfig()">Configure Days</button>
        ${monthLinks}
      </div>`;
  }

  return allDays.map(sc => pcsRenderDayCard(sc)).join('');
}

function pcsRenderDayCard(sessionConfig) {
  const { date, isActive } = sessionConfig;
  const patients   = pcsPatientsOnDate(date);
  const confirmed  = pcsCountStatus(patients, 'confirmed');
  const cancelled  = pcsCountStatus(patients, 'cancelled');
  const noshow     = pcsCountStatus(patients, 'noshow');
  const apologized = pcsCountStatus(patients, 'apologized');
  const isCancelled = !isActive;

  const chips = [
    confirmed  > 0 ? `<span class="pcs-chip pcs-chip-green">${confirmed} Confirmed</span>`  : '',
    cancelled  > 0 ? `<span class="pcs-chip pcs-chip-red">${cancelled} Cancelled</span>`   : '',
    noshow     > 0 ? `<span class="pcs-chip pcs-chip-yellow">${noshow} No-Show</span>`     : '',
    apologized > 0 ? `<span class="pcs-chip pcs-chip-grey">${apologized} Apologized</span>`: '',
    sessionConfig._orphan ? `<span class="pcs-chip pcs-chip-yellow" title="This date has patients but is not in your session schedule. Open Configure Days to add it.">Not in schedule</span>` : '',
  ].filter(Boolean).join('');

  const historyItems = portCathActionHistory
    .filter(h => h.fromDate === date || h.toDate === date)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5);

  return `
    <div class="pcs-day-card ${isCancelled ? 'pcs-card-cancelled' : ''}" id="pcs-card-${date}">
      <div class="pcs-card-header" role="button" tabindex="0"
           aria-label="Toggle ${pcsFormatDate(date)}"
           onclick="pcsToggleCard('${date}')"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pcsToggleCard('${date}')}">
        <div class="pcs-card-count">${isCancelled ? '✕' : patients.length}</div>
        <div class="pcs-card-info">
          <div class="pcs-card-date">${pcsFormatDate(date)}</div>
          <div class="pcs-card-chips">
            ${isCancelled
              ? `<span class="pcs-chip pcs-chip-red">Day Cancelled</span>`
              : (chips || `<span class="pcs-chip pcs-chip-grey">No patients</span>`)
            }
          </div>
        </div>
        <div class="pcs-card-toggle" aria-hidden="true">▼</div>
        <div class="pcs-card-day-actions" onclick="event.stopPropagation()">
          <button class="pcs-day-act-btn" title="Print this day" onclick="pcsPrint('${date}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          </button>
          <button class="pcs-day-act-btn" title="Export this day to Word" onclick="pcsExportWord('${date}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>
          </button>
        </div>
      </div>

      <div class="pcs-patient-list" style="display:none">
        ${patients.length === 0
          ? `<div style="padding:12px 16px;font-size:0.75rem;color:var(--text-muted)">No patients scheduled for this day.</div>`
          : patients.map(p => pcsRenderPatientRow(p)).join('')
        }
      </div>

      <div class="pcs-history-toggle" role="button" tabindex="0"
           aria-label="Toggle history for ${date}"
           onclick="pcsToggleHistory('${date}')"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pcsToggleHistory('${date}')}">
        <span>History (${historyItems.length} event${historyItems.length === 1 ? '' : 's'})</span>
        <span aria-hidden="true">▼</span>
      </div>
      <div class="pcs-history-list" id="pcs-hist-${date}" style="display:none">
        ${historyItems.length === 0
          ? `<div style="font-size:0.7rem;color:var(--text-muted);padding:4px 0">No history recorded.</div>`
          : historyItems.map(h => pcsRenderHistoryItem(h)).join('')
        }
      </div>
    </div>`;
}

// Modal variant — all actions shown inline, no dropdown (avoids overflow clipping)
function pcsRenderPatientRowModal(patient) {
  const status    = patient.status || 'confirmed';
  const dotSymbol = { confirmed: '✓', cancelled: '✕', noshow: '–', apologized: '~' }[status] || '?';
  const isInactive = ['cancelled','noshow','apologized'].includes(status);
  return `
    <div class="pcs-patient-row pcs-patient-row-modal" data-patient-id="${patient.id}">
      <div class="pcs-status-dot ${status}">${dotSymbol}</div>
      <div class="pcs-modal-row-main">
        <div class="pcs-patient-name">${patient.name}</div>
        <div class="pcs-patient-meta">File # ${patient.fileNumber}${patient.weight ? ` · ${patient.weight} kg` : ''}${patient.notes ? ` · ${patient.notes}` : ''}</div>
      </div>
      <div class="pcs-modal-inline-actions">
        <button class="pcs-action-btn move"      onclick="pcsOpenMoveModal('${patient.id}')">Move</button>
        ${!isInactive ? `<button class="pcs-action-btn cancel"    onclick="pcsOpenActionModal('${patient.id}','cancel')">Cancel</button>` : ''}
        ${!isInactive ? `<button class="pcs-action-btn pcs-modal-btn-noshow" onclick="pcsOpenActionModal('${patient.id}','noshow')">No-Show</button>` : ''}
        ${!isInactive ? `<button class="pcs-action-btn pcs-modal-btn-apologize" onclick="pcsOpenActionModal('${patient.id}','apologize')">Apologize</button>` : ''}
        ${isInactive  ? `<button class="pcs-action-btn pcs-modal-btn-restore"  onclick="pcsOpenActionModal('${patient.id}','restore')">Restore</button>` : ''}
        <button class="pcs-action-btn pcs-modal-btn-edit" onclick="pcsEditPatient('${patient.id}')">Edit</button>
      </div>
    </div>`;
}

// Note: innerHTML interpolation of patient.name/fileNumber is consistent with
// the existing app.js pattern throughout this codebase.
function pcsRenderPatientRow(patient) {
  const status = patient.status || 'confirmed';
  const dotSymbol = { confirmed: '✓', cancelled: '✕', noshow: '–', apologized: '~' }[status] || '?';
  return `
    <div class="pcs-patient-row" data-patient-id="${patient.id}">
      <div class="pcs-status-dot ${status}">${dotSymbol}</div>
      <div class="pcs-patient-name">${patient.name}</div>
      <div class="pcs-patient-meta">File # ${patient.fileNumber}</div>
      <div class="pcs-patient-actions" style="position:relative">
        <button class="pcs-action-btn move" onclick="pcsOpenMoveModal('${patient.id}')">Move</button>
        <button class="pcs-action-btn cancel" onclick="pcsOpenActionModal('${patient.id}','cancel')">Cancel</button>
        <button class="pcs-action-btn more" aria-label="More actions for ${patient.name}" onclick="pcsToggleMoreMenu(event,'${patient.id}')">⋯</button>
        <div class="pcs-more-menu" id="pcs-more-${patient.id}">
          <button class="pcs-more-item" onclick="pcsOpenActionModal('${patient.id}','noshow')">No-Show</button>
          <button class="pcs-more-item" onclick="pcsOpenActionModal('${patient.id}','apologize')">Apologize</button>
          <button class="pcs-more-item" onclick="pcsOpenActionModal('${patient.id}','restore')">Restore</button>
          <button class="pcs-more-item" onclick="pcsEditPatient('${patient.id}')">Edit</button>
        </div>
      </div>
    </div>`;
}

// ── Waiting List ──────────────────────────────────────────────────────────────
function pcsRenderWaitingList() {
  const waiting = portCathList.filter(p => (p.status || '') === 'waiting');

  return `
    <div class="pcs-day-card pcs-waiting-card">
      <div class="pcs-card-header pcs-card-header-static">
        <div class="pcs-card-count">${waiting.length}</div>
        <div class="pcs-card-info">
          <div class="pcs-card-date">Pending Scheduling</div>
          <div class="pcs-card-chips">
            ${waiting.length === 0
              ? `<span class="pcs-chip pcs-chip-grey">No patients waiting</span>`
              : `<span class="pcs-chip pcs-chip-yellow">${waiting.length} awaiting date</span>`}
          </div>
        </div>
      </div>
      <div class="pcs-patient-list pcs-waiting-list" style="display:block">
        ${waiting.length === 0
          ? `<div style="padding:12px 16px;font-size:0.75rem;color:var(--text-muted)">No patients on the waiting list. Use "Waiting List" above to add one.</div>`
          : waiting.map(p => pcsRenderWaitingRow(p)).join('')
        }
      </div>
    </div>`;
}

function pcsRenderWaitingRow(patient) {
  return `
    <div class="pcs-patient-row pcs-patient-row-modal" data-patient-id="${patient.id}">
      <div class="pcs-status-dot waiting">⏳</div>
      <div class="pcs-modal-row-main">
        <div class="pcs-patient-name">${patient.name}</div>
        <div class="pcs-patient-meta">File # ${patient.fileNumber}${patient.weight ? ` · ${patient.weight} kg` : ''}${patient.notes ? ` · ${patient.notes}` : ''}</div>
      </div>
      <div class="pcs-modal-inline-actions">
        <button class="pcs-action-btn pcs-modal-btn-assign" onclick="pcsOpenAssignDateModal('${patient.id}')">Assign Date</button>
        <button class="pcs-action-btn pcs-modal-btn-edit" onclick="pcsEditWaitingPatient('${patient.id}')">Edit</button>
        <button class="pcs-action-btn cancel" onclick="deletePatient('portcath','${patient.id}')">Remove</button>
      </div>
    </div>`;
}

function pcsRenderHistoryItem(h) {
  const labels = { move:'Move', cancel:'Cancel', noshow:'No-Show', apologize:'Apologize', restore:'Restore', add:'Add', edit:'Edit' };
  const timeStr = new Date(h.timestamp).toLocaleString('en-US', { dateStyle:'short', timeStyle:'short' });
  const desc = h.action === 'move'
    ? `${h.patientName} — from ${h.fromDate} to ${h.toDate} · ${h.reason}`
    : `${h.patientName} · ${h.reason || ''}`;
  return `
    <div class="pcs-history-item">
      <span class="pcs-history-action">${labels[h.action] || h.action}</span>
      <span class="pcs-history-desc">${desc}</span>
      <span class="pcs-history-time">${timeStr}</span>
    </div>`;
}

// ── Toggle helpers ────────────────────────────────────────────────────────────
function pcsToggleCard(date) {
  const card = document.getElementById(`pcs-card-${date}`);
  if (!card) return;
  card.classList.toggle('open');
  const list = card.querySelector('.pcs-patient-list');
  if (list) list.style.display = card.classList.contains('open') ? 'block' : 'none';
}

function pcsToggleHistory(date) {
  const hist = document.getElementById(`pcs-hist-${date}`);
  if (hist) hist.style.display = hist.style.display === 'none' ? 'block' : 'none';
}

function pcsToggleMoreMenu(e, patientId) {
  e.stopPropagation();
  document.querySelectorAll('.pcs-more-menu.active').forEach(m => {
    if (m.id !== `pcs-more-${patientId}`) {
      m.classList.remove('active');
      m.style.cssText = '';
    }
  });
  const menu = document.getElementById(`pcs-more-${patientId}`);
  if (!menu) return;

  const willOpen = !menu.classList.contains('active');

  // When inside the day modal, use fixed positioning to escape overflow:auto clipping
  if (willOpen && document.getElementById('pcs-day-modal-overlay')) {
    const btn = e.target.closest('button') || e.target;
    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top      = (rect.bottom + 4) + 'px';
    menu.style.right    = (window.innerWidth - rect.right) + 'px';
    menu.style.left     = 'auto';
    menu.style.zIndex   = '1700';
    menu.style.minWidth = '140px';
  } else if (!willOpen) {
    menu.style.cssText = '';
  }

  menu.classList.toggle('active');
}

function pcsCloseAllMoreMenus() {
  document.querySelectorAll('.pcs-more-menu.active').forEach(m => m.classList.remove('active'));
}

// ── Stubs for handlers defined in later tasks ─────────────────────────────────
// pcsOpenConfig defined below in Session Config section
function pcsOpenMoveModal(patientId)       { _pcsMoveOpen(patientId); }
function pcsOpenActionModal(patientId, action) { _pcsActionOpen(patientId, action); }
function pcsEditPatient(patientId)         { openEditPatient('portcath', patientId); }
// ── Print & Export helpers ────────────────────────────────────────────────────

function _pcsBuildDaySections(dateStr) {
  // If dateStr given: just that day. Otherwise: all days in current month view.
  let days;
  if (dateStr) {
    days = [{ date: dateStr }];
  } else {
    const prefix = `${pcStudioYear}-${String(pcStudioMonth + 1).padStart(2,'0')}-`;
    const configDays  = portCathSessionConfig.filter(c => c.date.startsWith(prefix) && c.isActive);
    const configSet   = new Set(configDays.map(c => c.date));
    const orphanDates = [...new Set(
      portCathList.filter(p => p.date && p.date.startsWith(prefix) && !configSet.has(p.date)).map(p => p.date)
    )].map(date => ({ date }));
    days = [...configDays, ...orphanDates].sort((a, b) => a.date.localeCompare(b.date));
  }
  return days;
}

function _pcsBuildPrintHTML(dateStr, preparedBy, forWord) {
  const days      = _pcsBuildDaySections(dateStr);
  const baseHref  = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
  const printedAt = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  const titleLine = dateStr
    ? pcsFormatDate(dateStr)
    : `Port Cath Schedule — ${PCS_MONTHS_AR[pcStudioMonth]} ${pcStudioYear}`;

  const sections = days.map((sc, idx) => {
    const patients = pcsPatientsOnDate(sc.date).filter(p => !['cancelled','noshow','apologized'].includes(p.status));
    const count    = patients.length;
    const rows = count === 0
      ? `<tr><td colspan="5" class="empty-row">No patients scheduled for this day.</td></tr>`
      : patients.map((p, i) => `
          <tr class="${i % 2 === 0 ? 'row-even' : 'row-odd'}">
            <td class="col-num">${i + 1}</td>
            <td class="col-name">${p.name || '—'}</td>
            <td class="col-file">${p.fileNumber || '—'}</td>
            <td class="col-date">${pcsFormatDate(sc.date)}</td>
            <td class="col-weight">${p.weight ? p.weight + ' kg' : '—'}</td>
            <td class="col-notes">${p.notes || ''}</td>
          </tr>`).join('');
    const pb = (!forWord && idx < days.length - 1) ? ' page-break' : '';
    return `
      <div class="day-section${pb}">
        <div class="day-header">
          <div class="day-title">${pcsFormatDate(sc.date)}</div>
          <div class="patient-badge">${count} ${count === 1 ? 'Patient' : 'Patients'}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th class="col-num">#</th>
              <th class="col-name">Patient Name</th>
              <th class="col-file">File #</th>
              <th class="col-date">Date &amp; Day</th>
              <th class="col-weight">Weight</th>
              <th class="col-notes">Notes</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  const noData = days.length === 0
    ? '<p class="no-data">No sessions scheduled for this period.</p>'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <base href="${baseHref}">
  <title>${titleLine}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 11pt;
      color: #0f172a;
      background: #fff;
      padding: ${forWord ? '0.5in' : '24px'};
    }
    /* ── Hospital header ── */
    .hospital-header {
      display: flex;
      align-items: center;
      gap: 18px;
      padding-bottom: 14px;
      border-bottom: 2.5px solid #0d9488;
      margin-bottom: 22px;
    }
    .hospital-logo {
      width: 72px;
      height: 72px;
      object-fit: contain;
      flex-shrink: 0;
    }
    .hospital-info { flex: 1; }
    .hospital-name {
      font-size: 15pt;
      font-weight: 700;
      color: #0d9488;
      letter-spacing: -0.3px;
      line-height: 1.2;
    }
    .report-title {
      font-size: 11pt;
      font-weight: 600;
      color: #334155;
      margin-top: 4px;
    }
    .report-meta {
      font-size: 8.5pt;
      color: #64748b;
      margin-top: 3px;
    }
    /* ── Day section ── */
    .day-section {
      margin-bottom: 28px;
      page-break-inside: avoid;
    }
    .page-break { page-break-after: always; }
    .day-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #f0fdfa;
      border-left: 4px solid #0d9488;
      padding: 8px 12px;
      border-radius: 0 6px 6px 0;
      margin-bottom: 8px;
    }
    .day-title { font-size: 11pt; font-weight: 700; color: #0f172a; }
    .patient-badge {
      background: #0d9488;
      color: #fff;
      font-size: 8.5pt;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 999px;
      white-space: nowrap;
    }
    /* ── Table ── */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5pt;
    }
    th {
      background: #0d9488;
      color: #fff;
      font-weight: 600;
      padding: 7px 9px;
      text-align: left;
      white-space: nowrap;
    }
    td { padding: 6px 9px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .row-even { background: #fff; }
    .row-odd  { background: #f8fafc; }
    .col-num   { width: 32px;  text-align: center; }
    .col-name  { min-width: 130px; }
    .col-file  { width: 80px; }
    .col-date  { width: 140px; }
    .col-weight{ width: 70px; text-align: center; }
    .col-notes { }
    .empty-row { text-align: center; color: #94a3b8; font-style: italic; padding: 14px; }
    .no-data   { text-align: center; color: #94a3b8; font-style: italic; margin: 40px 0; }
    /* ── Footer ── */
    .print-footer {
      margin-top: 28px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      font-size: 8pt;
      color: #64748b;
    }
    @media print {
      body { padding: 0; }
      .page-break { page-break-after: always; }
    }
  </style>
</head>
<body>
  <div class="hospital-header">
    <img class="hospital-logo" src="logo.png" alt="Hospital Logo" onerror="this.style.display='none'">
    <div class="hospital-info">
      <div class="hospital-name">Port Cath Scheduling</div>
      <div class="report-title">${titleLine}</div>
      <div class="report-meta">Printed: ${printedAt}</div>
    </div>
  </div>

  ${noData}${sections}

  <div class="print-footer">
    <span><strong>Prepared by:</strong> ${preparedBy || 'Port Cath Team'}</span>
    <span>${printedAt}</span>
  </div>
</body>
</html>`;
}

function pcsPrint(dateStr) {
  const preparedBy = prompt('Prepared by (اسم المحضِّر):', '') ?? '';
  const html = _pcsBuildPrintHTML(dateStr, preparedBy, false);
  const printWin = window.open('', '_blank', 'width=900,height=700');
  if (!printWin) { alert('Please allow pop-ups to print.'); return; }
  printWin.document.write(html);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => printWin.print(), 600);
}

function _pcsBuildWordHTML(dateStr, preparedBy) {
  const days  = _pcsBuildDaySections(dateStr);
  const title = dateStr
    ? `Port Cath — ${pcsFormatDate(dateStr)}`
    : `Port Cath Schedule — ${PCS_MONTHS_AR[pcStudioMonth]} ${pcStudioYear}`;

  const sections = days.map(sc => {
    const patients = pcsPatientsOnDate(sc.date).filter(p => !['cancelled','noshow','apologized'].includes(p.status));
    const rows = patients.length === 0
      ? `<tr><td colspan="5" style="text-align:center;color:#888;font-style:italic">No patients</td></tr>`
      : patients.map((p, i) => `
          <tr>
            <td style="text-align:center">${i + 1}</td>
            <td>${p.name || ''}</td>
            <td>${p.fileNumber || ''}</td>
            <td>${p.weight ? p.weight + ' kg' : ''}</td>
            <td>${p.notes || ''}</td>
          </tr>`).join('');

    const dayHeader = days.length > 1
      ? `<h3 style="font-size:11pt;margin:18px 0 6px">${pcsFormatDate(sc.date)} &nbsp;·&nbsp; ${patients.length} patient${patients.length !== 1 ? 's' : ''}</h3>`
      : '';

    return `${dayHeader}
      <table border="1" cellspacing="0" cellpadding="5" style="width:100%;border-collapse:collapse;font-size:10pt">
        <thead>
          <tr style="background:#e2e8f0">
            <th style="width:30px">#</th>
            <th>Patient Name</th>
            <th style="width:80px">File #</th>
            <th style="width:70px">Weight</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('');

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body {
    font-family: Calibri, Arial, sans-serif;
    font-size: 11pt;
    margin: 0.6in 1in 1in;
    color: #000;
  }
  .header {
    text-align: center;
    border-bottom: 2px solid #0d9488;
    padding-bottom: 8px;
    margin-bottom: 16px;
  }
  .header h1 {
    font-size: 15pt;
    font-weight: 700;
    margin: 0 0 3px;
    color: #0d9488;
  }
  .header .subtitle {
    font-size: 9.5pt;
    color: #555;
    margin: 0;
  }
  .day-title {
    font-size: 11pt;
    font-weight: 700;
    margin: 18px 0 6px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10pt;
  }
  th {
    text-align: left;
    padding: 6px 8px;
    font-weight: 700;
    border: 1px solid #000;
    background: none;
    color: #000;
  }
  td {
    padding: 5px 8px;
    border: 1px solid #999;
    vertical-align: top;
    color: #000;
  }
</style>
</head><body>
  <div class="header">
    <h1>${title}</h1>
    <p class="subtitle">${today}</p>
  </div>
  ${sections}
</body></html>`;
}

function pcsExportWord(dateStr) {
  const preparedBy = prompt('Prepared by (اسم المحضِّر):', '') ?? '';
  const html = _pcsBuildWordHTML(dateStr, preparedBy);

  // Try to embed logo as base64; fall back to URL on CORS/canvas errors
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function () {
    let finalHtml = html;
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth  || 100;
      canvas.height = img.naturalHeight || 100;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const b64 = canvas.toDataURL('image/png');
      finalHtml = html.replace(/src="logo\.png"/, `src="${b64}"`);
    } catch (_) { /* canvas tainted — keep relative URL */ }
    _pcsDownloadDoc(finalHtml, dateStr);
  };
  img.onerror = function () {
    _pcsDownloadDoc(html, dateStr);
  };
  img.src = 'logo.png?' + Date.now(); // cache-bust to get fresh CORS headers
}

function _pcsDownloadDoc(html, dateStr) {
  const label  = dateStr ? dateStr : `${PCS_MONTHS_AR[pcStudioMonth]}-${pcStudioYear}`;
  const fname  = `PortCath-${label}.doc`;
  const blob   = new Blob(['﻿' + html], { type: 'application/msword' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = fname;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Session Config ────────────────────────────────────────────────────────────
let _pcsConfigYear  = new Date().getFullYear();
let _pcsConfigMonth = new Date().getMonth();

function pcsOpenConfig() {
  _pcsConfigYear  = pcStudioYear;
  _pcsConfigMonth = pcStudioMonth;
  const overlay = document.getElementById('pcs-config-overlay');
  if (overlay) overlay.classList.add('active');
  pcsRenderConfigCalendar();
}

function pcsCloseConfig() {
  const overlay = document.getElementById('pcs-config-overlay');
  if (overlay) overlay.classList.remove('active');
}

function pcsConfigNavigateMonth(delta) {
  _pcsConfigMonth += delta;
  if (_pcsConfigMonth < 0)  { _pcsConfigMonth = 11; _pcsConfigYear--; }
  if (_pcsConfigMonth > 11) { _pcsConfigMonth = 0;  _pcsConfigYear++; }
  pcsRenderConfigCalendar();
}

function pcsRenderConfigCalendar() {
  const inner = document.getElementById('pcs-config-inner');
  if (!inner) return;

  const year  = _pcsConfigYear;
  const month = _pcsConfigMonth;
  const m1    = month + 1;
  const prefix = `${year}-${String(m1).padStart(2,'0')}-`;

  const activeDays    = portCathSessionConfig.filter(c => c.date.startsWith(prefix) && c.isActive).length;
  const cancelledDays = portCathSessionConfig.filter(c => c.date.startsWith(prefix) && !c.isActive).length;

  const firstDOW    = new Date(`${year}-${String(m1).padStart(2,'0')}-01`).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let cells = '';
  for (let i = 0; i < firstDOW; i++) {
    cells += `<div class="pcs-cal-day empty"></div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = pcsDateStr(year, m1, d);
    const conf = portCathSessionConfig.find(c => c.date === dateStr);
    let cls = 'inactive';
    if (conf) cls = conf.isActive ? 'active' : 'cancelled-day';
    const count = pcsPatientsOnDate(dateStr).length;
    const countLabel = count > 0 ? `${count}` : '';
    const delay = (firstDOW + d - 1) * 16;
    cells += `
      <div class="pcs-cal-day ${cls}" data-date="${dateStr}"
           style="animation-delay:${delay}ms"
           role="button" tabindex="0"
           aria-label="${dateStr}${countLabel ? ', ' + countLabel + ' patient' + (parseInt(countLabel)===1?'':'s') : ''}"
           onclick="pcsToggleDay('${dateStr}')"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pcsToggleDay('${dateStr}')}">
        <span class="pcs-dn">${d}</span>
        <span class="pcs-dc">${countLabel}</span>
      </div>`;
  }

  inner.innerHTML = `
    <div class="pcs-config-shell">
      <aside class="pcs-config-rail">
        <div class="pcs-eyebrow" style="font-size:0.6rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--primary);margin-bottom:10px;">Port Cath Studio</div>
        <h2 style="font-size:1.3rem;font-weight:800;letter-spacing:-0.025em;color:var(--text-main);margin-bottom:8px;line-height:1.2;">Configure<br/>Sessions</h2>
        <p style="font-size:0.75rem;color:var(--text-muted);line-height:1.6;margin-bottom:24px;">Select Port Cath session days for each month. Patient counts update automatically.</p>
        <div class="pcs-stat-list">
          <div class="pcs-stat-row">
            <div class="pcs-stat-pip blue"></div>
            <span class="pcs-stat-lbl">Active days</span>
            <span class="pcs-stat-val">${activeDays}</span>
          </div>
          <div class="pcs-stat-row">
            <div class="pcs-stat-pip red"></div>
            <span class="pcs-stat-lbl">Cancelled days</span>
            <span class="pcs-stat-val">${cancelledDays}</span>
          </div>
        </div>
        <div class="pcs-legend">
          <div class="pcs-legend-item"><div class="pcs-ldot a"></div>Active session</div>
          <div class="pcs-legend-item"><div class="pcs-ldot c"></div>Cancelled</div>
          <div class="pcs-legend-item"><div class="pcs-ldot n"></div>Unset</div>
        </div>
      </aside>
      <main>
        <div class="pcs-cal-card">
          <div class="pcs-cal-topbar">
            <div style="display:flex;align-items:center;gap:8px;">
              <button class="pcs-nav-btn" onclick="pcsConfigNavigateMonth(-1)">&#8250;</button>
              <span class="pcs-month-label">${PCS_MONTHS_AR[month]} ${year}</span>
              <button class="pcs-nav-btn" onclick="pcsConfigNavigateMonth(1)">&#8249;</button>
            </div>
            <span style="font-size:0.67rem;color:var(--text-muted)">Click a day to toggle it</span>
          </div>
          <div class="pcs-cal-body">
            <div class="pcs-day-hdr-row">
              <div class="pcs-dh">Sun</div><div class="pcs-dh">Mon</div>
              <div class="pcs-dh">Tue</div><div class="pcs-dh">Wed</div>
              <div class="pcs-dh">Thu</div><div class="pcs-dh">Fri</div>
              <div class="pcs-dh">Sat</div>
            </div>
            <div class="pcs-cal-grid">${cells}</div>
            <div class="pcs-cal-hint">
              <b>Click</b> an empty date to add a session day ·
              <b>Click</b> an active day to cancel it · Patient counts update automatically
            </div>
          </div>
          <div class="pcs-cal-footer">
            <button class="pcs-btn" onclick="pcsCloseConfig()">Cancel</button>
            <button class="pcs-btn pcs-btn-primary" onclick="pcsSaveConfig()">
              Save &amp; Sync
            </button>
          </div>
        </div>
      </main>
    </div>`;
}

function pcsToggleDay(dateStr) {
  const existing = portCathSessionConfig.find(c => c.date === dateStr);
  if (!existing) {
    portCathSessionConfig.push({
      id: Date.now().toString(),
      date: dateStr,
      isActive: true,
      createdAt: new Date().toISOString(),
      _isNew: true
    });
  } else if (existing.isActive) {
    existing.isActive = false;
  } else {
    existing.isActive = true;
  }
  pcsRenderConfigCalendar();
}

function pcsSaveConfig() {
  saveToLocalStorage();
  portCathSessionConfig.forEach(c => {
    const action = c._isNew ? 'create' : 'update';
    syncAfterChange(action, 'portcath-session-config', c);
    delete c._isNew;
  });
  pcsCloseConfig();
  renderPortCathStudio();
  if (typeof showToast === 'function') showToast('Session days saved and synced.', 'success', 2600);
}

// ── Waiting List: Add / Edit ──────────────────────────────────────────────────
let _pcsWaitingEditId = null;

function pcsOpenWaitingAddModal() {
  _pcsWaitingEditId = null;
  document.getElementById('pcs-waiting-add-title').textContent = 'Add to Waiting List';
  document.getElementById('pcs-waiting-name').value = '';
  document.getElementById('pcs-waiting-file').value = '';
  document.getElementById('pcs-waiting-weight').value = '';
  document.getElementById('pcs-waiting-phone').value = '';
  document.getElementById('pcs-waiting-notes').value = '';
  document.getElementById('pcs-waiting-add-err').classList.remove('visible');
  document.getElementById('pcs-waiting-add-overlay').classList.add('active');
}

function pcsEditWaitingPatient(patientId) {
  const patient = portCathList.find(p => p.id === patientId);
  if (!patient) return;
  _pcsWaitingEditId = patientId;
  document.getElementById('pcs-waiting-add-title').textContent = 'Edit Waiting List Patient';
  document.getElementById('pcs-waiting-name').value = patient.name || '';
  document.getElementById('pcs-waiting-file').value = patient.fileNumber || '';
  document.getElementById('pcs-waiting-weight').value = patient.weight || '';
  document.getElementById('pcs-waiting-phone').value = patient.phone || '';
  document.getElementById('pcs-waiting-notes').value = patient.notes || '';
  document.getElementById('pcs-waiting-add-err').classList.remove('visible');
  document.getElementById('pcs-waiting-add-overlay').classList.add('active');
}

function pcsCloseWaitingAddModal() {
  document.getElementById('pcs-waiting-add-overlay').classList.remove('active');
  _pcsWaitingEditId = null;
}

function pcsConfirmWaitingAdd() {
  const name       = document.getElementById('pcs-waiting-name').value.trim();
  const fileNumber = document.getElementById('pcs-waiting-file').value.trim();
  const weight     = parseFloat(document.getElementById('pcs-waiting-weight').value);
  const phone      = document.getElementById('pcs-waiting-phone').value.trim();
  const notes      = document.getElementById('pcs-waiting-notes').value.trim();
  const errEl      = document.getElementById('pcs-waiting-add-err');

  if (!name || !fileNumber || isNaN(weight)) {
    errEl.classList.add('visible');
    return;
  }
  errEl.classList.remove('visible');

  if (_pcsWaitingEditId) {
    const patient = portCathList.find(p => p.id === _pcsWaitingEditId);
    if (patient) {
      patient.name = name;
      patient.fileNumber = fileNumber;
      patient.weight = weight;
      patient.notes = notes;
      if (phone) patient.phone = phone;
      syncAfterChange('update', 'portcath', patient);
    }
  } else {
    const patient = {
      id: Date.now().toString(),
      name, fileNumber,
      date: '', day: '',
      weight, notes,
      status: 'waiting',
      ...(phone && { phone })
    };
    portCathList.push(patient);
    syncAfterChange('create', 'portcath', patient);
  }

  pcsCloseWaitingAddModal();
  renderPortCathStudio();
  if (typeof showToast === 'function') showToast(`${name} saved to Waiting List`, 'success', 2600);
}

// ── Waiting List: Assign Date (moves patient out of the waiting list) ────────
let _pcsWaitingAssignId = null;

function pcsOpenAssignDateModal(patientId) {
  const patient = portCathList.find(p => p.id === patientId);
  if (!patient) return;
  _pcsWaitingAssignId = patientId;
  document.getElementById('pcs-waiting-assign-info').textContent =
    `${patient.name} · File # ${patient.fileNumber}`;
  document.getElementById('pcs-waiting-assign-date').value = '';
  document.getElementById('pcs-waiting-assign-err').classList.remove('visible');
  document.getElementById('pcs-waiting-assign-overlay').classList.add('active');
}

function pcsCloseAssignDateModal() {
  document.getElementById('pcs-waiting-assign-overlay').classList.remove('active');
  _pcsWaitingAssignId = null;
}

function pcsConfirmAssignDate() {
  const patient = portCathList.find(p => p.id === _pcsWaitingAssignId);
  if (!patient) return;

  const dateVal = document.getElementById('pcs-waiting-assign-date').value;
  const errEl   = document.getElementById('pcs-waiting-assign-err');
  if (!dateVal) { errEl.classList.add('visible'); return; }
  errEl.classList.remove('visible');

  patient.date   = dateVal;
  patient.day    = pcsDayName(dateVal);
  patient.status = 'confirmed';

  const histRecord = {
    id:          Date.now().toString() + '_assign',
    patientId:   patient.id,
    patientName: patient.name,
    fileNumber:  patient.fileNumber,
    action:      'move',
    fromDate:    '',
    toDate:      dateVal,
    reason:      'Assigned from Waiting List',
    note:        '',
    timestamp:   Date.now(),
    syncStatus:  'pending'
  };
  portCathActionHistory.push(histRecord);

  saveToLocalStorage();
  syncAfterChange('update', 'portcath', patient);
  syncAfterChange('create', 'portcath-history', histRecord);

  pcsCloseAssignDateModal();
  updateDateDropdown('portcath');
  renderPortCathStudio();
  renderDashboard();
  renderCalendar();
  if (typeof showToast === 'function')
    showToast(`${patient.name} scheduled for ${pcsFormatDate(dateVal)}`, 'success', 3000);
}

// ── Move Workflow ─────────────────────────────────────────────────────────────
let _pcsMovePatientId = null;

function _pcsMoveOpen(patientId) {
  const patient = portCathList.find(p => p.id === patientId);
  if (!patient) return;
  _pcsMovePatientId = patientId;

  document.getElementById('pcs-move-patient-info').textContent =
    `${patient.name} · File # ${patient.fileNumber}`;

  const today  = new Date().toISOString().split('T')[0];
  const select = document.getElementById('pcs-move-date-select');
  select.innerHTML = `<option value="">Select session day</option>`;
  portCathSessionConfig
    .filter(c => c.isActive && c.date !== patient.date && c.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.date;
      opt.textContent = pcsFormatDate(c.date);
      select.appendChild(opt);
    });

  document.getElementById('pcs-move-reason').value = '';
  document.getElementById('pcs-move-reason-err').classList.remove('visible');
  document.getElementById('pcs-move-overlay').classList.add('active');
}

function pcsCloseMoveModal() {
  document.getElementById('pcs-move-overlay').classList.remove('active');
  _pcsMovePatientId = null;
}

function pcsConfirmMove() {
  const patient = portCathList.find(p => p.id === _pcsMovePatientId);
  if (!patient) return;

  const toDate = document.getElementById('pcs-move-date-select').value;
  const reason = document.getElementById('pcs-move-reason').value.trim();

  const errEl = document.getElementById('pcs-move-reason-err');
  if (reason.length < 3) { errEl.classList.add('visible'); return; }
  errEl.classList.remove('visible');
  if (!toDate) { if (typeof showToast === 'function') showToast('Please select a destination date.', 'warning', 3000); return; }

  const fromDate = patient.date;

  // 1. Update patient record
  patient.date = toDate;
  patient.day  = pcsDayName(toDate);

  // 2. Append history record
  const histRecord = {
    id:          Date.now().toString() + '_move',
    patientId:   patient.id,
    patientName: patient.name,
    fileNumber:  patient.fileNumber,
    action:      'move',
    fromDate,
    toDate,
    reason,
    note:        '',
    timestamp:   Date.now(),
    syncStatus:  'pending'
  };
  portCathActionHistory.push(histRecord);

  // 3. Persist and sync
  saveToLocalStorage();
  syncAfterChange('update', 'portcath', patient);
  syncAfterChange('create', 'portcath-history', histRecord);

  pcsCloseMoveModal();
  renderPortCathStudio();
  if (typeof showToast === 'function')
    showToast(`${patient.name} moved to ${pcsFormatDate(toDate)}`, 'success', 3000);
}

// ── Status Actions (cancel / noshow / apologize / restore) ────────────────────
const PCS_ACTION_LABELS = {
  cancel:    { title: 'Cancel Appointment', newStatus: 'cancelled'  },
  noshow:    { title: 'Record No-Show',     newStatus: 'noshow'     },
  apologize: { title: 'Record Apology',     newStatus: 'apologized' },
  restore:   { title: 'Restore Appointment',newStatus: 'confirmed'  }
};

let _pcsActionPatientId = null;
let _pcsActionType      = null;

function _pcsActionOpen(patientId, action) {
  const patient = portCathList.find(p => p.id === patientId);
  if (!patient || !PCS_ACTION_LABELS[action]) return;
  pcsCloseAllMoreMenus();
  _pcsActionPatientId = patientId;
  _pcsActionType      = action;

  document.getElementById('pcs-action-title').textContent = PCS_ACTION_LABELS[action].title;
  document.getElementById('pcs-action-patient-info').textContent =
    `${patient.name} · File # ${patient.fileNumber} · ${pcsFormatDate(patient.date)}`;
  document.getElementById('pcs-action-reason').value = '';
  document.getElementById('pcs-action-reason-err').classList.remove('visible');
  document.getElementById('pcs-action-overlay').classList.add('active');
}

function pcsCloseActionModal() {
  document.getElementById('pcs-action-overlay').classList.remove('active');
  _pcsActionPatientId = null;
  _pcsActionType      = null;
}

function pcsConfirmAction() {
  const patient = portCathList.find(p => p.id === _pcsActionPatientId);
  if (!patient || !_pcsActionType) return;

  const reason = document.getElementById('pcs-action-reason').value.trim();
  const errEl  = document.getElementById('pcs-action-reason-err');
  if (reason.length < 3) { errEl.classList.add('visible'); return; }
  errEl.classList.remove('visible');

  const { newStatus } = PCS_ACTION_LABELS[_pcsActionType];

  // 1. Update patient status
  patient.status = newStatus;

  // 2. History record
  const histRecord = {
    id:          Date.now().toString() + '_' + _pcsActionType,
    patientId:   patient.id,
    patientName: patient.name,
    fileNumber:  patient.fileNumber,
    action:      _pcsActionType,
    fromDate:    patient.date,
    toDate:      null, // null for non-move actions; fromDate = session date acted on
    reason,
    note:        '',
    timestamp:   Date.now(),
    syncStatus:  'pending'
  };
  portCathActionHistory.push(histRecord);

  // 3. Persist and sync
  saveToLocalStorage();
  syncAfterChange('update', 'portcath', patient);
  syncAfterChange('create', 'portcath-history', histRecord);

  pcsCloseActionModal();
  renderPortCathStudio();
  if (typeof showToast === 'function')
    showToast(`Status updated for ${patient.name}`, 'success', 2600);
}
