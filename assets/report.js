// ─────────────────────────────────────────────────────────────
// DBMCI One · PDF report builder
// Builds real A4 pages (794 × 1123 px) in the preview, then captures
// exactly those pages into the PDF. What you see is what you get.
// ─────────────────────────────────────────────────────────────
import * as D from './data.js';
import * as FB from '../firebase.js';
import * as C from './charts.js';
import { $, $$, esc, fmt, hydrateIcons, toast, fillSelect, sleep } from './ui.js';

C.forceMode('light');
Chart.defaults.devicePixelRatio = 2;
Chart.defaults.font.family = "'Plex', system-ui, sans-serif";
Chart.defaults.font.size = 10;

const S = { me: null, att: [], iss: [], rat: [], shots: [], faculty: [], building: false };
let buildTimer;

boot();

async function boot() {
  S.me = await FB.requireMember();
  hydrateIcons();
  document.body.classList.remove('booting');
  const status = $('#rb-status');
  const [att, iss, rat, shots, facList] = await Promise.all([
    D.fetchSheet('attendance').catch(() => null),
    D.fetchSheet('issues').catch(() => null),
    D.fetchSheet('ratings').catch(() => null),
    FB.loadScreenshots().catch(() => null),
    FB.getFacultyList().catch(() => null),
  ]);
  const failed = [!att && 'attendance', !iss && 'issues', !rat && 'ratings', !shots && 'photos'].filter(Boolean);
  if (failed.length) toast(`Could not load: ${failed.join(', ')}`, 'error', 6000);
  Object.assign(S, { att: att || [], iss: iss || [], rat: rat || [], shots: shots || [] });
  S.faculty = D.mergeFaculty(facList, S.shots);

  fillSelect($('#r-course'), D.inSheetOrder(S.att, 'Course'));
  populateScope();

  $('#r-course').addEventListener('change', () => { populateScope(); queueBuild(); });
  $$('.rb-side select, .rb-side input').forEach(el => el.addEventListener(el.type === 'text' ? 'input' : 'change', queueBuild));
  $('#s-photos').addEventListener('change', () => $('#photo-opts').classList.toggle('hidden', !$('#s-photos').checked));
  $('#rb-download').addEventListener('click', download);
  window.addEventListener('resize', fitPreview);
  status.textContent = 'Preview updates as you change options';
  build();
}

function populateScope() {
  const course = $('#r-course').value;
  const rows = S.att.filter(r => D.clean(r.Course) === course);
  fillSelect($('#r-subject'), D.uniq(rows.map(r => r.Subject)).sort(), { all: { value: 'all', label: 'All subjects' } });
  fillSelect($('#r-cycle'), D.cyclesOf(rows), { all: { value: 'All', label: 'All cycles' } });
  const shots = S.shots.filter(s => s.course === course);
  const facIds = new Set(shots.map(s => s.facultyId));
  $('#r-faculty').innerHTML = '<option value="all">All faculty</option>' +
    S.faculty.filter(f => facIds.has(f.id)).sort((a, b) => a.name.localeCompare(b.name)).map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
  fillSelect($('#r-day'), D.uniq(shots.map(s => s.day)).sort(D.byNumber), { all: { value: 'all', label: 'All days' } });
}

function opts() {
  return {
    course: $('#r-course').value, subject: $('#r-subject').value, cycle: $('#r-cycle').value,
    from: $('#r-from').value, to: $('#r-to').value,
    faculty: $('#r-faculty').value, day: $('#r-day').value, per: +$('#r-per').value,
    preparedFor: $('#r-for').value.trim(),
    sec: { att: $('#s-att').checked, table: $('#s-table').checked, iss: $('#s-iss').checked, rat: $('#s-rat').checked, photos: $('#s-photos').checked },
  };
}

function queueBuild() { clearTimeout(buildTimer); buildTimer = setTimeout(build, 250); }

// ── Page scaffolding ─────────────────────────────────────────
const longDate = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = s => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function scopeLine(o) {
  const parts = [`<b>${esc(o.course)}</b>`, esc(o.cycle === 'All' ? 'All cycles' : o.cycle), esc(o.subject === 'all' ? 'All subjects' : o.subject)];
  const range = o.from || o.to ? `${shortDate(o.from) || 'Start'} – ${shortDate(o.to) || 'Today'}` : 'All dates';
  return `${parts.join(' · ')}<br>${esc(range)}`;
}

function page(kicker, title, o, body) {
  const el = document.createElement('section');
  el.className = 'a4';
  el.innerHTML = `
    <header class="pg-head">
      <div><div class="pg-kicker">${esc(kicker)}</div><h2 class="pg-title">${esc(title)}</h2></div>
      <div class="pg-scope">${scopeLine(o)}</div>
    </header>
    ${body}
    <footer class="pg-foot"><span>DBMCI One · ${esc(o.course)} · Confidential</span><span class="pg-no"></span></footer>`;
  return el;
}

const kpiCell = (l, v, m = '') => {
  const text = !/^[\d—.]/.test(String(v).replace(/<[^>]+>/g, ''));
  return `<div class="pg-kpi"><div class="l">${esc(l)}</div><div class="v${text ? ' t' : ''}">${v}</div>${m ? `<div class="m">${esc(m)}</div>` : ''}</div>`;
};
const chartBox = (id, h) => `<div class="pg-chart" style="height:${h}px"><canvas id="${id}"></canvas></div>`;
const empty = t => `<div class="pg-empty">${esc(t)}</div>`;

// ── Build ────────────────────────────────────────────────────
async function build() {
  if (S.building) return queueBuild();
  S.building = true;
  const o = opts();
  C.destroyAll();
  const box = $('#rb-pages');
  box.innerHTML = '';
  const pages = [];   // { el, draw?: () => void, toc?: string }

  const parts = D.partColumns(S.att);
  const att = D.filterAttendance(S.att, { course: o.course, subjects: o.subject === 'all' ? [] : [o.subject], cycle: o.cycle, from: o.from, to: o.to });
  const courseCycles = D.cyclesOf(S.att.filter(r => D.clean(r.Course) === o.course));

  if (o.sec.att) pages.push(...attendancePages(o, att, parts, courseCycles));
  if (o.sec.table) pages.push(...subjectTablePages(o, att, parts));
  if (o.sec.iss) pages.push(issuesPage(o));
  if (o.sec.rat) pages.push(ratingsPage(o));
  if (o.sec.photos) pages.push(...photoPages(o));

  const cover = coverPage(o, pages);
  const all = [cover, ...pages];
  all.forEach(p => box.append(p.el));
  all.forEach((p, i) => { const n = p.el.querySelector('.pg-no'); if (n) n.textContent = `Page ${i + 1} of ${all.length}`; });
  // Table of contents with page numbers
  const toc = []; all.forEach((p, i) => { if (p.toc && !toc.some(t => t.title === p.toc)) toc.push({ title: p.toc, page: i + 1 }); });
  cover.el.querySelector('ol').innerHTML = toc.map((t, i) => `<li><span>${String(i + 1).padStart(2, '0')}</span><span>${esc(t.title)}</span><span>${t.page}</span></li>`).join('') || '<li><span>No sections selected</span></li>';
  cover.el.querySelector('.cover-foot span:last-child').textContent = `${all.length} page${all.length === 1 ? '' : 's'}`;

  fitPreview();
  for (const p of all) p.draw?.();
  $('#rb-download').disabled = false;
  $('#rb-status').textContent = `${all.length} page${all.length === 1 ? '' : 's'} · A4 portrait`;
  S.building = false;
}

function fitPreview() {
  const main = $('#rb-main'), box = $('#rb-pages');
  const s = Math.min(1, (main.clientWidth - 48) / 794);
  box.style.transform = `scale(${s})`;
  const n = box.children.length;
  box.style.height = `${n * (1123 + 28)}px`;
  box.style.marginBottom = `${-(1 - s) * n * (1123 + 28)}px`;
  box.style.marginLeft = `${Math.max(0, (main.clientWidth - 48 - 794 * s) / 2)}px`;
}

// ── Cover ────────────────────────────────────────────────────
function coverPage(o) {
  const el = document.createElement('section');
  el.className = 'a4 cover';
  const range = o.from || o.to ? `${shortDate(o.from) || 'Start'} – ${shortDate(o.to) || 'Today'}` : 'All dates';
  el.innerHTML = `
    <div class="cover-band"></div>
    <div class="cover-inner">
      <div class="cover-top">
        <div class="cover-brand"><img src="dbmci-one-logo.png" alt="DBMCI One" style="height:40px" onerror="this.outerHTML='<span>DBMCI One</span>'"></div>
        <div class="cover-date">${esc(longDate(new Date()))}</div>
      </div>
      <div class="cover-mid">
        <div class="cover-kicker">Performance report</div>
        <h1 class="cover-title">Live class attendance &amp; insights</h1>
        <div class="cover-course">${esc(o.course)}${o.preparedFor ? ` · Prepared for ${esc(o.preparedFor)}` : ''}</div>
      </div>
      <div class="cover-meta">
        <div><div class="l">Course</div><div class="v">${esc(o.course)}</div></div>
        <div><div class="l">Cycle</div><div class="v">${esc(o.cycle === 'All' ? 'All cycles' : o.cycle)}</div></div>
        <div><div class="l">Subject</div><div class="v">${esc(o.subject === 'all' ? 'All subjects' : o.subject)}</div></div>
        <div><div class="l">Period</div><div class="v">${esc(range)}</div></div>
      </div>
      <div class="cover-toc" style="margin-top:auto">
        <h4>Contents</h4>
        <ol></ol>
      </div>
      <div class="cover-foot"><span>Confidential · Prepared by ${esc(S.me.email)}</span><span></span></div>
    </div>`;
  return { el };
}

// ── Attendance ───────────────────────────────────────────────
function attendancePages(o, data, parts, courseCycles) {
  const toc = 'Attendance';
  if (!data.length) return [{ el: page('Attendance', 'Overview', o, empty('No attendance records match this scope.')), toc }];
  const k = D.attendanceKPIs(data, parts);
  let ret;
  if (k.multiDay) ret = kpiCell('Retention', `${k.retention}<small>%</small>`, 'Last day vs Day 1');
  else if (k.singlePart) ret = kpiCell('Retention', 'Single part', 'One part per class');
  else ret = kpiCell('Average drop-off', `${k.drop}<small>%</small>`, 'Single-day course');

  const dataCycles = D.cyclesOf(data);
  const flCycle = o.cycle !== 'All' ? o.cycle : dataCycles[dataCycles.length - 1];
  const fl = D.firstVsLast(data, flCycle || 'All');
  const dt = D.dropTrend(data, parts);
  const journey = D.classJourney(data, parts);

  const p1 = page('Attendance', 'Overview', o, `
    <div class="pg-kpis" style="--n:5">
      ${ret}
      ${kpiCell('Class records', fmt(k.sessions), `${dataCycles.length} cycle${dataCycles.length === 1 ? '' : 's'}`)}
      ${kpiCell('Peak attendance', k.peak ? fmt(k.peak) : '—', k.peakSubject)}
      ${kpiCell('Drop-off', k.singlePart ? 'Single part' : `${k.drop}<small>%</small>`, 'First to last part')}
      ${kpiCell('Polls conducted', fmt(k.totalPolls), 'Across scope')}
    </div>
    <div class="pg-block">
      <h3 class="pg-sec">First day vs last day${flCycle ? ` · ${esc(flCycle)}` : ''}</h3>
      <p class="pg-sub">Part A attendance on Day 1 and on the final day. The figure above each pair is retention.${o.cycle === 'All' && flCycle ? ' Showing the latest cycle.' : ''}</p>
      ${fl.labels.length ? chartBox('r-fl', 330) : empty('Needs Day 1 and a later day for the same subject.')}
    </div>
    <div class="pg-block">
      <h3 class="pg-sec">Inside a class</h3>
      <p class="pg-sub">Average attendance at each part, and the share of Part A still watching.</p>
      ${journey.length > 1 ? chartBox('r-journey', 250) : empty('Single part classes.')}
    </div>`);

  const rt = D.retentionBySubject(data);
  const polls = D.pollsBySubject(data);
  const p2 = page('Attendance', 'Retention & drop-off', o, `
    <div class="pg-block">
      <h3 class="pg-sec">Retention · subject × cycle</h3>
      <p class="pg-sub">Last-day Part A ÷ Day 1 Part A. Higher is better.</p>
      <div id="r-hm-ret">${rt.subjects.length ? '' : empty('Needs Day 1 and a later day.')}</div>
    </div>
    <div class="pg-block">
      <h3 class="pg-sec">Drop-off · subject × cycle</h3>
      <p class="pg-sub">(First part − last part) ÷ first part. Lower is better.</p>
      <div id="r-hm-drop">${dt.subjects.length ? '' : empty('Classes need 2+ parts.')}</div>
    </div>`);

  const p3 = polls.length ? page('Attendance', 'Polls', o, `
    <div class="pg-block">
      <h3 class="pg-sec">Polls by subject</h3>
      <p class="pg-sub">${fmt(polls.reduce((s, [, v]) => s + v, 0))} polls in live classes</p>
      ${chartBox('r-polls', 420)}
    </div>`) : null;

  const pct = v => `${Number(v).toFixed(1)}%`;
  const out = [
    { el: p1, toc, draw() {
      if (fl.labels.length) C.dumbbellChart('r-fl', $('#r-fl'), { labels: fl.labels, first: fl.first, last: fl.last, animation: false });
      if (journey.length > 1) {
        const b = journey[0].avg;
        C.lineChart('r-journey', $('#r-journey'), { labels: journey.map(p => p.part), series: [{ label: 'Average attendance', data: journey.map(p => Math.round(p.avg)), color: C.seriesColor(0) }], fill: true, curve: 0.35, animation: false });
        const ch = Chart.getChart('r-journey');
        ch.data.datasets[0].datalabels.formatter = (v, ctx) => (ctx.dataIndex === 0 ? Number(v).toLocaleString('en-IN') : `${Number(v).toLocaleString('en-IN')} · ${Math.round((v / b) * 100)}%`);
        ch.update('none');
      }
    } },
    { el: p2, toc, draw() {
      if (rt.subjects.length) C.heatmap($('#r-hm-ret'), { rows: rt.subjects, cols: rt.cycles, cells: rt.subjects.map((_, i) => rt.cycles.map(c => rt.series[c][i])), summary: { label: 'Avg', values: rt.avg.map(v => v || null) }, format: pct, ramp: 'blue', rowLabel: 'Subject' });
      if (dt.subjects.length) {
        const avgs = dt.subjects.map((_, i) => { const v = dt.cycles.map(c => dt.series[c][i]).filter(x => x !== null); return v.length ? D.average(v) : null; });
        C.heatmap($('#r-hm-drop'), { rows: dt.subjects, cols: dt.cycles, cells: dt.subjects.map((_, i) => dt.cycles.map(c => dt.series[c][i])), summary: { label: 'Avg', values: avgs }, format: pct, ramp: 'orange', rowLabel: 'Subject', higherIsBetter: false });
      }
    } },
  ];
  if (p3) out.push({ el: p3, toc, draw() { C.barChart('r-polls', $('#r-polls'), { labels: polls.map(p => p[0]), data: polls.map(p => p[1]), label: 'Polls', color: C.seriesColor(2), animation: false }); } });
  return out;
}

function subjectTablePages(o, data, parts) {
  const toc = 'Subject detail';
  if (!data.length) return [];
  const subjects = D.uniq(data.map(r => r.Subject)).sort();
  const rows = subjects.map(s => {
    const d = data.filter(r => r.Subject === s);
    const k = D.attendanceKPIs(d, parts);
    return { s, n: d.length, peak: k.peak, drop: k.singlePart ? null : k.drop, ret: k.multiDay ? k.retention : null, polls: k.totalPolls };
  });
  const perPage = 30, out = [];
  for (let i = 0; i < rows.length; i += perPage) {
    const chunk = rows.slice(i, i + perPage);
    out.push({ toc, el: page('Attendance', i ? 'Subject detail (continued)' : 'Subject detail', o, `
      <p class="pg-sub" style="margin-bottom:12px">Every subject in scope. Retention is last-day Part A ÷ Day 1 Part A; drop-off is first part to last part within a class.</p>
      <table class="pg-table">
        <thead><tr><th>Subject</th><th class="r">Records</th><th class="r">Peak</th><th class="r">Drop-off</th><th>Retention</th><th class="r">Polls</th></tr></thead>
        <tbody>${chunk.map(r => `<tr>
          <td>${esc(r.s)}</td><td class="r">${fmt(r.n)}</td><td class="r">${r.peak ? fmt(r.peak) : '—'}</td>
          <td class="r">${r.drop === null ? 'Single part' : `${r.drop}%`}</td>
          <td>${r.ret === null ? '<span style="color:var(--ink-3)">—</span>' : `<span class="meter"><i style="width:${Math.min(100, r.ret)}%"></i></span>${r.ret}%`}</td>
          <td class="r">${fmt(r.polls)}</td></tr>`).join('')}</tbody>
      </table>`) });
  }
  return out;
}

// ── Issues ───────────────────────────────────────────────────
function issuesPage(o) {
  const toc = 'Issues';
  const courses = D.uniq(D.validIssues(S.iss).map(r => D.clean(r.Course)));
  const rows = D.filterIssues(S.iss, { course: courses.includes(o.course) ? o.course : 'all', cycle: o.cycle === 'All' ? 'all' : o.cycle, from: o.from, to: o.to });
  if (!rows.length) return { toc, el: page('Operations', 'Issues', o, empty('No issues reported for this scope.')) };
  const s = D.issuesSummary(rows);
  const top = t => (t ? esc(t[0]) : '—'), meta = t => (t ? `${t[1]} issues` : '');
  const cats = Object.entries(s.category).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const catTotal = Object.values(s.category).reduce((a, b) => a + b, 0);
  const t = D.issuesTimeline(rows, 'monthly');
  const el = page('Operations', 'Issues', o, `
    <div class="pg-kpis" style="--n:4">
      ${kpiCell('Total issues', fmt(s.total), 'Reported in scope')}
      ${kpiCell('Top category', top(s.topCategory), meta(s.topCategory))}
      ${kpiCell('Most affected faculty', top(s.topFaculty), meta(s.topFaculty))}
      ${kpiCell('Most common place', top(s.topPlace), meta(s.topPlace))}
    </div>
    <div class="pg-block">
      <h3 class="pg-sec">Issues by category</h3>
      <p class="pg-sub">Top ${cats.length} categories with their share of all issues</p>
      ${chartBox('r-cat', 340)}
    </div>
    <div class="pg-block">
      <h3 class="pg-sec">Issues per month</h3>
      <p class="pg-sub">Number of issues reported each month</p>
      ${t.labels.length ? chartBox('r-time', 260) : empty('No dated issues.')}
    </div>`);
  return { toc, el, draw() {
    C.barChart('r-cat', $('#r-cat'), { labels: cats.map(c => c[0]), data: cats.map(c => c[1]), horizontal: true, color: C.seriesColor(0), yFormat: v => String(v), animation: false });
    const ch = Chart.getChart('r-cat');
    ch.data.datasets[0].datalabels.formatter = v => `${v} · ${((v / catTotal) * 100).toFixed(0)}%`; ch.update('none');
    if (t.labels.length) C.lineChart('r-time', $('#r-time'), { labels: t.labels, series: [{ label: 'Issues', data: t.values, color: C.seriesColor(1) }], fill: true, curve: 0.3, yFormat: v => String(v), animation: false });
  } };
}

// ── Ratings ──────────────────────────────────────────────────
function ratingsPage(o) {
  const toc = 'Ratings';
  const fromD = o.from ? new Date(o.from + 'T00:00:00') : null, toD = o.to ? new Date(o.to + 'T23:59:59') : null;
  const rows = S.rat.filter(r => {
    if (D.clean(r.Course) !== o.course) return false;
    if (o.subject !== 'all' && r.Subject !== o.subject) return false;
    if (fromD || toD) { const d = D.parseDate(r.Date); if (!d || (fromD && d < fromD) || (toD && d > toD)) return false; }
    return true;
  });
  if (!rows.length) return { toc, el: page('Student feedback', 'Ratings', o, empty('No ratings for this scope.')) };
  const s = D.ratingsSummary(rows);
  const fac = D.topFacultyRatings(rows);
  const comp = D.subjectComparison(rows).slice(0, 12);
  const lo = Math.min(...comp.map(c => c.avg)), hi = Math.max(...comp.map(c => c.avg));
  const el = page('Student feedback', 'Ratings', o, `
    <div class="pg-kpis" style="--n:5">
      ${kpiCell('Average rating', `${s.avg.toFixed(2)}<small> / 5</small>`, `${fmt(s.total)} sessions`)}
      ${kpiCell('Sessions rated', fmt(s.total), 'Live classes')}
      ${kpiCell('Student responses', D.formatK(s.students), 'Ratings given')}
      ${kpiCell('Top performer', s.top ? esc(s.top.name) : '—', s.top ? `${s.top.avg.toFixed(2)} average` : '')}
      ${kpiCell('Needs attention', s.lowest ? esc(s.lowest.name) : '—', s.lowest ? `${s.lowest.avg.toFixed(2)} average` : '')}
    </div>
    <div class="pg-block">
      <h3 class="pg-sec">Top rated faculty</h3>
      <p class="pg-sub">Average rating, top ${fac.length}. Axis starts near the lowest value to show the differences.</p>
      ${chartBox('r-fac', 300)}
    </div>
    <div class="pg-block">
      <h3 class="pg-sec">Subject comparison</h3>
      <p class="pg-sub">Average rating per subject, with sessions and student responses</p>
      <ol class="pg-rank">${comp.map((c, i) => `<li><span class="n">${i + 1}</span><span>${esc(c.subject)}<small>${c.count} sessions · ${D.formatK(c.students)} responses</small></span>
        <span class="bar"><i style="width:${hi === lo ? 100 : 25 + ((c.avg - lo) / (hi - lo)) * 75}%"></i></span><span class="v">${c.avg.toFixed(2)}</span></li>`).join('')}</ol>
    </div>`);
  const min = Math.min(...fac.map(f => f.avg)), max = Math.max(...fac.map(f => f.avg)), range = max - min || 0.5;
  return { toc, el, draw() {
    C.barChart('r-fac', $('#r-fac'), { labels: fac.map(f => f.name.replace(/^Dr\.?\s*/, '')), data: fac.map(f => +f.avg.toFixed(2)), horizontal: true, color: C.seriesColor(0), yFormat: v => Number(v).toFixed(2), yMin: Math.max(0, +(min - range * 0.2).toFixed(2)), yMax: Math.min(5, +(max + range * 0.08).toFixed(2)), animation: false });
  } };
}

// ── Photos ───────────────────────────────────────────────────
function photoPages(o) {
  const toc = 'Appreciation messages';
  const name = id => S.faculty.find(f => f.id === id)?.name || D.prettyFacultyId(id);
  const list = S.shots.filter(s =>
    s.course === o.course && (o.cycle === 'All' || s.cycle === o.cycle) && (o.day === 'all' || s.day === o.day) && (o.faculty === 'all' || s.facultyId === o.faculty))
    .sort((a, b) => name(a.facultyId).localeCompare(name(b.facultyId)) || a.timestamp - b.timestamp);
  $('#photo-count').textContent = `${list.length} photo${list.length === 1 ? '' : 's'} match`;
  if (!list.length) return [{ toc, el: page('Student messages', 'Appreciation', o, empty('No appreciation photos for this scope.')) }];
  const per = o.per, cols = per === 4 ? 2 : 3, rows = Math.ceil(per / cols);
  const gridH = 1123 - 56 - 92 - 80; // top padding, header, footer zone
  const out = [];
  for (let i = 0; i < list.length; i += per) {
    const chunk = list.slice(i, i + per);
    const n = Math.floor(i / per) + 1, total = Math.ceil(list.length / per);
    out.push({ toc, el: page('Student messages', total > 1 ? `Appreciation (${n} of ${total})` : 'Appreciation', o, `
      <div class="ph-grid" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},${Math.floor((gridH - (rows - 1) * 14) / rows)}px)">
        ${chunk.map(s => `<figure class="ph" style="margin:0">
          <div class="ph-img"><img src="${esc(s.url)}" alt="" crossorigin="anonymous"></div>
          <figcaption class="ph-cap"><b>${esc(name(s.facultyId))}</b><span>${esc([s.cycle, s.day].filter(Boolean).join(' · '))} · ${esc(new Date(s.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))}</span></figcaption>
        </figure>`).join('')}
      </div>`) });
  }
  return out;
}

// ── PDF ──────────────────────────────────────────────────────
async function download() {
  const btn = $('#rb-download');
  btn.disabled = true;
  const ov = $('#rb-overlay'), bar = $('#rb-ov-bar'), text = $('#rb-ov-text');
  ov.classList.remove('hidden');
  const box = $('#rb-pages');
  try {
    await document.fonts.ready;
    await Promise.all($$('img', box).map(img => (img.complete ? null : new Promise(r => { img.onload = img.onerror = r; }))));
    box.classList.add('capturing');
    await sleep(120);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
    const pages = $$('.a4', box);
    for (let i = 0; i < pages.length; i++) {
      text.textContent = `Page ${i + 1} of ${pages.length}`;
      bar.style.width = `${Math.round((i / pages.length) * 100)}%`;
      const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, scrollX: 0, scrollY: -window.scrollY, windowWidth: 1400 });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, H, undefined, 'FAST');
    }
    bar.style.width = '100%';
    const o = opts();
    pdf.save(`DBMCI_${o.course.replace(/[^\w]+/g, '_')}_${o.cycle === 'All' ? 'All_cycles' : o.cycle.replace(/\s+/g, '_')}_${D.isoDate(new Date())}.pdf`);
    FB.logActivity('PDF exported', `${o.course} · ${o.cycle} · ${pages.length} pages`);
    toast('PDF downloaded', 'success');
  } catch (e) {
    console.error(e);
    toast('Could not create the PDF. Try fewer photos per report.', 'error');
  } finally {
    box.classList.remove('capturing');
    fitPreview();
    ov.classList.add('hidden');
    btn.disabled = false;
  }
}
