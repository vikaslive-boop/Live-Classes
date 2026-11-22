// ─────────────────────────────────────────────────────────────
// DBMCI One · data layer
// Sheet loading, CSV parsing and every formula used on the
// dashboard and in the PDF report. The calculations are the same
// ones the previous dashboard used; they now read cycles, days,
// courses and "Part" columns from the sheet instead of fixed lists.
// ─────────────────────────────────────────────────────────────

export const SHEET_BASE =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRuZjJioc2H2E45MTQ8gOh4M4kz7ixZxPa0OI2j5ep7uAPS5Mdfh52fa1nIb7qf0MCoW6gejn2Uj9PR/pub';

export const SHEET_URLS = {
  attendance: `${SHEET_BASE}?gid=1875996986&single=true&output=csv`,
  issues:     `${SHEET_BASE}?gid=287366765&single=true&output=csv`,
  ratings:    `${SHEET_BASE}?gid=706831583&single=true&output=csv`,
};

// Used only if Firestore has no faculty list yet.
export const DEFAULT_FACULTY = [
  ['dr-abdul-naseer', 'Dr. Abdul Naseer'], ['dr-abhirami', 'Dr. Abhirami'], ['dr-aditya-gupta', 'Dr. Aditya Gupta'],
  ['dr-ajay-yadav', 'Dr. Ajay Yadav'], ['dr-aman-setia', 'Dr. Aman Setia'], ['dr-amit-jain', 'Dr. Amit Jain'],
  ['dr-ashish-kumar', 'Dr. Ashish Kumar'], ['dr-ashwani-kumar', 'Dr. Ashwani Kumar'], ['dr-jai-arora', 'Dr. Jai Arora'],
  ['dr-niha-aggarwal', 'Dr. Niha Aggarwal'], ['dr-praveen-gupta', 'Dr. Praveen Kr Gupta'], ['dr-rajat-jain', 'Dr. Rajat Jain'],
  ['dr-rajeev-shetty', 'Dr. Rajeev Shetty'], ['dr-ramyasree', 'Dr. Ramyasree'], ['dr-sanjay-aggarwal', 'Dr. Sanjay Aggarwal'],
  ['dr-saurabh-bhatia', 'Dr. Saurabh Bhatia'], ['dr-saurabh-jindal', 'Dr. Saurabh Jindal'], ['dr-sushil-vijay', 'Dr. Sushil Vijay'],
  ['dr-thameem-saif', 'Dr. Thameem Saif'], ['dr-vishwajeet-singh', 'Dr. Vishwajeet Singh'], ['dr-vivekanandan', 'Dr. Vivekanandan'],
].map(([id, name]) => ({ id, name }));

export const prettyFacultyId = id => String(id).split('-').map((w, i) => (i === 0 && w === 'dr' ? 'Dr.' : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

// Saved list + anyone who has photos, so no photo is ever orphaned.
export function mergeFaculty(list, shots) {
  const base = (list || DEFAULT_FACULTY).map(f => ({ ...f }));
  const known = new Set(base.map(f => f.id));
  uniq(shots.map(s => s.facultyId)).forEach(id => { if (!known.has(id)) base.push({ id, name: prettyFacultyId(id), unlisted: true }); });
  return base;
}

// ── Appreciation photos: old + new storage formats ───────────
// Old format: facultyScreenshots/{facultyId} holds a list of photos inside one
// document. Any list field whose items have a `url` is read, whatever it is called.
export function flattenLegacy(docs) {
  const out = [];
  for (const { id, data } of docs) {
    for (const [field, value] of Object.entries(data || {})) {
      const list = Array.isArray(value) ? value : (value && typeof value === 'object' ? Object.values(value) : []);
      list.forEach((item, i) => {
        if (item && typeof item === 'object' && typeof item.url === 'string' && item.url) {
          out.push({
            id: `legacy_${id}_${field}_${i}`, facultyId: item.facultyId || id,
            url: item.url, course: item.course || '', cycle: item.cycle || '', day: item.day || '',
            timestamp: Number(item.timestamp) || 0, legacy: true,
          });
        }
      });
    }
  }
  return out;
}

// New-format photos win; an old photo is dropped only if the same faculty already
// has a new-format photo with the same timestamp (i.e. it was copied over before).
export function mergeShots(current, legacy) {
  const seen = new Set(current.map(s => `${s.facultyId}|${s.timestamp}`));
  const extra = legacy.filter(s => !seen.has(`${s.facultyId}|${s.timestamp}`));
  return [...current, ...extra].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

// ── Loading ──────────────────────────────────────────────────
export async function fetchSheet(name) {
  const res = await fetch(SHEET_URLS[name], { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load the ${name} sheet (HTTP ${res.status})`);
  return csvToRows(await res.text());
}

// RFC-4180 CSV parser: handles quoted commas, quoted line breaks,
// escaped quotes ("") and Windows line endings.
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Same rule as before: only rows that have both a Date and a Course are kept.
export function csvToRows(text) {
  const grid = parseCSV(text.replace(/^﻿/, ''));
  if (!grid.length) return [];
  const headers = grid[0].map(h => h.trim());
  const out = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells.some(c => c.trim())) continue;
    const obj = {};
    headers.forEach((h, idx) => { if (h) obj[h] = (cells[idx] ?? '').trim(); });
    if (obj.Date && obj.Course) out.push(obj);
  }
  return out;
}

// ── Small helpers ────────────────────────────────────────────
export const clean = s => String(s ?? '').trim().replace(/['"]/g, '').replace(/\s+/g, ' ');
export const numIn = s => { const m = String(s ?? '').match(/\d+/); return m ? parseInt(m[0], 10) : 0; };
export const byNumber = (a, b) => numIn(a) - numIn(b) || String(a).localeCompare(String(b));
export const uniq = arr => [...new Set(arr.filter(v => v !== undefined && v !== null && String(v).trim() !== ''))];
export const average = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
export const isUnknown = v => !v || v === '-' || v.toLowerCase() === 'unknown';

export function dayNum(day) { return numIn(day); }

// Dates: DD-MM-YYYY and DD/MM/YYYY (the sheet's format), YYYY-MM-DD,
// and anything else the browser understands as a fallback.
export function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "Part A", "Part B" … read from the sheet header, so a new Part column just works.
export function partColumns(rows) {
  const cols = new Set();
  rows.slice(0, 50).forEach(r => Object.keys(r).forEach(k => { if (/^part\s+[a-z]$/i.test(k)) cols.add(k); }));
  const list = [...cols].sort((a, b) => a.localeCompare(b));
  return list.length ? list : ['Part A', 'Part B', 'Part C', 'Part D', 'Part E', 'Part F', 'Part G', 'Part H'];
}

// Order a list by first appearance in the sheet (courses keep the sheet's order).
export const inSheetOrder = (rows, key) => uniq(rows.map(r => clean(r[key])));
export const cyclesOf = rows => uniq(rows.map(r => r.Cycle && clean(r.Cycle))).sort(byNumber);

// ═════════════════════════════════════════════════════════════
// ATTENDANCE
// ═════════════════════════════════════════════════════════════
export function filterAttendance(rows, { course, subjects = [], cycle = 'All', faculty = 'all', from = '', to = '' }) {
  const fromD = from ? new Date(from + 'T00:00:00') : null;
  const toD = to ? new Date(to + 'T23:59:59.999') : null;
  return rows.filter(r => {
    if (clean(r.Course) !== course) return false;
    if (subjects.length && !subjects.includes(r.Subject)) return false;
    if (cycle !== 'All' && clean(r.Cycle) !== cycle) return false;
    if (faculty !== 'all' && clean(r.Faculty) !== faculty) return false;
    if (fromD || toD) {
      const d = parseDate(r.Date);
      if (!d) return false;
      if (fromD && d < fromD) return false;
      if (toD && d > toD) return false;
    }
    return true;
  });
}

export function getPeakAttendance(data, parts) {
  let best = 0, bestSubject = 'N/A';
  data.forEach(r => parts.forEach(p => {
    const v = Number(r[p]);
    if (!isNaN(v) && v > best) { best = v; bestSubject = r.Subject; }
  }));
  return { best, bestSubject };
}

// Grouped by Date; the first and last part values of each date give the drop.
export function getDropOffRate(data, parts) {
  const grouped = {};
  data.forEach(r => { (grouped[r.Date] ||= []).push(r); });
  const percents = [];
  Object.values(grouped).forEach(rows => {
    const vals = [];
    parts.forEach(col => rows.forEach(r => { if (r[col] && !isNaN(r[col])) vals.push(Number(r[col])); }));
    if (vals.length > 1) percents.push(((vals[0] - vals[vals.length - 1]) / vals[0]) * 100);
  });
  if (!percents.length) return 0;
  return (percents.reduce((a, b) => a + b) / percents.length).toFixed(1);
}

// Part A on Day 1 vs Part A on the last day, per subject + cycle, averaged.
export function getRetentionRate(data) {
  if (!data.length) return 0;
  const subjects = {};
  data.forEach(r => {
    const day = dayNum(r.Day), partA = Number(r['Part A']);
    if (!partA || isNaN(partA)) return;
    const key = r.Subject + '_' + r.Cycle;
    subjects[key] ||= { first: [], last: [], maxDay: 0 };
    subjects[key].maxDay = Math.max(subjects[key].maxDay, day);
    if (day === 1) subjects[key].first.push(partA);
  });
  data.forEach(r => {
    const day = dayNum(r.Day), partA = Number(r['Part A']);
    const s = subjects[r.Subject + '_' + r.Cycle];
    if (s && day === s.maxDay && partA && !isNaN(partA)) s.last.push(partA);
  });
  const allFirst = [], allLast = [];
  Object.values(subjects).forEach(s => {
    if (s.first.length && s.last.length) { allFirst.push(average(s.first)); allLast.push(average(s.last)); }
  });
  if (!allFirst.length) return 0;
  return ((average(allLast) / average(allFirst)) * 100).toFixed(1);
}

// True when every class date has at most one Part with a value.
export function isSinglePartClass(data, parts) {
  if (!data.length) return false;
  const grouped = {};
  data.forEach(r => { (grouped[r.Date] ||= []).push(r); });
  for (const rows of Object.values(grouped)) {
    const used = new Set();
    parts.forEach(col => rows.forEach(r => { const v = Number(r[col]); if (!isNaN(v) && v > 0) used.add(col); }));
    if (used.size > 1) return false;
  }
  return true;
}

// Multi-day courses (Day 1 … Day N) show retention; single-day courses show drop-off.
export const hasDayStructure = data => data.some(r => dayNum(r.Day) > 1);

export function attendanceKPIs(data, parts) {
  const peak = getPeakAttendance(data, parts);
  const singlePart = isSinglePartClass(data, parts);
  const totalPolls = data.reduce((s, r) => { const x = Number(r['Total Polls']); return s + (isNaN(x) ? 0 : x); }, 0);
  const multiDay = hasDayStructure(data);
  return {
    sessions: data.length,
    peak: peak.best, peakSubject: peak.bestSubject,
    singlePart,
    drop: singlePart ? null : getDropOffRate(data, parts),
    totalPolls,
    multiDay,
    retention: multiDay ? getRetentionRate(data) : null,
  };
}

// Drop trend: average drop % per subject, one series per cycle.
export function dropTrend(data, parts) {
  const cycles = cyclesOf(data);
  const groups = {};
  data.forEach(r => {
    const sub = r.Subject, cyc = clean(r.Cycle);
    if (!sub || !cyc) return;
    groups[sub] ||= {}; groups[sub][cyc] ||= [];
    const vals = [];
    parts.forEach(c => { const v = Number(r[c]); if (!isNaN(v) && v > 0) vals.push(v); });
    if (vals.length > 1) groups[sub][cyc].push(((vals[0] - vals[vals.length - 1]) / vals[0]) * 100);
  });
  const subjects = [], series = Object.fromEntries(cycles.map(c => [c, []]));
  Object.entries(groups).forEach(([sub, byCyc]) => {
    if (!cycles.some(c => byCyc[c]?.length)) return;
    subjects.push(sub);
    cycles.forEach(c => { const d = byCyc[c] || []; series[c].push(d.length ? average(d) : null); });
  });
  return { subjects, cycles, series };
}

export function calculateRetention(f, l) { return (!f || !l) ? 0 : (l / f) * 100; }

// Retention per subject: (last-day Part A ÷ Day-1 Part A) per cycle + the average across cycles.
export function retentionBySubject(data) {
  const cycles = cyclesOf(data);
  const holder = {};
  data.forEach(r => {
    const sub = r.Subject, cyc = clean(r.Cycle);
    if (!sub || !cyc) return;
    const partA = Number(r['Part A']), day = dayNum(r.Day);
    holder[sub] ||= {}; holder[sub][cyc] ||= {};
    const g = holder[sub][cyc];
    if (day === 1 && !g.first) g.first = partA;
    if (!g.lastDay || day > g.lastDay) { g.last = partA; g.lastDay = day; }
  });
  const subjects = [], avg = [], series = Object.fromEntries(cycles.map(c => [c, []]));
  Object.entries(holder).forEach(([sub, byCyc]) => {
    const ret = {};
    let has = false;
    cycles.forEach(c => {
      const g = byCyc[c];
      if (g && g.first && g.last) { ret[c] = calculateRetention(g.first, g.last); has = true; } else ret[c] = 0;
    });
    if (!has) return;
    subjects.push(sub);
    const valid = Object.values(ret).filter(v => v > 0);
    avg.push(valid.length ? +average(valid).toFixed(1) : 0);
    cycles.forEach(c => series[c].push(ret[c] ? +ret[c].toFixed(1) : null));
  });
  return { subjects, cycles, avg, series };
}

// First day vs last day Part A, per subject (and cycle when several are shown).
export function firstVsLast(data, cycleFilter = 'All') {
  const cycles = cyclesOf(data);
  const holder = {};
  data.forEach(r => {
    const sub = r.Subject, cyc = clean(r.Cycle), partA = Number(r['Part A']), day = dayNum(r.Day);
    if (!partA || isNaN(partA) || !sub || !cyc) return;
    const key = sub + '_' + cyc;
    holder[key] ||= { subject: sub, cycle: cyc, first: 0, last: 0, maxDay: 0 };
    holder[key].maxDay = Math.max(holder[key].maxDay, day);
    if (day === 1 && holder[key].first === 0) holder[key].first = partA;
  });
  data.forEach(r => {
    const h = holder[r.Subject + '_' + clean(r.Cycle)];
    const partA = Number(r['Part A']);
    if (h && dayNum(r.Day) === h.maxDay && partA && !isNaN(partA)) h.last = partA;
  });
  const items = Object.values(holder).filter(i => i.first > 0 && i.last > 0);
  const show = cycleFilter !== 'All' ? items.filter(i => i.cycle === cycleFilter) : items;
  const multi = cycleFilter === 'All' && cycles.length > 1;
  show.sort((a, b) => byNumber(a.cycle, b.cycle) || a.subject.localeCompare(b.subject));
  return {
    labels: show.map(i => multi ? `${i.subject} · ${shortCycle(i.cycle)}` : i.subject),
    first: show.map(i => i.first),
    last: show.map(i => i.last),
    cycles: show.map(i => i.cycle),
  };
}

// Average attendance at each part of a class (Part A, B, C…), counting only parts that ran.
export function classJourney(data, parts) {
  return parts.map(p => {
    const vals = data.map(r => Number(r[p])).filter(v => !isNaN(v) && v > 0);
    return { part: p, avg: vals.length ? average(vals) : 0, n: vals.length };
  }).filter(x => x.n > 0);
}

export const hasColumn = (rows, col) => rows.slice(0, 50).some(r => col in r);

export const shortCycle = c => (/\d/.test(c) ? `C${numIn(c)}` : c);

export function pollsBySubject(data) {
  const totals = {};
  data.forEach(r => { const p = Number(r['Total Polls']); if (!isNaN(p)) totals[r.Subject] = (totals[r.Subject] || 0) + p; });
  return Object.entries(totals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}

// ═════════════════════════════════════════════════════════════
// ISSUES
// ═════════════════════════════════════════════════════════════
export const validIssues = rows => rows.filter(r => r.Date?.trim() && r.Course?.trim() && r.Category?.trim());

export function filterIssues(rows, { course = 'all', cycle = 'all', faculty = 'all', category = 'all', place = 'all', from = '', to = '' }) {
  const fromD = from ? new Date(from + 'T00:00:00') : null;
  const toD = to ? new Date(to + 'T23:59:59.999') : null;
  return validIssues(rows).filter(r => {
    if (course !== 'all' && clean(r.Course) !== course) return false;
    if (cycle !== 'all' && clean(r.Cycle) !== cycle) return false;
    if (faculty !== 'all' && clean(r.Faculty) !== faculty) return false;
    if (category !== 'all' && clean(r.Category) !== category) return false;
    if (place !== 'all' && clean(r.Place) !== place) return false;
    if (fromD || toD) {
      const d = parseDate(r.Date);
      if (!d) return false;
      if (fromD && d < fromD) return false;
      if (toD && d > toD) return false;
    }
    return true;
  });
}

function countBy(rows, key) {
  const c = {};
  rows.forEach(r => { const v = (r[key] || '').trim(); if (!isUnknown(v)) c[v] = (c[v] || 0) + 1; });
  return c;
}
const top = counts => Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || null;

export function issuesSummary(valid) {
  const category = countBy(valid, 'Category');
  const faculty = countBy(valid, 'Faculty');
  const place = countBy(valid, 'Place');
  return {
    total: valid.length,
    category, faculty, place,
    topCategory: top(category), topFaculty: top(faculty), topPlace: top(place),
  };
}

export function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayN = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayN);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Daily (last 10 days), weekly (last 12 weeks, uses the sheet's Week/Month columns
// when present) or monthly (all months).
export function issuesTimeline(valid, view) {
  const t = {};
  valid.forEach(r => {
    const dt = parseDate(r.Date);
    if (!dt) return;
    let key, label, sortKey;
    if (view === 'daily') {
      key = isoDate(dt);
      label = dt.toLocaleString('en', { month: 'short', day: 'numeric' });
      sortKey = key;
    } else if (view === 'weekly') {
      const week = r.Week || r.week || getWeekNumber(dt);
      const month = r.Month || r.month || dt.getMonth() + 1;
      const year = dt.getFullYear();
      key = `${year}-${String(month).padStart(2, '0')}-W${week}`;
      label = `Week ${week}`;
      sortKey = `${year}-${String(month).padStart(2, '0')}-${String(week).padStart(2, '0')}`;
    } else {
      const month = r.Month || r.month || dt.getMonth() + 1;
      const year = dt.getFullYear();
      key = `${year}-${String(month).padStart(2, '0')}`;
      label = new Date(year, month - 1, 1).toLocaleString('en', { month: 'short', year: 'numeric' });
      sortKey = key;
    }
    t[key] ||= { count: 0, label, sortKey };
    t[key].count++;
  });
  let sorted = Object.values(t).sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
  if (view === 'daily') sorted = sorted.slice(-10);
  if (view === 'weekly') sorted = sorted.slice(-12);
  return { labels: sorted.map(s => s.label), values: sorted.map(s => s.count) };
}

// ═════════════════════════════════════════════════════════════
// RATINGS
// ═════════════════════════════════════════════════════════════
const avgOf = list => list.reduce((a, b) => a + b, 0) / list.length;

export function filterRatings(rows, { course, subject = 'all', faculty = 'all', cycle = 'all', from = '', to = '' }) {
  const fromD = from ? new Date(from + 'T00:00:00') : null;
  const toD = to ? new Date(to + 'T23:59:59.999') : null;
  return rows.filter(r => {
    if (clean(r.Course) !== course) return false;
    if (subject !== 'all' && r.Subject !== subject) return false;
    if (faculty !== 'all' && clean(r.Faculty) !== faculty) return false;
    if (cycle !== 'all' && clean(r.Cycle) !== cycle) return false;
    if (fromD || toD) {
      const d = parseDate(r.Date);
      if (!d || (fromD && d < fromD) || (toD && d > toD)) return false;
    }
    return true;
  });
}

// Share of issues per place, largest first (for the segmented bar).
export function shareOf(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n, pct: total ? (n / total) * 100 : 0 }));
}

export function ratingsSummary(rows) {
  const total = rows.length;
  const avg = total ? +(rows.reduce((s, r) => s + parseFloat(r.Ratings || 0), 0) / total).toFixed(2) : 0;
  const students = rows.reduce((s, r) => s + (parseInt(r['Rating Counts'] || 0, 10) || 0), 0);
  const fac = {};
  rows.forEach(r => { (fac[r.Faculty] ||= []).push(parseFloat(r.Ratings || 0)); });
  const ranked = Object.entries(fac).map(([name, list]) => ({ name, avg: +avgOf(list).toFixed(2) })).sort((a, b) => b.avg - a.avg);
  return { total, avg, students, top: ranked[0] || null, lowest: ranked[ranked.length - 1] || null };
}

function avgByKey(rows, key) {
  const g = {};
  rows.forEach(r => { (g[r[key]] ||= []).push(parseFloat(r.Ratings || 0)); });
  return Object.entries(g).map(([name, list]) => ({ name, avg: avgOf(list), count: list.length })).sort((a, b) => b.avg - a.avg);
}
export const topFacultyRatings = rows => avgByKey(rows, 'Faculty').slice(0, 8);
export const subjectRatings = rows => avgByKey(rows, 'Subject').slice(0, 10);

export const RATING_BANDS = ['< 4.0', '4.0 – 4.24', '4.25 – 4.49', '4.50 – 4.74', '4.75 – 5.0'];
export function ratingDistribution(rows) {
  const d = [0, 0, 0, 0, 0];
  rows.forEach(r => {
    const x = parseFloat(r.Ratings || 0);
    if (x < 4.0) d[0]++;
    else if (x < 4.25) d[1]++;
    else if (x < 4.5) d[2]++;
    else if (x < 4.75) d[3]++;
    else if (x <= 5.0) d[4]++;
  });
  return d;
}

// Average rating, sessions and student responses per subject.
export function subjectComparison(rows) {
  const s = {};
  rows.forEach(r => {
    const subject = r.Subject?.trim() || 'Unknown';
    const rating = Number(r.Ratings), students = Number(r['Rating Counts']) || 0;
    s[subject] ||= { ratings: [], count: 0, students: 0 };
    if (!isNaN(rating) && rating > 0) s[subject].ratings.push(rating);
    s[subject].count++;
    s[subject].students += students;
  });
  return Object.entries(s)
    .map(([subject, v]) => ({ subject, avg: v.ratings.length ? avgOf(v.ratings) : 0, count: v.count, students: v.students }))
    .filter(x => x.avg > 0)
    .sort((a, b) => b.avg - a.avg);
}

export function ratingTrend(rows) {
  const m = {};
  rows.forEach(r => {
    const row = {};
    Object.keys(r).forEach(k => { row[k.trim().toLowerCase()] = r[k]; });
    let month = parseInt(row.month || 0, 10), year = parseInt(row.year || 0, 10);
    if ((!month || !year) && row.date) {
      const dt = parseDate(row.date);
      if (dt) { month = dt.getMonth() + 1; year = dt.getFullYear(); }
    }
    if (!month || month > 12 || !year) return;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    m[key] ||= { year, month, ratings: [] };
    const x = parseFloat(String(row.ratings || '').trim());
    if (!isNaN(x) && x > 0) m[key].ratings.push(x);
  });
  return Object.entries(m)
    .filter(([, v]) => v.ratings.length)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => ({
      label: new Date(v.year, v.month - 1, 1).toLocaleString('en', { month: 'short', year: 'numeric' }),
      avg: avgOf(v.ratings), count: v.ratings.length,
      min: Math.min(...v.ratings), max: Math.max(...v.ratings),
    }));
}

export const formatK = n => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n));
