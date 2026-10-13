// ==================== CONFIG ====================
const API = 'https://script.google.com/macros/s/AKfycbzTLCLhgZ4Hnnums48mByAvESEjNtHeK6Aj7CbAJTcPvve9C2qJ122Cl6-cKC7Mzqw/exec';
const ARBOX_SCHEDULE_API = 'https://apiappv2.arboxapp.com/api/v2/site/schedule/betweenDates?XDEBUG_SESSION_START=PHPSTORM';

const HEB_DAYS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const HEB_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HOUR_START = 7;
const HOUR_END = 22;
const VALID_TABS = ['calendar', 'slots', 'tenants', 'types'];
const VALID_VIEWS = ['month', 'week', 'day'];

// ==================== STATE ====================
let state = {
  slots: [], tenants: [], types: [],
  slotsLoading: true,
  activeTab: 'calendar',
  calView: 'month',
  calDate: new Date(),
  classes: [],
  classesRangeKey: '',
  classesLoading: false,
  classesLoadingKey: ''
};
let globalLoadingCount = 0;

function renderGlobalLoading() {
  const el = document.getElementById('global-loading-overlay');
  if (!el) return;
  el.classList.toggle('open', globalLoadingCount > 0);
}
function beginGlobalLoading() {
  globalLoadingCount += 1;
  renderGlobalLoading();
}
function endGlobalLoading() {
  globalLoadingCount = Math.max(0, globalLoadingCount - 1);
  renderGlobalLoading();
}

// ==================== API ====================
async function apiGet(entity) {
  beginGlobalLoading();
  try {
    const res = await fetch(`${API}?entity=${entity}`);
    return await res.json() || [];
  } catch (e) { toast('שגיאה בטעינת נתונים', 'error'); return []; }
  finally { endGlobalLoading(); }
}

async function apiPost(action, entity, data, id) {
  beginGlobalLoading();
  try {
    const body = { action, entity, data };
    if (id) body.id = Number(id);
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'שגיאה');
    return result.result;
  } catch (e) { toast(e.message || 'שגיאה', 'error'); throw e; }
  finally { endGlobalLoading(); }
}

async function loadAll() {
  state.slotsLoading = true;
  renderCalendar();
  const [slots, tenants, types] = await Promise.all([
    apiGet('slots'), apiGet('tenants'), apiGet('types')
  ]);
  state.slots = Array.isArray(slots) ? slots : [];
  state.tenants = Array.isArray(tenants) ? tenants : [];
  state.types = Array.isArray(types) ? types : [];
  state.slotsLoading = false;
  renderAll();
}

// ==================== LOOKUPS ====================
function tenantName(id) {
  const t = state.tenants.find(x => Number(x.id) === Number(id));
  return t ? t.name : `#${id}`;
}
function typeName(id) {
  const t = state.types.find(x => Number(x.id) === Number(id));
  return t ? t.name : `#${id}`;
}
function typeChipsForTenant(typesStr) {
  if (!typesStr) return '—';
  return String(typesStr).split(',').map(id => {
    const t = state.types.find(x => Number(x.id) === Number(id.trim()));
    return t ? `<span class="type-chip">${t.name}</span>` : '';
  }).filter(Boolean).join(' ');
}
function tenantColor(id) { return `tenant-c${Number(id) % 8}`; }
function tenantSupportsType(tenantId, typeId) {
  const tenant = state.tenants.find(t => Number(t.id) === Number(tenantId));
  if (!tenant) return false;
  const allowed = String(tenant.types || '')
    .split(',')
    .map(v => Number(String(v).trim()))
    .filter(v => Number.isFinite(v) && v > 0);
  return allowed.includes(Number(typeId));
}

// ==================== DATE UTILS ====================
function fmtDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function toInputDate(dateStr) {
  if (!dateStr) return '';
  const p = dateStr.split('/');
  return p.length === 3 ? `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}` : '';
}
function fromInputDate(iso) {
  if (!iso) return '';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function parseDMY(s) {
  if (!s) return null;
  const p = String(s).split('/');
  if (p.length !== 3) return null;
  return new Date(Number(p[2]), Number(p[1])-1, Number(p[0]));
}
function parseYMD(s) {
  if (!s) return null;
  const p = String(s).split('-');
  if (p.length !== 3) return null;
  return new Date(Number(p[0]), Number(p[1])-1, Number(p[2]));
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function asDateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function boolish(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}
function isRecurringSlot(slot) {
  return boolish(slot && slot.is_recurring);
}
function nextRecurringDate(slot) {
  if (!isRecurringSlot(slot)) return slot.date;
  const base = parseDMY(slot.date);
  if (!base) return slot.date;
  const today = asDateOnly(new Date());
  const till = parseDMY(slot.recurring_till);
  const tillDay = till ? asDateOnly(till) : null;
  let cursor = asDateOnly(base);
  while (cursor < today) {
    cursor.setDate(cursor.getDate() + 7);
  }
  if (tillDay && cursor > tillDay) return slot.date;
  return fmtDate(cursor);
}
function sameDay(a, b) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
function timeToMin(t) {
  if (!t) return 0;
  const [h,m] = String(t).split(':').map(Number);
  return (h||0)*60 + (m||0);
}
function weekStart(d) {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay());
  return r;
}
function minutesToTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`;
}
function addMinutesToTime(timeStr, minutesToAdd) {
  const base = timeToMin(timeStr);
  const wrapped = ((base + minutesToAdd) % (24 * 60) + (24 * 60)) % (24 * 60);
  return minutesToTime(wrapped);
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function syncUrlState() {
  const u = new URL(window.location.href);
  u.searchParams.set('tab', state.activeTab);
  u.searchParams.set('view', state.calView);
  u.searchParams.set('date', isoDate(state.calDate));
  history.replaceState(null, '', `${u.pathname}?${u.searchParams.toString()}`);
}

function applyStateFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const tab = p.get('tab');
  const view = p.get('view');
  const date = p.get('date');

  if (VALID_TABS.includes(tab)) state.activeTab = tab;
  if (VALID_VIEWS.includes(view)) state.calView = view;
  const parsedDate = parseYMD(date);
  if (parsedDate) state.calDate = asDateOnly(parsedDate);
}

// ==================== RENDER ALL ====================
function renderAll() {
  renderSlots(); renderTenants(); renderTypes(); renderCalendar();
}

// ==================== TABLE RENDERS ====================
function renderSlots() {
  const upcomingBody = document.getElementById('slots-upcoming-body');
  const pastBody = document.getElementById('slots-past-body');

  document.getElementById('slots-count').textContent = state.slots.length;

  if (!state.slots.length) {
    upcomingBody.innerHTML = '<tr><td colspan="7"><div class="empty"><div class="empty-icon">📅</div>אין תורים עתידיים</div></td></tr>';
    pastBody.innerHTML = '<tr><td colspan="7"><div class="empty"><div class="empty-icon">📅</div>אין תורים בעבר</div></td></tr>';
    document.getElementById('slots-upcoming-count').textContent = '0';
    document.getElementById('slots-past-count').textContent = '0';
    return;
  }

  const now = new Date();
  const nowTime = now.getTime();

  // Separate slots into past and upcoming
  const upcomingSlots = [];
  const pastSlots = [];

  state.slots.forEach(s => {
    const slotDate = parseDMY(s.date);
    if (!slotDate) return;

    const slotDateTime = slotDate.getTime() + timeToMin(s.start_time) * 60000;
    const effectiveEndTime = isRecurringSlot(s) && s.recurring_till
      ? parseDMY(s.recurring_till)?.getTime() ?? slotDateTime
      : slotDateTime;

    if (effectiveEndTime >= nowTime) {
      upcomingSlots.push(s);
    } else {
      pastSlots.push(s);
    }
  });

  // Sort upcoming: earliest first (use next recurring date for recurring slots)
  upcomingSlots.sort((a, b) => {
    const ad = parseDMY(nextRecurringDate(a));
    const bd = parseDMY(nextRecurringDate(b));
    const at = (ad ? ad.getTime() : 0) + timeToMin(a.start_time) * 60000;
    const bt = (bd ? bd.getTime() : 0) + timeToMin(b.start_time) * 60000;
    return at - bt;
  });

  // Sort past: most recent first
  pastSlots.sort((a, b) => {
    const ad = parseDMY(a.date);
    const bd = parseDMY(b.date);
    const at = (ad ? ad.getTime() : 0) + timeToMin(a.start_time) * 60000;
    const bt = (bd ? bd.getTime() : 0) + timeToMin(b.start_time) * 60000;
    return bt - at;
  });

  // Render upcoming slots
  if (upcomingSlots.length === 0) {
    upcomingBody.innerHTML = '<tr><td colspan="7"><div class="empty"><div class="empty-icon">📅</div>אין תורים עתידיים</div></td></tr>';
  } else {
    upcomingBody.innerHTML = upcomingSlots.map(s => `<tr>
      <td class="slot-date" data-label="תאריך">${nextRecurringDate(s)||'—'}${isRecurringSlot(s) ? ` <span title="חוזר עד ${s.recurring_till || '—'}">🔁</span>` : ''}</td>
      <td class="slot-time" data-label="התחלה">${s.start_time||'—'}</td>
      <td class="slot-time" data-label="סיום">${s.end_time||'—'}</td>
      <td class="slot-tenant" data-label="מטפל">${tenantName(s.tenant_id)}</td>
      <td class="slot-type" data-label="סוג"><span class="type-chip">${typeName(s.type_id)}</span></td>
      <td class="slot-client" data-label="לקוח">${s.client_name||'—'}</td>
      <td class="actions-cell">
        <button class="btn btn-ghost btn-sm" onclick="openSlotModal(${s.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="confirmDelete('slots',${s.id})">🗑</button>
      </td>
    </tr>`).join('');
  }

  // Render past slots
  if (pastSlots.length === 0) {
    pastBody.innerHTML = '<tr><td colspan="7"><div class="empty"><div class="empty-icon">📅</div>אין תורים בעבר</div></td></tr>';
  } else {
    pastBody.innerHTML = pastSlots.map(s => `<tr>
      <td class="slot-date" data-label="תאריך">${s.date||'—'}${isRecurringSlot(s) ? ` <span title="חוזר עד ${s.recurring_till || '—'}">🔁</span>` : ''}</td>
      <td class="slot-time" data-label="התחלה">${s.start_time||'—'}</td>
      <td class="slot-time" data-label="סיום">${s.end_time||'—'}</td>
      <td class="slot-tenant" data-label="מטפל">${tenantName(s.tenant_id)}</td>
      <td class="slot-type" data-label="סוג"><span class="type-chip">${typeName(s.type_id)}</span></td>
      <td class="slot-client" data-label="לקוח">${s.client_name||'—'}</td>
      <td class="actions-cell">
        <button class="btn btn-ghost btn-sm" onclick="openSlotModal(${s.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="confirmDelete('slots',${s.id})">🗑</button>
      </td>
    </tr>`).join('');
  }

  // Update counts
  document.getElementById('slots-upcoming-count').textContent = upcomingSlots.length;
  document.getElementById('slots-past-count').textContent = pastSlots.length;
}

function renderTenants() {
  const body = document.getElementById('tenants-body');
  document.getElementById('tenants-count').textContent = state.tenants.length;
  if (!state.tenants.length) {
    body.innerHTML = '<tr><td colspan="4"><div class="empty"><div class="empty-icon">👤</div>אין מטפלים</div></td></tr>';
    return;
  }
  body.innerHTML = state.tenants.map(t => `<tr>
    <td><strong>${t.name}</strong></td>
    <td>${typeChipsForTenant(t.types)}</td>
    <td style="direction:ltr;text-align:right">${t.email||'—'}</td>
    <td class="actions-cell">
      <button class="btn btn-ghost btn-sm" onclick="openTenantModal(${t.id})">✏️</button>
      <button class="btn btn-danger btn-sm" onclick="confirmDelete('tenants',${t.id})">🗑</button>
    </td>
  </tr>`).join('');
}

function renderTypes() {
  const body = document.getElementById('types-body');
  document.getElementById('types-count').textContent = state.types.length;
  if (!state.types.length) {
    body.innerHTML = '<tr><td colspan="3"><div class="empty"><div class="empty-icon">🏷</div>אין סוגי טיפול</div></td></tr>';
    return;
  }
  body.innerHTML = state.types.map(t => `<tr>
    <td><strong>${t.name}</strong></td>
    <td>${t.class_among_can ? '<span class="bool-yes">✓ כן</span>' : '<span class="bool-no">✗ לא</span>'}</td>
    <td class="actions-cell">
      <button class="btn btn-ghost btn-sm" onclick="openTypeModal(${t.id})">✏️</button>
      <button class="btn btn-danger btn-sm" onclick="confirmDelete('types',${t.id})">🗑</button>
    </td>
  </tr>`).join('');
}

// ==================== ACCORDIONS ====================
function toggleAccordion(id) {
  const content = document.getElementById(`accordion-${id}`);
  const icon = document.getElementById(`accordion-icon-${id}`);
  if (!content || !icon) return;

  const isOpen = content.classList.contains('open');
  if (isOpen) {
    content.classList.remove('open');
    icon.textContent = '◀';
  } else {
    content.classList.add('open');
    icon.textContent = '▼';
  }
}

// ==================== TABS ====================
function setActiveTab(name, syncUrl = true) {
  const safeTab = VALID_TABS.includes(name) ? name : 'calendar';
  state.activeTab = safeTab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === safeTab));
  document.querySelectorAll('.panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById(`panel-${safeTab}`);
  if (panel) panel.style.display = '';
  if (safeTab === 'calendar') renderCalendar();
  if (syncUrl) syncUrlState();
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    setActiveTab(tab.dataset.tab, true);
  });
});

// ==================== CALENDAR ====================
function setCalView(v, syncUrl = true) {
  const safeView = VALID_VIEWS.includes(v) ? v : 'month';
  state.calView = safeView;
  document.querySelectorAll('[data-calview]').forEach(b => b.classList.toggle('active', b.dataset.calview === safeView));
  renderCalendar();
  if (syncUrl) syncUrlState();
}
function calNav(dir) {
  const d = state.calDate;
  if (state.calView === 'month') d.setMonth(d.getMonth() + dir);
  else if (state.calView === 'week') d.setDate(d.getDate() + dir * 7);
  else d.setDate(d.getDate() + dir);
  renderCalendar();
  syncUrlState();
}
function calToday() { state.calDate = new Date(); renderCalendar(); syncUrlState(); }

function slotsForDate(date) {
  const target = asDateOnly(date);
  return state.slots.filter(s => {
    const base = parseDMY(s.date);
    if (!base) return false;

    if (!isRecurringSlot(s)) return sameDay(base, target);

    const baseDay = asDateOnly(base);
    const till = parseDMY(s.recurring_till);
    const tillDay = till ? asDateOnly(till) : baseDay;
    if (target < baseDay || target > tillDay) return false;
    return target.getDay() === baseDay.getDay();
  }).sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time));
}

function classesForDate(date) {
  const target = asDateOnly(date);
  return state.classes.filter(c => sameDay(c.startDate, target));
}

function dayDisplayEvents(date) {
  const classEvents = classesForDate(date).map((ev, i) => ({
    key: `class-${ev.id}-${i}`,
    kind: 'class',
    source: ev,
    ref: ev.ref,
    start: timeToMin(ev.start_time),
    end: timeToMin(ev.end_time),
    start_time: ev.start_time,
    end_time: ev.end_time,
    title: ev.title,
    color: ev.color
  }));

  const slotEvents = slotsForDate(date).map((ev, i) => {
    const st = timeToMin(ev.start_time);
    const et = ev.end_time ? timeToMin(ev.end_time) : st + 60;
    return {
      key: `slot-${ev.id}-${i}-${ev.start_time || ''}`,
      kind: 'slot',
      source: ev,
      start: st,
      end: et > st ? et : st + 60,
      start_time: ev.start_time,
      end_time: ev.end_time || minutesToTime(st + 60),
      title: ev.client_name || typeName(ev.type_id),
      color: ''
    };
  });

  return [...classEvents, ...slotEvents].sort((a, b) => (a.start - b.start) || (a.end - b.end));
}

function withOverlapColumns(events) {
  if (!events.length) return [];
  const groups = [];
  let current = [];
  let currentMaxEnd = -1;

  events.forEach(ev => {
    if (!current.length || ev.start < currentMaxEnd) {
      current.push(ev);
      currentMaxEnd = Math.max(currentMaxEnd, ev.end);
      return;
    }
    groups.push(current);
    current = [ev];
    currentMaxEnd = ev.end;
  });
  if (current.length) groups.push(current);

  const laidOut = [];
  groups.forEach(group => {
    const colsEnd = [];
    const colByKey = {};
    group.forEach(ev => {
      let col = colsEnd.findIndex(endMin => endMin <= ev.start);
      if (col === -1) {
        col = colsEnd.length;
        colsEnd.push(ev.end);
      } else {
        colsEnd[col] = ev.end;
      }
      colByKey[ev.key] = col;
    });
    const cols = Math.max(colsEnd.length, 1);
    group.forEach(ev => laidOut.push({ ...ev, col: colByKey[ev.key], cols }));
  });
  return laidOut;
}

function getVisibleRange() {
  const d = state.calDate;
  if (state.calView === 'month') {
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from, to, key: `${isoDate(from)}|${isoDate(to)}` };
  }
  if (state.calView === 'week') {
    const from = weekStart(d);
    const to = new Date(from);
    to.setDate(to.getDate() + 6);
    return { from: asDateOnly(from), to: asDateOnly(to), key: `${isoDate(from)}|${isoDate(to)}` };
  }
  const single = asDateOnly(d);
  return { from: single, to: single, key: `${isoDate(single)}|${isoDate(single)}` };
}

function normalizeArboxClass(item) {
  const categoryNameLc = String(item.box_categories?.name || '').toLowerCase();
  const seriesNameLc = String(item.series?.series_name || '').toLowerCase();
  const hasLiveLink = !!String(item.live_link || '').trim();
  const isOnlineByName = categoryNameLc.includes('אונליין') || categoryNameLc.includes('online') || seriesNameLc.includes('אונליין') || seriesNameLc.includes('online');
  if (hasLiveLink || isOnlineByName) return null;

  const dateVal = item.date || '';
  const startTime = String(item.time || '').slice(0, 5);
  const endTimeRaw = String(item.end_time || '').slice(0, 5);
  if (!dateVal || !startTime) return null;
  const d = parseYMD(dateVal);
  if (!d) return null;
  const startMin = timeToMin(startTime);
  const endMin = endTimeRaw ? timeToMin(endTimeRaw) : (startMin + 60);
  const safeEnd = endMin > startMin ? endMin : startMin + 60;

  const startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(startMin / 60), startMin % 60);
  const endDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(safeEnd / 60), safeEnd % 60);
  const title = item.box_categories?.name || item.series?.series_name || item.coach?.full_name || 'שיעור';
  const color = item.box_categories?.category_color || '#c0dcfe';
  const coachName = item.coach?.full_name || '';
  const categoryName = item.box_categories?.name || '';
  const locationName = item.locations_box?.location || '';
  const registered = Number(item.registered || 0);
  const free = Number(item.free || 0);
  const maxUsers = Number(item.max_users || 0);
  const bookingOption = item.booking_option || '';
  const ref = `${item.id}|${dateVal}|${startTime}`;

  return {
    id: item.id,
    ref,
    date: fmtDate(startDate),
    start_time: minutesToTime(startMin),
    end_time: minutesToTime(safeEnd),
    startDate,
    endDate,
    title,
    color,
    coachName,
    categoryName,
    locationName,
    registered,
    free,
    maxUsers,
    bookingOption
  };
}

async function loadArboxClasses(range) {
  beginGlobalLoading();
  state.classesLoading = true;
  state.classesLoadingKey = range.key;
  state.classes = [];
  renderCalendar();

  try {
    const res = await fetch(ARBOX_SCHEDULE_API, {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'boxfk': '17885',
        'identifier': 'yogahouse',
        'lang': 'en',
        'newsite': '1',
        'referername': 'plugin',
        'whitelabel': 'Arbox'
      },
      body: JSON.stringify({
        from: isoDate(range.from),
        to: isoDate(range.to),
        locations_box_id: 14927
      })
    });
    const payload = await res.json();
    const items = Array.isArray(payload?.data) ? payload.data : [];
    state.classes = items.map(normalizeArboxClass).filter(Boolean);
    state.classesRangeKey = range.key;
  } catch (e) {
    state.classes = [];
    toast('שגיאה בטעינת שיעורים', 'error');
  } finally {
    state.classesLoading = false;
    state.classesLoadingKey = '';
    endGlobalLoading();
    renderCalendar();
  }
}

function ensureVisibleClassesLoaded() {
  const range = getVisibleRange();
  if (state.classesRangeKey === range.key) return range;
  if (state.classesLoading && state.classesLoadingKey === range.key) return range;
  loadArboxClasses(range);
  return range;
}

function renderCalendar() {
  const container = document.getElementById('cal-container');
  const titleEl = document.getElementById('cal-title');
  if (state.calView === 'month') renderMonthView(container, titleEl);
  else if (state.calView === 'week') renderWeekView(container, titleEl);
  else renderDayView(container, titleEl);
}

function calendarLoadingHtml() {
  return '<div class="loading cal-loading"><div class="spinner"></div>טוען יומן...</div>';
}

// ---- MONTH VIEW ----
function renderMonthView(container, titleEl) {
  const d = state.calDate;
  const year = d.getFullYear(), month = d.getMonth();
  titleEl.textContent = `${HEB_MONTHS[month]} ${year}`;
  const visibleRange = ensureVisibleClassesLoaded();
  const rangeLoading = state.classesLoading && state.classesLoadingKey === visibleRange.key;
  if (state.slotsLoading || rangeLoading) {
    container.innerHTML = calendarLoadingHtml();
    return;
  }

  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const today = new Date();
  const prevDays = new Date(year, month, 0).getDate();

  let html = '<div class="cal-month-grid">';
  for (let i = 0; i < 7; i++) html += `<div class="day-header">${HEB_DAYS[i]}</div>`;

  for (let i = 0; i < startOffset; i++) {
    html += `<div class="day-cell other-month"><div class="day-num">${prevDays - startOffset + i + 1}</div></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(year, month, day);
    const isToday = sameDay(cellDate, today);
    const events = slotsForDate(cellDate);
    const classEvents = classesForDate(cellDate);
    html += `<div class="day-cell${isToday?' today':''}" onclick="calDayClick('${fmtDate(cellDate)}')">`;
    html += `<div class="day-num">${day}</div>`;
    classEvents.slice(0, 2).forEach(ev => {
      html += `<div class="cal-event cal-class-event" title="${ev.title} (Arbox)" onclick="event.stopPropagation();openArboxClassModal('${ev.ref}')">${ev.start_time} ${ev.title} (Arbox)</div>`;
    });
    events.slice(0, 3).forEach(ev => {
      const t = ev.start_time || '';
      html += `<div class="cal-event ${tenantColor(ev.tenant_id)}" onclick="event.stopPropagation();openSlotModal(${ev.id})">${t} ${tenantName(ev.tenant_id)}</div>`;
    });
    const totalMore = Math.max(classEvents.length - 2, 0) + Math.max(events.length - 3, 0);
    if (totalMore > 0) html += `<div style="font-size:0.68rem;color:var(--text-secondary);padding:0 6px">+${totalMore} עוד</div>`;
    html += '</div>';
  }

  const totalCells = startOffset + daysInMonth;
  const remaining = (7 - totalCells % 7) % 7;
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="day-cell other-month"><div class="day-num">${i}</div></div>`;
  }

  html += '</div>';
  container.innerHTML = html;
}

// ---- WEEK VIEW ----
function renderWeekView(container, titleEl) {
  const ws = weekStart(state.calDate);
  const days = [];
  for (let i = 0; i < 7; i++) { const dd = new Date(ws); dd.setDate(dd.getDate()+i); days.push(dd); }
  titleEl.textContent = `${fmtDate(days[0])} — ${fmtDate(days[6])}`;
  const visibleRange = ensureVisibleClassesLoaded();
  const rangeLoading = state.classesLoading && state.classesLoadingKey === visibleRange.key;
  if (state.slotsLoading || rangeLoading) {
    container.innerHTML = calendarLoadingHtml();
    return;
  }
  renderTimeGrid(container, days);
}

// ---- DAY VIEW ----
function renderDayView(container, titleEl) {
  const d = state.calDate;
  titleEl.textContent = `יום ${HEB_DAYS[d.getDay()]} — ${fmtDate(d)}`;
  const visibleRange = ensureVisibleClassesLoaded();
  const rangeLoading = state.classesLoading && state.classesLoadingKey === visibleRange.key;
  if (state.slotsLoading || rangeLoading) {
    container.innerHTML = calendarLoadingHtml();
    return;
  }
  renderTimeGrid(container, [d]);
}

// ---- TIME GRID (week + day) ----
function renderTimeGrid(container, days) {
  const cols = days.length;
  const today = new Date();
  const hours = [];
  for (let h = HOUR_START; h <= HOUR_END; h++) hours.push(h);
  const cellH = 52;
  const dayLayouts = {};
  days.forEach(d => {
    dayLayouts[fmtDate(d)] = withOverlapColumns(dayDisplayEvents(d));
  });

  let html = '<div class="cal-time-grid">';

  // Header
  html += `<div class="tg-header" style="grid-template-columns:50px repeat(${cols}, 1fr)">`;
  html += '<div class="tg-header-cell" style="border-inline-start:none"></div>';
  days.forEach(d => {
    const isToday = sameDay(d, today);
    html += `<div class="tg-header-cell${isToday?' today-col':''}">יום ${HEB_DAYS[d.getDay()]}<br>${d.getDate()}/${d.getMonth()+1}</div>`;
  });
  html += '</div>';

  // Body
  html += `<div class="tg-body" style="grid-template-columns:50px repeat(${cols}, 1fr)">`;
  hours.forEach(h => {
    html += `<div class="tg-time-label">${String(h).padStart(2,'0')}:00</div>`;
    days.forEach(d => {
      const isToday = sameDay(d, today);
      const dateStr = fmtDate(d);
      html += `<div class="tg-cell${isToday?' today-col':''}" onclick="calCellClick('${dateStr}','${String(h).padStart(2,'0')}:00')">`;

      // Events starting in this hour
      (dayLayouts[dateStr] || []).filter(ev => Math.floor(ev.start / 60) === h).forEach(ev => {
        const st = ev.start;
        const et = ev.end;
        const topOff = (st % 60) / 60 * cellH;
        const height = Math.max(((et - st) / 60) * cellH, 22);
        const widthPct = 100 / ev.cols;
        const leftPct = ev.col * widthPct;
        const baseStyle = `top:${topOff}px;height:${height}px;right:auto;left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 4px)`;
        const classWidthPct = ev.cols === 1 ? widthPct * 0.7 : widthPct;
        const classStyle = `top:${topOff}px;height:${height}px;right:auto;left:calc(${leftPct}% + 2px);width:calc(${classWidthPct}% - 4px)`;
        if (ev.kind === 'class') {
          html += `<div class="tg-event tg-class-event" style="${classStyle}" title="${ev.title} (Arbox)" onclick="event.stopPropagation();openArboxClassModal('${ev.ref}')">`;
          html += `<span class="ev-time">${ev.start_time}–${ev.end_time}</span>`;
          html += `<span class="ev-name"> ${ev.title} (Arbox)</span>`;
        } else {
          html += `<div class="tg-event ${tenantColor(ev.source.tenant_id)}" style="${baseStyle}" onclick="event.stopPropagation();openSlotModal(${ev.source.id})">`;
          html += `<span class="ev-time">${ev.source.start_time}–${ev.source.end_time||''}</span>`;
          html += `<span class="ev-name"> ${tenantName(ev.source.tenant_id)}</span>`;
        }
        html += '</div>';
      });

      html += '</div>';
    });
  });
  html += '</div></div>';
  container.innerHTML = html;
}

function calDayClick(dateStr) {
  const p = dateStr.split('/');
  state.calDate = new Date(Number(p[2]), Number(p[1])-1, Number(p[0]));
  setCalView('day');
}
function calCellClick(dateStr, time) {
  openSlotModal(null, dateStr, time);
}

// ==================== MODALS ====================
function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function openArboxClassModal(ref) {
  const cls = state.classes.find(c => c.ref === ref);
  if (!cls) {
    toast('פרטי השיעור לא נמצאו', 'error');
    return;
  }
  openModal(`
    <h3>פרטי שיעור (Arbox)</h3>
    <div class="form-group"><label>שיעור</label><div>${cls.categoryName || cls.title}</div></div>
    <div class="form-group"><label>תאריך</label><div>${cls.date}</div></div>
    <div class="form-group"><label>שעה</label><div>${cls.start_time} - ${cls.end_time}</div></div>
    <div class="form-group"><label>מדריך/ה</label><div>${cls.coachName || '—'}</div></div>
    <div class="form-group"><label>מיקום</label><div>${cls.locationName || '—'}</div></div>
    <div class="form-group"><label>תפוסה</label><div>${cls.registered}/${cls.maxUsers || (cls.registered + cls.free) || '—'}</div></div>
    <div class="form-group"><label>סטטוס</label><div>${cls.bookingOption || '—'}</div></div>
    <p style="margin-top:10px;color:var(--text-secondary);font-size:0.85rem">אירוע מתצוגת Arbox בלבד, לא ניתן לעריכה כאן.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">סגור</button>
    </div>
  `);
}

function setModalSaving(isSaving, loadingText = 'שומר...') {
  const actions = document.querySelector('.modal-actions');
  if (!actions) return;
  const primary = actions.querySelector('.btn-primary');
  const buttons = actions.querySelectorAll('button');
  buttons.forEach(btn => { btn.disabled = !!isSaving; });
  if (!primary) return;

  if (isSaving) {
    if (!primary.dataset.originalHtml) primary.dataset.originalHtml = primary.innerHTML;
    primary.innerHTML = `<span class="btn-spinner"></span>${loadingText}`;
  } else if (primary.dataset.originalHtml) {
    primary.innerHTML = primary.dataset.originalHtml;
    delete primary.dataset.originalHtml;
  }
}

// -- SLOT MODAL --
function openSlotModal(editId, prefillDate, prefillTime) {
  const slot = editId ? state.slots.find(s => Number(s.id)===Number(editId)) : null;
  const isEdit = !!slot;

  const dateVal = slot ? toInputDate(slot.date) : (prefillDate ? toInputDate(prefillDate) : '');
  const startVal = slot ? (slot.start_time||'') : (prefillTime||'');
  const endVal = slot ? (slot.end_time||'') : (startVal ? addMinutesToTime(startVal, 60) : '');
  const recurringVal = isRecurringSlot(slot);
  const recurringTillVal = slot ? toInputDate(slot.recurring_till || '') : '';

  const tenantOpts = state.tenants.map(t =>
    `<option value="${t.id}" ${slot&&Number(slot.tenant_id)===Number(t.id)?'selected':''}>${t.name}</option>`
  ).join('');
  const typeOpts = state.types.map(t =>
    `<option value="${t.id}" ${slot&&Number(slot.type_id)===Number(t.id)?'selected':''}>${t.name}</option>`
  ).join('');

  openModal(`
    <h3>${isEdit?'עריכת תור':'תור חדש'}</h3>
    <div class="form-group">
      <label>תאריך</label>
      <input type="date" id="f-date" value="${dateVal}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>שעת התחלה</label>
        <input type="time" id="f-start" value="${startVal}" lang="en-GB" step="60" onchange="onSlotStartTimeChange()">
      </div>
      <div class="form-group">
        <label>שעת סיום</label>
        <input type="time" id="f-end" value="${endVal}" lang="en-GB" step="60">
      </div>
    </div>
    <div class="form-group">
      <label>מטפל</label>
      <select id="f-tenant" onchange="onSlotTenantChange()"><option value="">בחר...</option>${tenantOpts}</select>
    </div>
    <div class="form-group">
      <label>סוג טיפול</label>
      <select id="f-type"><option value="">בחר...</option>${typeOpts}</select>
    </div>
    <div class="form-group">
      <label>שם לקוח</label>
      <input type="text" id="f-client" value="${slot?slot.client_name||'':''}" placeholder="שם הלקוח">
    </div>
    <div class="form-group">
      <label class="checkbox-item" style="border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-hover)">
        <input type="checkbox" id="f-recurring" ${recurringVal ? 'checked' : ''} onchange="toggleRecurringTill()">
        <span class="cb-label">אירוע חוזר (שבועי)</span>
      </label>
    </div>
    <div class="form-group" id="f-recurring-till-wrap" style="display:${recurringVal ? 'block' : 'none'}">
      <label>חוזר עד</label>
      <input type="date" id="f-recurring-till" value="${recurringTillVal}">
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="saveSlot(${editId||'null'})">${isEdit?'שמור':'הוסף'}</button>
      <button class="btn btn-ghost" onclick="closeModal()">ביטול</button>
      ${isEdit ? `<button class="btn btn-danger" style="margin-inline-start:auto" onclick="closeModal();confirmDelete('slots',${editId})">מחק</button>` : ''}
    </div>
  `);
}

function onSlotTenantChange() {
  const tenantId = Number(document.getElementById('f-tenant')?.value || 0);
  const typeSelect = document.getElementById('f-type');
  if (!tenantId || !typeSelect) return;
  const tenant = state.tenants.find(t => Number(t.id) === tenantId);
  if (!tenant) return;
  const firstTypeId = String(tenant.types || '')
    .split(',')
    .map(v => Number(String(v).trim()))
    .find(v => Number.isFinite(v) && v > 0);
  if (!firstTypeId) return;
  typeSelect.value = String(firstTypeId);
}

function onSlotStartTimeChange() {
  const startInput = document.getElementById('f-start');
  const endInput = document.getElementById('f-end');
  if (!startInput || !endInput || !startInput.value) return;
  endInput.value = addMinutesToTime(startInput.value, 60);
}

function toggleRecurringTill() {
  const recurring = document.getElementById('f-recurring')?.checked;
  const wrap = document.getElementById('f-recurring-till-wrap');
  if (!wrap) return;
  wrap.style.display = recurring ? 'block' : 'none';
}

function slotDatesToCheck(data) {
  const first = parseDMY(data.date);
  if (!first) return [];
  const dates = [asDateOnly(first)];
  if (!data.is_recurring) return dates;
  const till = parseDMY(data.recurring_till);
  if (!till) return dates;
  let cursor = new Date(first);
  cursor.setDate(cursor.getDate() + 7);
  while (asDateOnly(cursor) <= asDateOnly(till)) {
    dates.push(asDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return dates;
}

async function saveSlot(editId) {
  const recurring = document.getElementById('f-recurring')?.checked;
  const recurringTillIso = document.getElementById('f-recurring-till')?.value || '';
  const data = {
    date: fromInputDate(document.getElementById('f-date').value),
    start_time: document.getElementById('f-start').value,
    end_time: document.getElementById('f-end').value,
    tenant_id: Number(document.getElementById('f-tenant').value),
    type_id: Number(document.getElementById('f-type').value),
    client_name: document.getElementById('f-client').value.trim(),
    is_recurring: !!recurring,
    recurring_till: recurring ? fromInputDate(recurringTillIso) : ''
  };
  if (!data.date || !data.start_time || !data.tenant_id || !data.type_id) {
    toast('נא למלא תאריך, שעת התחלה, מטפל וסוג','error'); return;
  }
  if (data.end_time && timeToMin(data.start_time) >= timeToMin(data.end_time)) {
    toast('שעת ההתחלה חייבת להיות מוקדמת משעת הסיום','error'); return;
  }
  if (!tenantSupportsType(data.tenant_id, data.type_id)) {
    toast('סוג הטיפול לא תואם לסוגי הטיפול של המטפל','error'); return;
  }
  if (data.is_recurring && !data.recurring_till) {
    toast('נא לבחור תאריך סיום לחזרתיות','error'); return;
  }
  if (data.is_recurring) {
    const startDate = parseDMY(data.date);
    const tillDate = parseDMY(data.recurring_till);
    if (!startDate || !tillDate || asDateOnly(tillDate) <= asDateOnly(startDate)) {
      toast('תאריך "חוזר עד" חייב להיות מאוחר מתאריך התור','error'); return;
    }
  }

  const newStart = timeToMin(data.start_time);
  const newEnd = data.end_time ? timeToMin(data.end_time) : newStart + 60;
  const dates = slotDatesToCheck(data);
  let overlapsClass = false;
  let overlapsSlot = false;

  dates.forEach(dt => {
    if (overlapsClass || overlapsSlot) return;
    overlapsClass = classesForDate(dt).some(c =>
      overlaps(newStart, newEnd, timeToMin(c.start_time), timeToMin(c.end_time))
    );
    overlapsSlot = slotsForDate(dt)
      .filter(s => Number(s.id) !== Number(editId))
      .some(s => overlaps(
        newStart,
        newEnd,
        timeToMin(s.start_time),
        s.end_time ? timeToMin(s.end_time) : timeToMin(s.start_time) + 60
      ));
  });

  if (overlapsClass && !window.confirm('האם אתה בטוח שברצונך לקבוע תור בזמן של שיעור?')) return;
  if (overlapsSlot && !window.confirm('האם אתה בטוח שברצונך לקבוע תור בזמן של תור אחר?')) return;

  setModalSaving(true);
  try {
    if (editId) { await apiPost('update','slots',data,editId); toast('התור עודכן','success'); }
    else { await apiPost('add','slots',data); toast('התור נוסף','success'); }
    closeModal(); await loadAll();
  } catch(e) {
  } finally {
    setModalSaving(false);
  }
}

// -- TENANT MODAL (FIXED CHECKBOXES) --
function openTenantModal(editId) {
  const tenant = editId ? state.tenants.find(t => Number(t.id)===Number(editId)) : null;
  const isEdit = !!tenant;
  const sel = tenant ? String(tenant.types).split(',').map(s=>s.trim()) : [];

  const typeChecks = state.types.map(t => `
    <label class="checkbox-item">
      <input type="checkbox" class="type-check" value="${t.id}" ${sel.includes(String(t.id))?'checked':''}>
      <span class="cb-label">${t.name}</span>
    </label>
  `).join('');

  openModal(`
    <h3>${isEdit?'עריכת מטפל':'מטפל חדש'}</h3>
    <div class="form-group">
      <label>שם</label>
      <input type="text" id="f-name" value="${tenant?tenant.name:''}" placeholder="שם המטפל">
    </div>
    <div class="form-group">
      <label>אימייל</label>
      <input type="email" id="f-email" dir="ltr" value="${tenant?tenant.email||'':''}" placeholder="email@example.com">
    </div>
    <div class="form-group">
      <label>סוגי טיפול</label>
      <div class="checkbox-list">${typeChecks || '<div style="padding:12px;color:var(--text-secondary)">אין סוגי טיפול במערכת</div>'}</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="saveTenant(${editId||'null'})">${isEdit?'שמור':'הוסף'}</button>
      <button class="btn btn-ghost" onclick="closeModal()">ביטול</button>
    </div>
  `);
}

async function saveTenant(editId) {
  const types = [...document.querySelectorAll('.type-check:checked')].map(c=>c.value).join(',');
  const data = {
    name: document.getElementById('f-name').value.trim(),
    email: document.getElementById('f-email').value.trim(),
    types
  };
  if (!data.name) { toast('נא להזין שם','error'); return; }
  setModalSaving(true);
  try {
    if (editId) { await apiPost('update','tenants',data,editId); toast('המטפל עודכן','success'); }
    else { await apiPost('add','tenants',data); toast('המטפל נוסף','success'); }
    closeModal(); await loadAll();
  } catch(e) {
  } finally {
    setModalSaving(false);
  }
}

// -- TYPE MODAL --
function openTypeModal(editId) {
  const type = editId ? state.types.find(t => Number(t.id)===Number(editId)) : null;
  const isEdit = !!type;
  openModal(`
    <h3>${isEdit?'עריכת סוג טיפול':'סוג טיפול חדש'}</h3>
    <div class="form-group">
      <label>שם</label>
      <input type="text" id="f-tname" value="${type?type.name:''}" placeholder="שם סוג הטיפול">
    </div>
    <div class="form-group">
      <label class="checkbox-item" style="border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-hover)">
        <input type="checkbox" id="f-class" ${type&&type.class_among_can?'checked':''}>
        <span class="cb-label">שיעור קבוצתי (class)</span>
      </label>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="saveType(${editId||'null'})">${isEdit?'שמור':'הוסף'}</button>
      <button class="btn btn-ghost" onclick="closeModal()">ביטול</button>
    </div>
  `);
}

async function saveType(editId) {
  const data = {
    name: document.getElementById('f-tname').value.trim(),
    class_among_can: document.getElementById('f-class').checked
  };
  if (!data.name) { toast('נא להזין שם','error'); return; }
  setModalSaving(true);
  try {
    if (editId) { await apiPost('update','types',data,editId); toast('סוג הטיפול עודכן','success'); }
    else { await apiPost('add','types',data); toast('סוג הטיפול נוסף','success'); }
    closeModal(); await loadAll();
  } catch(e) {
  } finally {
    setModalSaving(false);
  }
}

// ==================== DELETE ====================
function confirmDelete(entity, id) {
  const labels = { slots:'תור', tenants:'מטפל', types:'סוג טיפול' };
  openModal(`
    <h3>מחיקת ${labels[entity]}</h3>
    <p style="margin-bottom:20px;color:var(--text-secondary)">האם למחוק? פעולה זו אינה ניתנת לביטול.</p>
    <div class="modal-actions">
      <button class="btn btn-primary" style="background:var(--danger)" onclick="doDelete('${entity}',${id})">מחק</button>
      <button class="btn btn-ghost" onclick="closeModal()">ביטול</button>
    </div>
  `);
}
async function doDelete(entity, id) {
  try {
    await apiPost('delete',entity,{},id);
    toast('נמחק בהצלחה','success');
    closeModal(); await loadAll();
  } catch(e){}
}

// ==================== TOAST ====================
function toast(msg, type='') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ==================== INIT ====================
applyStateFromUrl();
setCalView(state.calView, false);
setActiveTab(state.activeTab, false);
syncUrlState();
loadAll();
