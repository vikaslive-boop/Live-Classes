// ─────────────────────────────────────────────────────────────
// DBMCI One · dashboard
// ─────────────────────────────────────────────────────────────
import * as D from './data.js';
import * as FB from '../firebase.js';
import { $, $$, esc, fmt, icon, hydrateIcons, toast, confirmDialog, fillSelect, initials, isDark, toggleTheme, purgeLegacyStorage } from './ui.js';
import * as C from './charts.js';

const { DEFAULT_FACULTY } = D;

const INACTIVITY_MS = 30 * 60 * 1000;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

const S = {
  me: null,
  page: 'attendance',
  sheets: { attendance: null, issues: null, ratings: null },
  errors: {},
  loadedAt: null,
  att: { course: null, subjects: [], cycle: 'All', faculty: 'all', from: '', to: '', flCycle: null },
  iss: { course: 'all', cycle: 'all', faculty: 'all', category: 'all', place: 'all', from: '', to: '', view: 'monthly', sort: null, dir: 1, q: '', pageSize: 25, pageNo: 0, rows: [] },
  rat: { course: null, subject: 'all', faculty: 'all', cycle: 'all', from: '', to: '' },
  shots: [],
  facultyList: null,
  adminOptions: {},
  wall: { q: '', course: 'all', cycle: 'all', day: 'all' },
  viewer: { list: [], i: 0, faculty: null },
  studio: { selected: new Set() },
  upload: { files: [] },
};

const isAdmin = () => ['admin', 'superadmin'].includes(S.me?.role);
const isSuper = () => S.me?.role === 'superadmin';

// ═════════════════════════════════════════════════════════════
// BOOT
// ═════════════════════════════════════════════════════════════
boot();

async function boot() {
  purgeLegacyStorage();
  S.me = await FB.requireMember();
  hydrateIcons();
  setupShell();
  document.getElementById('app').classList.remove('booting');
  route();
  loadSheets();
  startPhotoSync();
  startInactivityTimer();
}

function setupShell() {
  $('#who-email').textContent = S.me.name || S.me.email;
  $('#who-email').title = S.me.email;
  $('#who-role').textContent = { superadmin: 'Super admin', admin: 'Admin', viewer: 'Viewer' }[S.me.role];
  const av = $('#who-avatar');
  av.textContent = initials(S.me.name || S.me.email.split('@')[0].replace(/[._-]/g, ' '));
  if (S.me.photo) {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.alt = '';
    img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover';
    img.onload = () => { av.textContent = ''; av.append(img); };
    img.src = S.me.photo;
  }
  $('#today').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (isAdmin()) { $('#nav-admin').classList.remove('hidden'); $('#open-upload').classList.remove('hidden'); }
  if (!isSuper()) { $('#members-card').classList.add('hidden'); $('#logs-card').classList.add('hidden'); }

  window.addEventListener('hashchange', route);
  $('#nav-toggle').addEventListener('click', () => $('#app').classList.toggle('nav-open'));
  $('#app').addEventListener('click', e => {
    if ($('#app').classList.contains('nav-open') && !e.target.closest('.side') && !e.target.closest('#nav-toggle')) $('#app').classList.remove('nav-open');
  });
  $$('.nav a').forEach(a => a.addEventListener('click', () => $('#app').classList.remove('nav-open')));

  paintThemeButton();
  $('#theme-btn').addEventListener('click', () => { toggleTheme(); paintThemeButton(); renderPage(); });
  $('#signout-btn').addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Sign out of DBMCI One?', confirm: 'Sign out' }))) return;
    await FB.signOutUser();
    location.replace('login.html');
  });
  $$('[data-refresh]').forEach(b => b.addEventListener('click', () => loadSheets(true)));

  setupAttendanceControls();
  setupIssuesControls();
  setupRatingControls();
  setupWall();
  setupViewer();
  setupStudio();
  setupUpload();
  setupAdmin();
}

function paintThemeButton() {
  const dark = isDark();
  $('#theme-ico').innerHTML = icon(dark ? 'sun' : 'moon', 16);
  $('#theme-label').textContent = dark ? 'Light' : 'Dark';
}

function route() {
  let page = (location.hash || '#attendance').slice(1);
  if (!['attendance', 'issues', 'ratings', 'wall', 'admin'].includes(page)) page = 'attendance';
  if (page === 'admin' && !isAdmin()) page = 'attendance';
  S.page = page;
  $$('.page').forEach(p => { p.hidden = p.id !== `page-${page}`; });
  $$('.nav a[data-page]').forEach(a => { if (a.dataset.page === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
  renderPage();
  enter($(`#page-${page}`));
}

// Cards rise in one after another when a page opens.
function enter(pageEl) {
  if (!pageEl) return;
  $$('.filters, .kpis, .card, .wall > *', pageEl).forEach((el, i) => el.style.setProperty('--i', Math.min(i, 12)));
  pageEl.classList.remove('enter'); void pageEl.offsetWidth; pageEl.classList.add('enter');
  $$('.tabs', pageEl).forEach(moveInk);
}

function renderPage() {
  C.destroyAll();
  if (S.page === 'attendance') renderAttendance();
  if (S.page === 'issues') renderIssues();
  if (S.page === 'ratings') renderRatings();
  if (S.page === 'wall') renderWall();
  if (S.page === 'admin') renderAdmin();
}

// ── Sheets ───────────────────────────────────────────────────
async function loadSheets(manual = false) {
  const names = ['attendance', 'issues', 'ratings'];
  const btns = $$('[data-refresh]');
  btns.forEach(b => (b.disabled = true));
  await Promise.all(names.map(async n => {
    try { S.sheets[n] = await D.fetchSheet(n); delete S.errors[n]; }
    catch (e) { S.errors[n] = e.message || 'Could not load the sheet'; if (!S.sheets[n]) S.sheets[n] = null; }
  }));
  S.loadedAt = new Date();
  const stamp = `Updated ${S.loadedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  names.forEach(n => { const el = $(`#stamp-${n}`); if (el) el.textContent = stamp; });
  btns.forEach(b => (b.disabled = false));
  if (manual) toast(Object.keys(S.errors).length ? 'Some sheets could not be loaded' : 'Data refreshed', Object.keys(S.errors).length ? 'error' : 'success');
  prepareFilters();
  renderPage();
}

const ALL = { value: 'all', label: 'All' };

function prepareFilters() {
  const att = S.sheets.attendance || [];
  const courses = D.inSheetOrder(att, 'Course');
  const saved = store.get('dbmci-att-course');
  if (!courses.includes(S.att.course)) S.att.course = courses.includes(saved) ? saved : courses[0] || null;
  renderCourseTabs('#att-courses', courses, S.att.course, c => {
    S.att.course = c; store.set('dbmci-att-course', c);
    Object.assign(S.att, { subjects: [], cycle: 'All', faculty: 'all', flCycle: null });
    prepareAttendanceFilters(); renderAttendance();
  });
  prepareAttendanceFilters();

  const iss = D.validIssues(S.sheets.issues || []);
  const opt = key => D.uniq(iss.map(r => D.clean(r[key])).filter(v => !D.isUnknown(v))).sort();
  fillSelect($('#iss-course'), opt('Course'), { all: ALL });
  fillSelect($('#iss-cycle'), D.cyclesOf(iss), { all: ALL });
  fillSelect($('#iss-faculty'), opt('Faculty'), { all: ALL });
  fillSelect($('#iss-category'), opt('Category'), { all: ALL });
  fillSelect($('#iss-place'), opt('Place'), { all: ALL });

  const rat = S.sheets.ratings || [];
  const rc = D.inSheetOrder(rat, 'Course');
  if (!rc.includes(S.rat.course)) S.rat.course = rc[0] || null;
  renderCourseTabs('#rat-courses', rc, S.rat.course, c => {
    Object.assign(S.rat, { course: c, subject: 'all', faculty: 'all', cycle: 'all' });
    prepareRatingFilters(); renderRatings();
  });
  prepareRatingFilters();

  prepareWallFilters();
}

function renderCourseTabs(sel, courses, active, onPick) {
  const box = $(sel);
  box.innerHTML = courses.map(c => `<button class="tab" role="tab" aria-selected="${c === active}" data-c="${esc(c)}">${esc(c)}</button>`).join('') + '<span class="tab-ink"></span>';
  box.onclick = e => {
    const b = e.target.closest('.tab'); if (!b) return;
    $$('.tab', box).forEach(t => t.setAttribute('aria-selected', t === b));
    moveInk(box);
    onPick(b.dataset.c);
  };
  requestAnimationFrame(() => moveInk(box));
}
function moveInk(box) {
  const on = $('.tab[aria-selected="true"]', box), ink = $('.tab-ink', box);
  if (!on || !ink) return;
  ink.style.left = `${on.offsetLeft + 12}px`;
  ink.style.width = `${on.offsetWidth - 24}px`;
}
window.addEventListener('resize', () => $$('.tabs').forEach(moveInk));

function sheetProblem(name, container) {
  if (S.errors[name] && !S.sheets[name]) {
    container.innerHTML = `<div class="notice error" style="grid-column:1/-1">${esc(S.errors[name])}. Check your connection and press Refresh.</div>`;
    return true;
  }
  if (!S.sheets[name]) {
    container.innerHTML = Array.from({ length: +getComputedStyle(container).getPropertyValue('--n') || 4 }, () =>
      `<div class="kpi"><div class="skel" style="height:12px;width:60%"></div><div class="skel" style="height:28px;width:70%;margin-top:12px"></div></div>`).join('');
    return true;
  }
  return false;
}

function emptyChart(canvasId, title, text = '') {
  const box = $(`#${canvasId}`).parentElement;
  $(`#${canvasId}`).style.display = 'none';
  box.querySelector('.empty')?.remove();
  box.insertAdjacentHTML('beforeend', `<div class="empty"><div><b>${esc(title)}</b>${esc(text)}</div></div>`);
}
function showChart(canvasId) {
  const c = $(`#${canvasId}`);
  c.style.display = '';
  c.parentElement.querySelector('.empty')?.remove();
  return c;
}
const emptyBlock = (el, title) => { el.innerHTML = `<div class="empty"><div><b>${esc(title)}</b></div></div>`; };

// A number that counts up when shown.
const num = (n, dec = 0, suffix = '') =>
  `<span data-count="${n}" data-dec="${dec}">${Number(n).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })}</span>${suffix ? `<small>${suffix}</small>` : ''}`;

const kpi = (label, value, meta = '', feature = false, ringFraction = null) => {
  const plain = String(value).replace(/<[^>]+>/g, '');
  const valueHtml = `<div class="kpi-value${/^[\d—.]/.test(plain) ? '' : ' is-text'}" title="${esc(plain)}">${value}</div>`;
  return `<div class="kpi${feature ? ' is-feature' : ''}"><div class="kpi-label">${esc(label)}</div>${
    ringFraction !== null ? `<div class="kpi-row">${C.ring(ringFraction)}${valueHtml}</div>` : valueHtml
  }${meta ? `<div class="kpi-meta" title="${esc(meta)}">${esc(meta)}</div>` : ''}</div>`;
};
function playKpis(el) { C.countUp(el); C.playRings(el); }

// ═════════════════════════════════════════════════════════════
// ATTENDANCE
// ═════════════════════════════════════════════════════════════
function setupAttendanceControls() {
  const multi = $('#att-subjects');
  const btn = $('.multi-btn', multi), pop = $('.multi-pop', multi);
  const close = () => { pop.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', () => { pop.classList.toggle('hidden'); btn.setAttribute('aria-expanded', String(!pop.classList.contains('hidden'))); });
  document.addEventListener('click', e => { if (!multi.contains(e.target)) close(); });
  pop.addEventListener('change', () => {
    S.att.subjects = $$('input:checked', pop).map(i => i.value);
    paintSubjectButton(); renderAttendance();
  });
  $('[data-act="clear"]', pop).addEventListener('click', () => { $$('input', pop).forEach(i => (i.checked = false)); S.att.subjects = []; paintSubjectButton(); renderAttendance(); });
  $('[data-act="done"]', pop).addEventListener('click', close);

  $('#att-cycle').addEventListener('change', e => { S.att.cycle = e.target.value; if (e.target.value === 'All') S.att.flCycle = null; renderAttendance(); });
  $('#att-faculty').addEventListener('change', e => { S.att.faculty = e.target.value; renderAttendance(); });
  $('#fl-cycle').addEventListener('change', e => { S.att.flCycle = e.target.value; renderAttendance(); });
  $('#att-from').addEventListener('change', e => { S.att.from = e.target.value; renderAttendance(); });
  $('#att-to').addEventListener('change', e => { S.att.to = e.target.value; renderAttendance(); });
  $('#att-reset').addEventListener('click', () => {
    Object.assign(S.att, { subjects: [], cycle: 'All', faculty: 'all', from: '', to: '', flCycle: null });
    $('#att-from').value = ''; $('#att-to').value = '';
    prepareAttendanceFilters(); renderAttendance();
  });
}

function paintSubjectButton() {
  const n = S.att.subjects.length;
  $('#att-subjects .multi-btn span').textContent = n === 0 ? 'All subjects' : n === 1 ? S.att.subjects[0] : `${n} subjects`;
}

function prepareAttendanceFilters() {
  const all = S.sheets.attendance || [];
  const rows = all.filter(r => D.clean(r.Course) === S.att.course);
  const subjects = D.uniq(rows.map(r => r.Subject)).sort();
  S.att.subjects = S.att.subjects.filter(s => subjects.includes(s));
  $('#att-subjects .multi-list').innerHTML = subjects.map(s =>
    `<label class="check"><input type="checkbox" value="${esc(s)}" ${S.att.subjects.includes(s) ? 'checked' : ''}>${esc(s)}</label>`).join('') ||
    '<div class="muted" style="padding:8px">No subjects yet</div>';
  paintSubjectButton();
  const cycles = D.cyclesOf(rows);
  fillSelect($('#att-cycle'), cycles, { all: { value: 'All', label: 'All' } });
  if (!cycles.includes(S.att.cycle)) S.att.cycle = 'All';
  $('#att-cycle').value = S.att.cycle;
  // Faculty filter only appears when the attendance sheet has a Faculty column.
  const hasFac = D.hasColumn(all, 'Faculty');
  $('#att-faculty-field').classList.toggle('hidden', !hasFac);
  const facs = D.uniq(rows.map(r => D.clean(r.Faculty)).filter(f => !D.isUnknown(f))).sort();
  fillSelect($('#att-faculty'), facs, { all: ALL });
  S.att.faculty ||= 'all';
  if (S.att.faculty !== 'all' && !facs.includes(S.att.faculty)) S.att.faculty = 'all';
  $('#att-faculty').value = S.att.faculty;
}

function renderAttendance() {
  if (S.page !== 'attendance') return;
  const kpis = $('#att-kpis');
  if (sheetProblem('attendance', kpis)) return;
  const all = S.sheets.attendance;
  const parts = D.partColumns(all);
  const data = D.filterAttendance(all, S.att);
  const k = D.attendanceKPIs(data, parts);

  let ret;
  if (k.multiDay) ret = kpi('Retention', num(k.retention, 1, '%'), 'Last day vs Day 1', true, k.retention / 100);
  else if (k.singlePart) ret = kpi('Retention', 'Single part', 'One part per class', true);
  else ret = kpi('Avg drop-off', num(k.drop, 1, '%'), 'Single-day course', true, k.drop / 100);

  kpis.innerHTML = [
    ret,
    kpi('Classes', num(k.sessions), S.att.cycle !== 'All' ? S.att.cycle : `${D.cyclesOf(data).length} cycles`),
    kpi('Peak', k.peak ? num(k.peak) : '—', k.peak ? k.peakSubject : ''),
    kpi('Drop-off', k.singlePart ? 'Single part' : num(k.drop, 1, '%'), 'First → last part'),
    kpi('Polls', num(k.totalPolls), ''),
  ].join('');
  playKpis(kpis);

  const hmRet = $('#hm-retention'), hmDrop = $('#hm-drop');
  if (!data.length) {
    ['ch-firstlast', 'ch-journey', 'ch-polls'].forEach(id => emptyChart(id, 'No classes match'));
    emptyBlock(hmRet, 'No classes match'); emptyBlock(hmDrop, 'No classes match');
    return;
  }

  // Day 1 → last day: one cycle at a time (latest by default).
  const dataCycles = D.cyclesOf(data);
  const flSel = $('#fl-cycle');
  fillSelect(flSel, dataCycles, { all: { value: 'All', label: 'All cycles' } });
  if (S.att.cycle !== 'All') S.att.flCycle = S.att.cycle;
  if (!S.att.flCycle || (S.att.flCycle !== 'All' && !dataCycles.includes(S.att.flCycle))) S.att.flCycle = dataCycles[dataCycles.length - 1] || 'All';
  flSel.value = S.att.flCycle;
  flSel.disabled = S.att.cycle !== 'All';
  const fl = D.firstVsLast(data, S.att.flCycle);
  if (fl.labels.length) C.dumbbellChart('firstlast', showChart('ch-firstlast'), { labels: fl.labels, first: fl.first, last: fl.last });
  else emptyChart('ch-firstlast', 'Needs Day 1 and a later day');

  // Inside a class: Part A → B → C …
  const j = D.classJourney(data, parts);
  if (j.length > 1) {
    const base = j[0].avg;
    C.lineChart('journey', showChart('ch-journey'), {
      labels: j.map(p => p.part), series: [{ label: 'Average attendance', data: j.map(p => Math.round(p.avg)), color: C.seriesColor(0) }],
      fill: true, curve: 0.35, yFormat: v => Number(v).toLocaleString('en-IN'),
      tooltipFormat: v => `${Number(v).toLocaleString('en-IN')} (${Math.round((v / base) * 100)}% of Part A)`,
    });
    const ch = Chart.getChart('ch-journey');
    ch.data.datasets[0].datalabels.formatter = (v, ctx) => (ctx.dataIndex === 0 ? Number(v).toLocaleString('en-IN') : `${Number(v).toLocaleString('en-IN')} · ${Math.round((v / base) * 100)}%`);
    ch.update('none');
  } else emptyChart('ch-journey', 'Single part classes');

  // Polls
  const polls = D.pollsBySubject(data);
  if (polls.length) {
    $('#polls-card').classList.remove('hidden');
    $('#polls-total').textContent = `${fmt(polls.reduce((s, [, v]) => s + v, 0))} total`;
    C.barChart('polls', showChart('ch-polls'), { labels: polls.map(p => p[0]), data: polls.map(p => p[1]), label: 'Polls', color: C.seriesColor(2) });
  } else $('#polls-card').classList.add('hidden');

  // Heatmaps: subject × cycle
  const rt = D.retentionBySubject(data);
  if (rt.subjects.length) {
    C.heatmap(hmRet, {
      rows: rt.subjects, cols: rt.cycles, cells: rt.subjects.map((_, i) => rt.cycles.map(c => rt.series[c][i])),
      summary: { label: 'Avg', values: rt.avg.map(v => v || null) }, format: v => `${Number(v).toFixed(1)}%`, ramp: 'blue', rowLabel: 'Subject',
    });
  } else emptyBlock(hmRet, 'Needs Day 1 and a later day');

  const dt = D.dropTrend(data, parts);
  if (dt.subjects.length) {
    const rowAvg = dt.subjects.map((_, i) => { const v = dt.cycles.map(c => dt.series[c][i]).filter(x => x !== null); return v.length ? D.average(v) : null; });
    C.heatmap(hmDrop, {
      rows: dt.subjects, cols: dt.cycles, cells: dt.subjects.map((_, i) => dt.cycles.map(c => dt.series[c][i])),
      summary: { label: 'Avg', values: rowAvg }, format: v => `${Number(v).toFixed(1)}%`, ramp: 'orange', rowLabel: 'Subject', higherIsBetter: false,
    });
  } else emptyBlock(hmDrop, 'Classes need 2+ parts');
}

// ═════════════════════════════════════════════════════════════
// ISSUES
// ═════════════════════════════════════════════════════════════
function setupIssuesControls() {
  const bind = (id, key) => $(id).addEventListener('change', e => { S.iss[key] = e.target.value; if (key === 'from' || key === 'to') clearQuick(); S.iss.pageNo = 0; renderIssues(); });
  bind('#iss-course', 'course'); bind('#iss-cycle', 'cycle'); bind('#iss-faculty', 'faculty');
  bind('#iss-category', 'category'); bind('#iss-place', 'place'); bind('#iss-from', 'from'); bind('#iss-to', 'to');
  $('#iss-reset').addEventListener('click', () => {
    Object.assign(S.iss, { course: 'all', cycle: 'all', faculty: 'all', category: 'all', place: 'all', from: '', to: '', pageNo: 0 });
    ['#iss-course', '#iss-cycle', '#iss-faculty', '#iss-category', '#iss-place'].forEach(s => ($(s).value = 'all'));
    $('#iss-from').value = ''; $('#iss-to').value = ''; clearQuick(); renderIssues();
  });
  $('#iss-quick').addEventListener('click', e => {
    const b = e.target.closest('[data-days]'); if (!b) return;
    const to = new Date(), from = new Date(); from.setDate(to.getDate() - +b.dataset.days);
    S.iss.from = $('#iss-from').value = D.isoDate(from);
    S.iss.to = $('#iss-to').value = D.isoDate(to);
    clearQuick(); b.setAttribute('aria-pressed', 'true'); S.iss.pageNo = 0; renderIssues();
  });
  $('#iss-view').addEventListener('click', e => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    S.iss.view = b.dataset.view;
    $$('#iss-view button').forEach(x => x.setAttribute('aria-pressed', x === b));
    renderIssueTimeline(S.iss.rows);
  });
  $('#iss-csv').addEventListener('click', downloadIssuesCSV);
}
const clearQuick = () => $$('#iss-quick .chip').forEach(c => c.setAttribute('aria-pressed', 'false'));

function renderIssues() {
  if (S.page !== 'issues') return;
  const kpis = $('#iss-kpis');
  if (sheetProblem('issues', kpis)) return;
  const rows = D.filterIssues(S.sheets.issues, S.iss);
  S.iss.rows = rows;
  const s = D.issuesSummary(rows);
  const top = t => (t ? esc(t[0]) : '—');
  const topMeta = t => (t ? `${fmt(t[1])} issues` : '');
  kpis.innerHTML = [
    kpi('Issues', num(s.total), '', true),
    kpi('Top category', top(s.topCategory), topMeta(s.topCategory)),
    kpi('Most affected', top(s.topFaculty), topMeta(s.topFaculty)),
    kpi('Top place', top(s.topPlace), topMeta(s.topPlace)),
  ].join('');
  playKpis(kpis);

  const places = D.shareOf(s.place);
  if (places.length) C.segmentBar($('#iss-place-bar'), places); else emptyBlock($('#iss-place-bar'), 'No issues match');

  const catTotal = Object.values(s.category).reduce((a, b) => a + b, 0);
  const cats = Object.entries(s.category).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (cats.length) {
    C.barChart('iss-cat', showChart('ch-iss-cat'), {
      labels: cats.map(c => c[0]), data: cats.map(c => c[1]), horizontal: true, label: 'Issues', color: C.seriesColor(1),
      yFormat: v => String(v), labelFormat: v => `${v} · ${((v / catTotal) * 100).toFixed(0)}%`,
      tooltipFormat: v => `${v} (${((v / catTotal) * 100).toFixed(1)}%)`,
    });
  } else emptyChart('ch-iss-cat', 'No issues match');

  const facs = Object.entries(s.faculty).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (facs.length) {
    C.barChart('iss-fac', showChart('ch-iss-fac'), { labels: facs.map(f => f[0]), data: facs.map(f => f[1]), horizontal: true, label: 'Issues', color: C.seriesColor(0), yFormat: v => String(v) });
  } else emptyChart('ch-iss-fac', 'No issues match');

  renderIssueTimeline(rows);
  renderIssueTable();
}

function renderIssueTimeline(rows) {
  const t = D.issuesTimeline(rows, S.iss.view);
  if (t.labels.length) {
    C.lineChart('iss-time', showChart('ch-iss-time'), {
      labels: t.labels, series: [{ label: 'Issues', data: t.values, color: C.seriesColor(1) }], fill: true, yFormat: v => String(v), curve: 0.3,
    });
  } else emptyChart('ch-iss-time', 'No dated issues');
}

function issueColumns() {
  const all = S.sheets.issues || [];
  return all.length ? Object.keys(all[0]) : [];
}

function tableRows() {
  const q = S.iss.q.trim().toLowerCase();
  let rows = S.iss.rows;
  if (q) rows = rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
  if (S.iss.sort) {
    const k = S.iss.sort, dir = S.iss.dir;
    const val = r => (k.toLowerCase() === 'date' ? (D.parseDate(r[k])?.getTime() || 0) : String(r[k] ?? '').toLowerCase());
    rows = [...rows].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  }
  return rows;
}

function renderIssueTable() {
  const box = $('#iss-table');
  const cols = issueColumns();
  if (!box.dataset.ready) {
    box.innerHTML = `
      <div class="table-tools">
        <label class="search"><span class="sr-only">Search issues</span>${icon('search', 16)}<input class="input" type="search" id="iss-q" placeholder="Search"></label>
        <select class="select" id="iss-size" style="width:96px" aria-label="Rows per page"><option value="25">25 rows</option><option value="50">50 rows</option><option value="100">100 rows</option></select>
      </div>
      <div class="table-wrap"><table class="data"><thead></thead><tbody></tbody></table></div>
      <div class="pager"><span id="iss-count"></span><div class="btns"><button class="btn btn-sm btn-icon" id="iss-prev" type="button" aria-label="Previous page">${icon('left', 16)}</button><span id="iss-pageinfo"></span><button class="btn btn-sm btn-icon" id="iss-next" type="button" aria-label="Next page">${icon('right', 16)}</button></div></div>`;
    box.dataset.ready = '1';
    $('#iss-q').addEventListener('input', e => { S.iss.q = e.target.value; S.iss.pageNo = 0; renderIssueTable(); });
    $('#iss-size').addEventListener('change', e => { S.iss.pageSize = +e.target.value; S.iss.pageNo = 0; renderIssueTable(); });
    $('#iss-prev').addEventListener('click', () => { S.iss.pageNo--; renderIssueTable(); });
    $('#iss-next').addEventListener('click', () => { S.iss.pageNo++; renderIssueTable(); });
    $('thead', box).addEventListener('click', e => {
      const th = e.target.closest('th'); if (!th) return;
      if (S.iss.sort === th.dataset.k) S.iss.dir *= -1; else { S.iss.sort = th.dataset.k; S.iss.dir = 1; }
      renderIssueTable();
    });
  }
  const rows = tableRows();
  const pages = Math.max(1, Math.ceil(rows.length / S.iss.pageSize));
  S.iss.pageNo = Math.min(Math.max(0, S.iss.pageNo), pages - 1);
  const slice = rows.slice(S.iss.pageNo * S.iss.pageSize, (S.iss.pageNo + 1) * S.iss.pageSize);
  const wide = k => /reason|remark|comment|description|detail/i.test(k);
  $('thead', box).innerHTML = `<tr>${cols.map(k => `<th data-k="${esc(k)}" aria-sort="${S.iss.sort === k ? (S.iss.dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(k)}${S.iss.sort === k ? `<span class="dir">${S.iss.dir > 0 ? '↑' : '↓'}</span>` : ''}</th>`).join('')}</tr>`;
  $('tbody', box).innerHTML = slice.length
    ? slice.map(r => `<tr>${cols.map(k => `<td class="${wide(k) ? 'wrap' : ''}">${esc(r[k])}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length || 1}" class="muted" style="text-align:center;padding:28px">No issues match</td></tr>`;
  $('#iss-count').textContent = `${fmt(rows.length)} rows`;
  $('#iss-pageinfo').textContent = `${S.iss.pageNo + 1} / ${pages}`;
  $('#iss-prev').disabled = S.iss.pageNo === 0;
  $('#iss-next').disabled = S.iss.pageNo >= pages - 1;
}

function downloadIssuesCSV() {
  const cols = issueColumns(), rows = tableRows();
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.map(cell).join(','), ...rows.map(r => cols.map(k => cell(r[k])).join(','))].join('\r\n');
  saveBlob(new Blob(['﻿' + csv], { type: 'text/csv' }), `DBMCI_issues_${D.isoDate(new Date())}.csv`);
}

// ═════════════════════════════════════════════════════════════
// RATINGS
// ═════════════════════════════════════════════════════════════
function smartRange(values) {
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 0.5;
  return { yMin: Math.max(0, +(min - range * 0.2).toFixed(2)), yMax: Math.min(5, +(max + range * 0.08).toFixed(2)) };
}

function setupRatingControls() {
  ['subject', 'faculty', 'cycle', 'from', 'to'].forEach(k => $(`#rat-${k}`).addEventListener('change', e => { S.rat[k] = e.target.value; renderRatings(); }));
  $('#rat-reset').addEventListener('click', () => {
    Object.assign(S.rat, { subject: 'all', faculty: 'all', cycle: 'all', from: '', to: '' });
    $('#rat-from').value = ''; $('#rat-to').value = '';
    prepareRatingFilters(); renderRatings();
  });
}

function prepareRatingFilters() {
  const all = S.sheets.ratings || [];
  const rows = all.filter(r => D.clean(r.Course) === S.rat.course);
  fillSelect($('#rat-subject'), D.uniq(rows.map(r => r.Subject)).sort(), { all: ALL });
  fillSelect($('#rat-faculty'), D.uniq(rows.map(r => D.clean(r.Faculty)).filter(f => !D.isUnknown(f))).sort(), { all: ALL });
  const hasCycle = D.hasColumn(all, 'Cycle');
  $('#rat-cycle-field').classList.toggle('hidden', !hasCycle);
  fillSelect($('#rat-cycle'), D.cyclesOf(rows), { all: ALL });
  for (const k of ['subject', 'faculty', 'cycle']) {
    S.rat[k] ||= 'all';
    if (![...$(`#rat-${k}`).options].some(o => o.value === S.rat[k])) S.rat[k] = 'all';
    $(`#rat-${k}`).value = S.rat[k];
  }
}

function renderRatings() {
  if (S.page !== 'ratings') return;
  const kpis = $('#rat-kpis');
  if (sheetProblem('ratings', kpis)) return;
  const rows = D.filterRatings(S.sheets.ratings, S.rat);
  const s = D.ratingsSummary(rows);
  kpis.innerHTML = [
    kpi('Average rating', rows.length ? num(s.avg, 2, ' / 5') : '—', S.rat.course || '', true, rows.length ? s.avg / 5 : null),
    kpi('Sessions', num(s.total), ''),
    kpi('Responses', s.students >= 1000 ? num(+(s.students / 1000).toFixed(1), 1, 'K') : num(s.students), ''),
    kpi('Top performer', s.top ? esc(s.top.name) : '—', s.top ? `${s.top.avg.toFixed(2)} avg` : ''),
    kpi('Needs attention', s.lowest ? esc(s.lowest.name) : '—', s.lowest ? `${s.lowest.avg.toFixed(2)} avg` : ''),
  ].join('');
  playKpis(kpis);

  const ids = ['ch-rat-fac', 'ch-rat-sub', 'ch-rat-dist', 'ch-rat-trend'];
  if (!rows.length) { ids.forEach(id => emptyChart(id, 'No ratings match')); $('#rat-subjects').innerHTML = ''; return; }

  const f2 = v => Number(v).toFixed(2);
  const fac = D.topFacultyRatings(rows);
  C.barChart('rat-fac', showChart('ch-rat-fac'), {
    labels: fac.map(f => f.name.replace(/^Dr\.?\s*/, '')), data: fac.map(f => +f.avg.toFixed(2)), horizontal: true,
    label: 'Average rating', color: C.seriesColor(0), yFormat: f2, ...smartRange(fac.map(f => f.avg)),
  });
  const sub = D.subjectRatings(rows);
  C.barChart('rat-sub', showChart('ch-rat-sub'), {
    labels: sub.map(f => f.name), data: sub.map(f => +f.avg.toFixed(2)), horizontal: true,
    label: 'Average rating', color: C.seriesColor(6), yFormat: f2, ...smartRange(sub.map(f => f.avg)),
  });
  // Rating bands: an ordered scale, light → dark blue.
  const dist = D.ratingDistribution(rows);
  const total = dist.reduce((a, b) => a + b, 0);
  C.barChart('rat-dist', showChart('ch-rat-dist'), {
    labels: D.RATING_BANDS, data: dist, label: 'Sessions', colors: ['#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'], xRotate: false,
    yFormat: v => String(v), labelFormat: v => (total ? `${v} · ${Math.round((v / total) * 100)}%` : String(v)),
  });
  const trend = D.ratingTrend(rows);
  if (trend.length) {
    C.lineChart('rat-trend', showChart('ch-rat-trend'), {
      labels: trend.map(t => t.label), series: [{ label: 'Average rating', data: trend.map(t => +t.avg.toFixed(2)), color: C.seriesColor(0) }],
      yFormat: f2, curve: 0.3, fill: true, ...smartRange(trend.map(t => t.avg)),
    });
    const ch = Chart.getChart('ch-rat-trend');
    ch.options.plugins.tooltip.callbacks.afterLabel = c => ` ${trend[c.dataIndex].min.toFixed(2)} – ${trend[c.dataIndex].max.toFixed(2)} · ${trend[c.dataIndex].count} sessions`;
    ch.update('none');
  } else emptyChart('ch-rat-trend', 'No monthly data');

  const comp = D.subjectComparison(rows);
  const lo = Math.min(...comp.map(c => c.avg)), hi = Math.max(...comp.map(c => c.avg));
  const list = $('#rat-subjects');
  list.innerHTML = comp.map((c, i) => `
    <li>
      <span class="n">${i + 1}</span>
      <span class="name">${esc(c.subject)}<small>${fmt(c.count)} sessions · ${D.formatK(c.students)} responses</small></span>
      <span class="bar"><i style="width:0" data-w="${hi === lo ? 100 : 25 + ((c.avg - lo) / (hi - lo)) * 75}"></i></span>
      <span class="v">${c.avg.toFixed(2)}</span>
    </li>`).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => $$('.bar i', list).forEach((b, i) => { b.style.transitionDelay = `${i * 40}ms`; b.style.width = `${b.dataset.w}%`; })));
}

// ═════════════════════════════════════════════════════════════
// APPRECIATION WALL
// ═════════════════════════════════════════════════════════════
function startPhotoSync() {
  Promise.all([FB.getFacultyList().catch(() => null), FB.getAdminOptions()]).then(([list, opts]) => {
    S.facultyList = list;
    S.adminOptions = opts || {};
    prepareWallFilters();
    if (S.page === 'wall' || S.page === 'admin') renderPage();
  });
  FB.watchScreenshots(list => {
    S.shots = list;
    prepareWallFilters();
    if (S.page === 'wall') renderWall();
    if (S.page === 'admin') renderAdmin();
    if ($('#studio').open) renderStudio();
  }, err => {
    console.error(err);
    toast('Could not load appreciation photos. Check your access.', 'error');
  });
}

// Faculty = saved list + anyone who has photos (so no photo is ever orphaned or hidden).
const allFaculty = () => D.mergeFaculty(S.facultyList, S.shots);
const prettyId = D.prettyFacultyId;
const facultyName = id => allFaculty().find(f => f.id === id)?.name || prettyId(id);

function hubOptions() {
  const att = S.sheets.attendance || [];
  const o = S.adminOptions || {};
  const courses = D.uniq([...D.inSheetOrder(att, 'Course'), ...(o.courses || []), ...S.shots.map(s => s.course)]);
  const cycles = D.uniq([...D.cyclesOf(att), ...(o.cycles || []), ...S.shots.map(s => s.cycle)]).sort(D.byNumber);
  const maxDay = Math.max(15, ...att.map(r => D.dayNum(r.Day)));
  const days = D.uniq([...Array.from({ length: maxDay }, (_, i) => `Day ${i + 1}`), ...(o.days || []), ...S.shots.map(s => s.day)]).sort(D.byNumber);
  return { courses, cycles, days };
}

function prepareWallFilters() {
  const shotOpts = {
    courses: D.uniq(S.shots.map(s => s.course)).sort(),
    cycles: D.uniq(S.shots.map(s => s.cycle)).sort(D.byNumber),
    days: D.uniq(S.shots.map(s => s.day)).sort(D.byNumber),
  };
  for (const [sel, key, label] of [['#wall-course', 'courses', 'All courses'], ['#wall-cycle', 'cycles', 'All cycles'], ['#wall-day', 'days', 'All days'],
    ['#st-course', 'courses', 'All courses'], ['#st-cycle', 'cycles', 'All cycles'], ['#st-day', 'days', 'All days']]) {
    fillSelect($(sel), shotOpts[key], { all: { value: 'all', label } });
  }
  const h = hubOptions();
  fillSelect($('#up-course'), h.courses, { all: { value: '', label: 'Select course' } });
  fillSelect($('#up-cycle'), h.cycles, { all: { value: '', label: 'Select cycle' } });
  fillSelect($('#up-day'), h.days, { all: { value: '', label: 'Select day' } });
  fillSelect($('#up-faculty'), [], { all: { value: '', label: 'Select faculty' } });
  $('#up-faculty').insertAdjacentHTML('beforeend', allFaculty().sort((a, b) => a.name.localeCompare(b.name)).map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join(''));
}

const matches = (s, f) => (f.course === 'all' || s.course === f.course) && (f.cycle === 'all' || s.cycle === f.cycle) && (f.day === 'all' || s.day === f.day);

function setupWall() {
  $('#wall-search').addEventListener('input', e => { S.wall.q = e.target.value; renderWall(); });
  ['course', 'cycle', 'day'].forEach(k => $(`#wall-${k}`).addEventListener('change', e => { S.wall[k] = e.target.value; renderWall(); }));
  $('#wall-reset').addEventListener('click', () => {
    Object.assign(S.wall, { q: '', course: 'all', cycle: 'all', day: 'all' });
    $('#wall-search').value = ''; ['course', 'cycle', 'day'].forEach(k => ($(`#wall-${k}`).value = 'all'));
    renderWall();
  });
  $('#wall').addEventListener('click', e => { const c = e.target.closest('[data-fac]'); if (c) openViewer(c.dataset.fac); });
}

function renderWall() {
  if (S.page !== 'wall') return;
  const week = Date.now() - 7 * 86400000;
  $('#wall-total').textContent = fmt(S.shots.length);
  $('#wall-faculty').textContent = fmt(D.uniq(S.shots.map(s => s.facultyId)).length);
  $('#wall-week').textContent = fmt(S.shots.filter(s => s.timestamp > week).length);

  const q = S.wall.q.trim().toLowerCase();
  const anyFilter = S.wall.course !== 'all' || S.wall.cycle !== 'all' || S.wall.day !== 'all';
  const cards = allFaculty()
    .filter(f => f.name.toLowerCase().includes(q))
    .map(f => ({ f, list: S.shots.filter(s => s.facultyId === f.id && matches(s, S.wall)) }))
    .filter(x => x.list.length || !anyFilter)
    .sort((a, b) => b.list.length - a.list.length || a.f.name.localeCompare(b.f.name));

  const withMsgs = cards.filter(c => c.list.length), without = cards.filter(c => !c.list.length);
  $('#wall').innerHTML = (withMsgs.length || !without.length ? '' : `<div class="empty" style="grid-column:1/-1"><div><b>No messages yet</b>Uploaded messages will appear here.</div></div>`) +
    withMsgs.map(({ f, list }) => {
    const last = list[list.length - 1];
    const recent = last && Date.now() - last.timestamp < 86400000;
    return `
      <button class="fac" data-fac="${esc(f.id)}" type="button" ${list.length ? '' : 'aria-disabled="true"'}>
        <div class="fac-cover">
          ${last ? `<img src="${esc(last.url)}" alt="" loading="lazy">` : '<div class="none">No messages yet</div>'}
          ${list.length > 1 ? `<span class="stack-count">${list.length} messages</span>` : ''}
        </div>
        <div class="fac-body">
          <div class="mono">${esc(initials(f.name))}</div>
          <div style="min-width:0">
            <div class="fac-name">${esc(f.name)}</div>
            <div class="fac-meta">${list.length ? `${list.length} message${list.length === 1 ? '' : 's'} · ${timeSince(last.timestamp)}` : 'No messages yet'}</div>
          </div>
          ${recent ? '<span class="fac-new">New</span>' : ''}
        </div>
      </button>`;
  }).join('') +
    (without.length ? `<div class="wall-none"><span>No messages yet</span>${without.map(({ f }) => `<span class="badge">${esc(f.name)}</span>`).join('')}</div>` : '') +
    (cards.length ? '' : `<div class="empty" style="grid-column:1/-1"><div><b>No faculty match</b>Try a different name or clear the filters.</div></div>`);
}

function timeSince(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Viewer ───────────────────────────────────────────────────
function setupViewer() {
  const v = $('#viewer');
  $('#v-close').addEventListener('click', () => v.close());
  $('#v-prev').addEventListener('click', () => stepViewer(-1));
  $('#v-next').addEventListener('click', () => stepViewer(1));
  v.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') stepViewer(-1); if (e.key === 'ArrowRight') stepViewer(1); });
  $('#v-strip').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { S.viewer.i = +b.dataset.i; paintViewer(); } });
  $('#v-download').addEventListener('click', () => {
    const s = S.viewer.list[S.viewer.i];
    downloadOne(s, `${fileBase(s)}_${S.viewer.i + 1}`);
  });
  $('#v-delete').addEventListener('click', deleteCurrent);
}

function openViewer(facultyId) {
  const list = S.shots.filter(s => s.facultyId === facultyId && matches(s, S.wall));
  if (!list.length) return;
  S.viewer = { list, i: list.length - 1, faculty: facultyId };
  const name = facultyName(facultyId);
  $('#v-name').textContent = name;
  $('#v-mono').textContent = initials(name);
  $('#v-delete').classList.toggle('hidden', !isAdmin());
  $('#v-strip').innerHTML = list.map((s, i) => `<button type="button" data-i="${i}" aria-label="Message ${i + 1}"><img src="${esc(s.url)}" alt="" loading="lazy"></button>`).join('');
  paintViewer();
  $('#viewer').showModal();
}

function paintViewer() {
  const { list, i } = S.viewer;
  const s = list[i];
  $('#v-img').src = s.url;
  $('#v-delete').classList.toggle('hidden', !isAdmin() || !!s.legacy);
  $('#v-img').alt = `Appreciation message for ${facultyName(s.facultyId)}`;
  $('#v-meta').textContent = `${i + 1} of ${list.length} · ${[s.course, s.cycle, s.day].filter(Boolean).join(' · ')} · ${new Date(s.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  $$('#v-strip button').forEach((b, n) => b.setAttribute('aria-current', n === i));
  $(`#v-strip [data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  $('#v-prev').disabled = i === 0;
  $('#v-next').disabled = i === list.length - 1;
}
function stepViewer(d) {
  const n = S.viewer.i + d;
  if (n >= 0 && n < S.viewer.list.length) { S.viewer.i = n; paintViewer(); }
}

async function deleteCurrent() {
  const s = S.viewer.list[S.viewer.i];
  if (!s || s.legacy) return;
  const ok = await confirmDialog({
    title: 'Delete this message?', body: `This permanently removes one appreciation photo for ${facultyName(s.facultyId)}. It cannot be undone. Download it first if you want a copy.`,
    confirm: 'Delete photo', danger: true,
  });
  if (!ok) return;
  try {
    await FB.deleteScreenshot(s.id);
    FB.logActivity('Photo deleted', `1 photo deleted for ${facultyName(s.facultyId)} (${[s.course, s.cycle, s.day].join(' · ')})`);
    S.viewer.list.splice(S.viewer.i, 1);
    toast('Photo deleted', 'success');
    if (!S.viewer.list.length) return $('#viewer').close();
    S.viewer.i = Math.min(S.viewer.i, S.viewer.list.length - 1);
    $('#v-strip').innerHTML = S.viewer.list.map((x, i) => `<button type="button" data-i="${i}"><img src="${esc(x.url)}" alt="" loading="lazy"></button>`).join('');
    paintViewer();
  } catch (e) {
    toast(e.code === 'permission-denied' ? 'You do not have permission to delete photos' : 'Could not delete the photo', 'error');
  }
}

// ── Download studio ──────────────────────────────────────────
const studioFilter = () => ({ course: $('#st-course').value || 'all', cycle: $('#st-cycle').value || 'all', day: $('#st-day').value || 'all' });
const visibleShots = () => { const f = studioFilter(); return S.shots.filter(s => matches(s, f)); };

function setupStudio() {
  const d = $('#studio');
  $('#open-studio').addEventListener('click', () => {
    ['course', 'cycle', 'day'].forEach(k => { if ([...$(`#st-${k}`).options].some(o => o.value === S.wall[k])) $(`#st-${k}`).value = S.wall[k]; });
    renderStudio(); d.showModal();
  });
  $('[data-close]', d).addEventListener('click', () => d.close());
  ['#st-course', '#st-cycle', '#st-day'].forEach(s => $(s).addEventListener('change', renderStudio));
  $('#st-all-fac').addEventListener('change', e => {
    visibleShots().forEach(s => (e.target.checked ? S.studio.selected.add(s.id) : S.studio.selected.delete(s.id)));
    renderStudio();
  });
  $('#st-fac').addEventListener('change', e => {
    const id = e.target.dataset.fac; if (!id) return;
    visibleShots().filter(s => s.facultyId === id).forEach(s => (e.target.checked ? S.studio.selected.add(s.id) : S.studio.selected.delete(s.id)));
    renderStudio();
  });
  $('#st-fac').addEventListener('click', e => {
    const a = e.target.closest('[data-jump]'); if (!a) return;
    e.preventDefault();
    $(`#grp-${CSS.escape(a.dataset.jump)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#st-main').addEventListener('click', e => {
    const t = e.target.closest('[data-shot]');
    if (t) { const id = t.dataset.shot; S.studio.selected.has(id) ? S.studio.selected.delete(id) : S.studio.selected.add(id); renderStudio(); return; }
    const g = e.target.closest('[data-group]');
    if (g) {
      const list = visibleShots().filter(s => s.facultyId === g.dataset.group);
      const allOn = list.every(s => S.studio.selected.has(s.id));
      list.forEach(s => (allOn ? S.studio.selected.delete(s.id) : S.studio.selected.add(s.id)));
      renderStudio();
    }
  });
  $('#st-select-visible').addEventListener('click', () => { visibleShots().forEach(s => S.studio.selected.add(s.id)); renderStudio(); });
  $('#st-clear').addEventListener('click', () => { S.studio.selected.clear(); renderStudio(); });
  $('#st-download').addEventListener('click', downloadZip);
}

function renderStudio() {
  const shots = visibleShots();
  const ids = new Set(S.shots.map(s => s.id));
  [...S.studio.selected].forEach(id => { if (!ids.has(id)) S.studio.selected.delete(id); });
  const groups = allFaculty().map(f => ({ f, list: shots.filter(s => s.facultyId === f.id) })).filter(g => g.list.length)
    .sort((a, b) => a.f.name.localeCompare(b.f.name));
  const sel = S.studio.selected;
  const state = list => { const n = list.filter(s => sel.has(s.id)).length; return { n, all: n === list.length && n > 0, some: n > 0 && n < list.length }; };

  const allState = state(shots);
  const allBox = $('#st-all-fac');
  allBox.checked = allState.all; allBox.indeterminate = allState.some;
  $('#st-all-count').textContent = shots.length;

  $('#st-fac').innerHTML = groups.map(({ f, list }) => {
    const st = state(list);
    return `<label class="check"><input type="checkbox" data-fac="${esc(f.id)}" ${st.all ? 'checked' : ''}>
      <a href="#" data-jump="${esc(f.id)}" style="color:inherit;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</a>
      <span class="count">${st.n ? `${st.n}/` : ''}${list.length}</span></label>`;
  }).join('') || '<div class="muted" style="padding:8px">No photos match these filters.</div>';
  $$('#st-fac input').forEach(i => { const g = groups.find(x => x.f.id === i.dataset.fac); i.indeterminate = state(g.list).some; });

  $('#st-main').innerHTML = groups.length ? groups.map(({ f, list }) => {
    const st = state(list);
    return `<section class="studio-group" id="grp-${esc(f.id)}">
      <h4>${esc(f.name)} <span class="muted">${list.length} photo${list.length === 1 ? '' : 's'}</span>
        <button class="btn btn-sm btn-ghost" data-group="${esc(f.id)}" type="button" style="margin-left:auto">${st.all ? 'Unselect all' : 'Select all'}</button></h4>
      <div class="thumbs">${list.map((s, i) => `
        <button class="thumb" type="button" data-shot="${esc(s.id)}" aria-pressed="${sel.has(s.id)}" aria-label="${esc(f.name)} message ${i + 1}">
          <img src="${esc(s.url)}" alt="" loading="lazy"><span class="tick">${icon('check', 14)}</span>
          <span class="cap">${esc([s.course, s.cycle, s.day].filter(Boolean).join(' · '))}</span>
        </button>`).join('')}</div>
    </section>`;
  }).join('') : `<div class="empty"><div><b>No photos match</b>Change the course, cycle or day.</div></div>`;

  const n = sel.size;
  const bytes = S.shots.filter(s => sel.has(s.id)).reduce((a, s) => a + approxBytes(s.url), 0);
  $('#st-summary').textContent = n ? `${n} photo${n === 1 ? '' : 's'} selected · about ${(bytes / 1048576).toFixed(1)} MB` : 'Nothing selected';
  $('#st-download').disabled = !n;
}

const approxBytes = url => (String(url).startsWith('data:') ? Math.round((url.length - url.indexOf(',') - 1) * 0.75) : 300000);
const safe = s => String(s || '').replace(/^Dr\.?\s*/i, 'Dr ').replace(/[^\w\s.-]+/g, '').trim().replace(/\s+/g, '_') || 'file';
const fileBase = s => [safe(facultyName(s.facultyId)), safe(s.course), safe(s.cycle), safe(s.day)].join('_');

async function shotBlobParts(s) {
  const url = String(s.url);
  if (url.startsWith('data:')) {
    const [head, b64] = url.split(',');
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    return { b64, ext: mime.split('/')[1].replace('jpeg', 'jpg').replace('+xml', '') };
  }
  const res = await fetch(url);
  const blob = await res.blob();
  return { blob, ext: (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg') };
}

async function downloadOne(s, name) {
  try {
    const p = await shotBlobParts(s);
    const blob = p.blob || await (await fetch(s.url)).blob();
    saveBlob(blob, `${name}.${p.ext}`);
  } catch { toast('Could not download this photo', 'error'); }
}

async function downloadZip() {
  const chosen = S.shots.filter(s => S.studio.selected.has(s.id));
  if (!chosen.length) return;
  const btn = $('#st-download'), bar = $('#st-progress'), fill = $('#st-progress i');
  btn.disabled = true; bar.classList.remove('hidden'); fill.style.width = '0%';
  const zip = new JSZip();
  const perFolder = $('#st-folders').checked;
  const counters = {};
  let failed = 0;
  try {
    for (let i = 0; i < chosen.length; i++) {
      const s = chosen[i];
      try {
        const p = await shotBlobParts(s);
        const base = fileBase(s);
        counters[base] = (counters[base] || 0) + 1;
        const name = `${base}_${String(counters[base]).padStart(2, '0')}.${p.ext}`;
        const path = perFolder ? `${safe(facultyName(s.facultyId))}/${name}` : name;
        p.b64 ? zip.file(path, p.b64, { base64: true }) : zip.file(path, p.blob);
      } catch { failed++; }
      fill.style.width = `${Math.round(((i + 1) / chosen.length) * 50)}%`;
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, m => { fill.style.width = `${50 + Math.round(m.percent / 2)}%`; });
    const facCount = D.uniq(chosen.map(s => s.facultyId)).length;
    saveBlob(blob, `DBMCI_appreciation_${facCount === 1 ? safe(facultyName(chosen[0].facultyId)) + '_' : ''}${D.isoDate(new Date())}.zip`);
    FB.logActivity('Photos downloaded', `${chosen.length - failed} photo(s) from ${facCount} faculty`);
    toast(failed ? `Downloaded ${chosen.length - failed} photos. ${failed} could not be read.` : `Downloaded ${chosen.length} photos`, failed ? 'error' : 'success');
  } catch (e) {
    console.error(e); toast('Could not create the ZIP file', 'error');
  } finally {
    btn.disabled = false; setTimeout(() => bar.classList.add('hidden'), 800);
  }
}

function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ── Upload ───────────────────────────────────────────────────
function setupUpload() {
  const d = $('#uploader');
  $('#open-upload').addEventListener('click', () => {
    S.upload.files = []; paintPreviews(); $('#up-status').textContent = '';
    ['course', 'cycle', 'day'].forEach(k => { if (S.wall[k] !== 'all') $(`#up-${k}`).value = S.wall[k]; });
    d.showModal();
  });
  $('[data-close]', d).addEventListener('click', () => d.close());
  const drop = $('#up-drop');
  $('#up-files').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  $('#up-previews').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { S.upload.files.splice(+b.dataset.rm, 1); paintPreviews(); } });
  $('#up-form').addEventListener('submit', doUpload);
}

function addFiles(list) {
  [...list].filter(f => f.type.startsWith('image/')).forEach(f => S.upload.files.push({ file: f, url: URL.createObjectURL(f) }));
  paintPreviews();
}
function paintPreviews() {
  $('#up-previews').innerHTML = S.upload.files.map((f, i) => `<figure><img src="${f.url}" alt=""><button type="button" data-rm="${i}" aria-label="Remove">${icon('x', 12)}</button></figure>`).join('');
  $('#up-submit').disabled = !S.upload.files.length;
  $('#up-submit').textContent = S.upload.files.length ? `Upload ${S.upload.files.length} image${S.upload.files.length === 1 ? '' : 's'}` : 'Upload';
}

// Resize to max 1400px and keep each photo safely under Firestore's 1 MB document limit.
function compress(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      const max = 1400;
      if (w > max || h > max) { if (w > h) { h = Math.round(h * max / w); w = max; } else { w = Math.round(w * max / h); h = max; } }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      let q = 0.8, out = c.toDataURL('image/jpeg', q);
      while (out.length > 900000 && q > 0.35) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      resolve(out);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function doUpload(e) {
  e.preventDefault();
  const facultyId = $('#up-faculty').value, course = $('#up-course').value, cycle = $('#up-cycle').value, day = $('#up-day').value;
  if (!facultyId || !course || !cycle || !day) return toast('Choose faculty, course, cycle and day', 'error');
  const btn = $('#up-submit'); btn.disabled = true;
  const status = $('#up-status');
  try {
    const items = [];
    const now = Date.now();
    for (let i = 0; i < S.upload.files.length; i++) {
      status.textContent = `Preparing ${i + 1} of ${S.upload.files.length}…`;
      items.push({ url: await compress(S.upload.files[i].file), course, cycle, day, timestamp: now + i });
    }
    await FB.addScreenshots(facultyId, items, (n, t) => { status.textContent = `Uploading ${n} of ${t}…`; });
    FB.logActivity('Photos uploaded', `${items.length} photo(s) for ${facultyName(facultyId)} · ${course} · ${cycle} · ${day}`);
    toast(`${items.length} message${items.length === 1 ? '' : 's'} uploaded`, 'success');
    $('#uploader').close();
  } catch (err) {
    console.error(err);
    toast(err.code === 'permission-denied' ? 'You do not have permission to upload' : 'Upload failed. Nothing already uploaded was changed.', 'error');
  } finally { btn.disabled = false; status.textContent = ''; }
}

// ═════════════════════════════════════════════════════════════
// ADMIN
// ═════════════════════════════════════════════════════════════
function setupAdmin() {
  $('#fac-form').addEventListener('submit', async e => {
    e.preventDefault();
    let name = $('#fac-name').value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (!/^dr\.?\s/i.test(name)) name = 'Dr. ' + name;
    name = name.replace(/^dr\.?\s/i, 'Dr. ');
    const id = name.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
    const list = (S.facultyList || DEFAULT_FACULTY).map(f => ({ ...f }));
    if (list.some(f => f.id === id)) return toast('This faculty member is already on the list', 'error');
    list.push({ id, name });
    await saveFaculty(list, 'Faculty added', name);
    $('#fac-name').value = '';
  });
  $('#fac-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-rm-fac]'); if (!b) return;
    const f = allFaculty().find(x => x.id === b.dataset.rmFac);
    const n = S.shots.filter(s => s.facultyId === f.id).length;
    const ok = await confirmDialog({
      title: `Remove ${f.name} from the list?`,
      body: n ? `Their ${n} appreciation photo${n === 1 ? '' : 's'} will be kept and stay visible on the wall.` : 'They have no photos.',
      confirm: 'Remove from list',
    });
    if (!ok) return;
    await saveFaculty((S.facultyList || DEFAULT_FACULTY).filter(x => x.id !== f.id), 'Faculty removed', f.name);
  });
  $('#mem-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#mem-email').value.trim().toLowerCase(), role = $('#mem-role').value;
    if (email === S.me.email) return toast('You cannot change your own role', 'error');
    try {
      await FB.setMember(email, role, S.me.email);
      FB.logActivity('Member saved', `${email} set to ${role}`);
      $('#mem-email').value = '';
      toast('Member saved', 'success');
      renderMembers();
    } catch (err) { toast(err.code === 'permission-denied' ? 'Only super admins can manage members' : 'Could not save the member', 'error'); }
  });
  $('#mem-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-rm-mem]'); if (!b) return;
    const email = b.dataset.rmMem;
    if (!(await confirmDialog({ title: `Remove ${email}?`, body: 'They will no longer be able to sign in to DBMCI One.', confirm: 'Remove access', danger: true }))) return;
    try { await FB.removeMember(email); FB.logActivity('Member removed', email); toast('Access removed', 'success'); renderMembers(); }
    catch { toast('Could not remove the member', 'error'); }
  });
  $('#logs-refresh').addEventListener('click', renderLogs);
}

async function saveFaculty(list, action, name) {
  try {
    await FB.saveFacultyList(list);
    S.facultyList = list;
    FB.logActivity(action, name);
    toast(`${action}: ${name}`, 'success');
    prepareWallFilters(); renderAdmin();
  } catch (e) { toast(e.code === 'permission-denied' ? 'Only admins can change the faculty list' : 'Could not save the faculty list', 'error'); }
}

function renderAdmin() {
  if (S.page !== 'admin') return;
  const counts = {};
  S.shots.forEach(s => { counts[s.facultyId] = (counts[s.facultyId] || 0) + 1; });
  $('#fac-list').innerHTML = allFaculty().sort((a, b) => a.name.localeCompare(b.name)).map(f => `
    <li><div class="mono" style="width:30px;height:30px;font-size:11px">${esc(initials(f.name))}</div>
      <span class="grow">${esc(f.name)}${f.unlisted ? ' <span class="badge">Not on list</span>' : ''}</span>
      <span class="muted" style="font-size:12px">${counts[f.id] || 0} photos</span>
      ${f.unlisted ? '' : `<button class="btn btn-sm btn-ghost btn-icon" data-rm-fac="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">${icon('x', 14)}</button>`}
    </li>`).join('');
  if (isSuper()) { renderMembers(); renderLogs(); }
}

async function renderMembers() {
  try {
    const list = await FB.listMembers();
    $('#mem-list').innerHTML = list.map(m => `
      <li><span class="grow">${esc(m.email)}</span><span class="badge ${esc(m.role)}">${esc({ superadmin: 'Super admin', admin: 'Admin', viewer: 'Viewer' }[m.role] || m.role)}</span>
      ${m.email === S.me.email ? '<span class="muted" style="font-size:12px;width:30px;text-align:center">You</span>' : `<button class="btn btn-sm btn-ghost btn-icon" data-rm-mem="${esc(m.email)}" aria-label="Remove ${esc(m.email)}">${icon('x', 14)}</button>`}</li>`).join('');
  } catch { $('#mem-list').innerHTML = '<li class="muted">Could not load members.</li>'; }
}

async function renderLogs() {
  const box = $('#logs');
  box.innerHTML = '<div class="skel" style="height:120px"></div>';
  try {
    const logs = await FB.loadLogs();
    box.innerHTML = logs.length ? `<div class="table-wrap" style="max-height:420px"><table class="data"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>
      ${logs.map(l => `<tr><td class="log-time">${esc(new Date(l.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}</td><td>${esc(l.adminEmail)}</td><td>${esc(l.action)}</td><td class="wrap">${esc(l.details)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><div><b>No activity yet</b></div></div>';
  } catch { box.innerHTML = '<div class="notice error">Could not load the activity log.</div>'; }
}

// ═════════════════════════════════════════════════════════════
// INACTIVITY
// ═════════════════════════════════════════════════════════════
function startInactivityTimer() {
  let timer;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await FB.signOutUser('Auto sign-out (30 min inactive)');
      location.replace('login.html?reason=idle');
    }, INACTIVITY_MS);
  };
  ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(ev => document.addEventListener(ev, reset, { passive: true, capture: true }));
  reset();
}
