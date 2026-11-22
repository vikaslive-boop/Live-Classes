// DBMCI One · charts
// Chart.js (global `Chart`, `ChartDataLabels`) for bars, lines and dumbbells,
// plus three HTML figures: heatmap grid, segmented bar and ring gauge.
// Every mark carries its value. Motion: bars grow from the baseline and lines
// rise into place one point after another; grids and segments fill in.

const SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark:  ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'],
};
// Sequential ramps (one hue, light → dark).
const RAMPS = {
  blue:   ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  orange: ['#fde4d8', '#fbc6ad', '#f6a07c', '#ee7b4f', '#d9612f', '#b44b1f', '#863613'],
};

let forcedMode = null; // the PDF report always renders light
export function forceMode(mode) { forcedMode = mode; }
const reduced = () => !forcedMode && matchMedia('(prefers-reduced-motion: reduce)').matches;

function mode() {
  if (forcedMode) return forcedMode;
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function token(name, fallback) {
  const el = forcedMode ? document.querySelector('.a4') || document.documentElement : document.documentElement;
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

export const seriesColor = i => SERIES[mode()][i % 8];
export const accent = () => SERIES[mode()][0];
export const neutralSeries = () => (mode() === 'dark' ? '#5b5e66' : '#c3c6cc');

function theme() {
  return {
    ink: token('--ink', '#16171a'), ink2: token('--ink-2', '#4a4c52'), ink3: token('--ink-3', '#7a7c82'),
    grid: token('--chart-grid', '#ecebe7'), surface: token('--surface', '#ffffff'), line: token('--line', '#e6e3dd'),
  };
}

const registry = new Map();
export function destroy(id) { registry.get(id)?.destroy(); registry.delete(id); }
export function destroyAll() { registry.forEach(c => c.destroy()); registry.clear(); }

const fmtNum = v => (typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toFixed(2)) : v);
const compact = v => (Math.abs(v) >= 10000 ? (v / 1000).toFixed(0) + 'K' : Number(v).toLocaleString('en-IN'));

function motion(kind, horizontal, enabled = true) {
  if (!enabled || reduced()) return { animation: false };
  const delay = ctx => (ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 45 + (ctx.datasetIndex || 0) * 120 : 0);
  if (kind === 'line') {
    return {
      animation: { duration: 700, easing: 'easeOutCubic', delay },
      animations: { y: { from: ctx => (ctx.type === 'data' ? ctx.chart.chartArea?.bottom : undefined), duration: 700, easing: 'easeOutCubic', delay } },
    };
  }
  return { animation: { duration: 650, easing: 'easeOutQuart', delay } };
}

function base(t, { legend, yFormat, yMin, yMax, horizontal, tooltipFormat, xRotate = true, animate = true, kind = 'bar' }) {
  const valueAxis = {
    min: yMin, max: yMax, beginAtZero: yMin === undefined, grace: '12%',
    grid: { color: t.grid, drawTicks: false }, border: { display: false },
    ticks: { color: t.ink3, padding: 8, callback: v => (yFormat ? yFormat(v) : compact(v)), maxTicksLimit: 6 },
  };
  const catAxis = {
    grid: { display: false }, border: { color: t.line },
    ticks: {
      color: t.ink2, padding: 6, autoSkip: false,
      maxRotation: horizontal ? 0 : (xRotate ? 45 : 0), minRotation: horizontal ? 0 : (xRotate ? 45 : 0),
      callback(v) { const l = this.getLabelForValue(v); return l.length > 26 ? l.slice(0, 25) + '…' : l; },
    },
  };
  return {
    responsive: true, maintainAspectRatio: false,
    ...motion(kind, horizontal, animate),
    indexAxis: horizontal ? 'y' : 'x',
    layout: { padding: { top: 22, right: horizontal ? 44 : kind === 'line' ? 34 : 10, left: kind === 'line' ? 16 : 2 } },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: legend ? {
        display: true, position: 'top', align: 'start',
        labels: { color: t.ink2, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', padding: 16 },
      } : { display: false },
      tooltip: {
        backgroundColor: t.surface, titleColor: t.ink, bodyColor: t.ink2, borderColor: t.line, borderWidth: 1,
        padding: 10, cornerRadius: 6, boxPadding: 4, usePointStyle: true,
        callbacks: { label: c => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${c.raw === null ? '—' : (tooltipFormat || yFormat || fmtNum)(c.raw)}` },
      },
      datalabels: { display: false },
    },
    scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
  };
}

function valueLabels(t, format, { align = 'end', anchor = 'end', size = 11 } = {}) {
  return {
    display: ctx => ctx.dataset.data[ctx.dataIndex] !== null && ctx.dataset.data[ctx.dataIndex] !== undefined,
    color: t.ink2, anchor, align, offset: 4, clamp: true, font: { size, weight: 600 },
    formatter: v => (v === null ? '' : format(v)),
  };
}

// Single-series line, every point labelled.
export function lineChart(id, canvas, { labels, series, yFormat, yMin, yMax, tooltipFormat, fill, animation, curve = 0 }) {
  destroy(id);
  const t = theme();
  const single = series.length === 1;
  const chart = new Chart(canvas, {
    type: 'line',
    plugins: [ChartDataLabels],
    data: {
      labels,
      datasets: series.map(s => ({
        label: s.label, data: s.data,
        borderColor: s.color, backgroundColor: s.color + '1f',
        fill: fill && single ? 'origin' : false,
        borderWidth: 2, tension: curve, spanGaps: true,
        pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: s.color, pointBorderColor: t.surface, pointBorderWidth: 2,
        datalabels: valueLabels(t, yFormat || fmtNum, { align: 'top', size: labels.length > 16 ? 9.5 : 11 }),
      })),
    },
    options: base(t, { legend: !single, yFormat, yMin, yMax, tooltipFormat, animate: animation !== false, kind: 'line' }),
  });
  registry.set(id, chart);
  return chart;
}

// Single-series bars, value at every bar end.
export function barChart(id, canvas, { labels, data, color, yFormat, horizontal, yMin, yMax, label = '', tooltipFormat, colors, animation, xRotate, labelFormat }) {
  destroy(id);
  const t = theme();
  const chart = new Chart(canvas, {
    type: 'bar',
    plugins: [ChartDataLabels],
    data: {
      labels,
      datasets: [{
        label, data,
        backgroundColor: colors || color || accent(),
        hoverBackgroundColor: colors || color || accent(),
        borderRadius: { topLeft: horizontal ? 0 : 4, topRight: 4, bottomRight: horizontal ? 4 : 0, bottomLeft: 0 },
        borderSkipped: false, maxBarThickness: 24, categoryPercentage: 0.72, barPercentage: 0.9,
        datalabels: valueLabels(t, labelFormat || yFormat || fmtNum),
      }],
    },
    options: base(t, { legend: false, yFormat, horizontal, yMin, yMax, tooltipFormat, animate: animation !== false, xRotate }),
  });
  registry.set(id, chart);
  return chart;
}

// Dumbbell: Day 1 and last-day dots joined by a thin bar; both values and the retention % labelled.
export function dumbbellChart(id, canvas, { labels, first, last, animation }) {
  destroy(id);
  const t = theme();
  const c1 = seriesColor(0), c2 = seriesColor(1);
  const tight = labels.length > 12;
  const point = (label, data, color, side) => ({
    type: 'line', label, data, showLine: false, order: 1,
    pointRadius: 6, pointHoverRadius: 8, pointBackgroundColor: color, pointBorderColor: t.surface, pointBorderWidth: 2,
    borderColor: color, backgroundColor: color,
    datalabels: tight ? { display: false } : {
      display: true, align: side, anchor: 'center', offset: 9, color: t.ink3, font: { size: 10, weight: 500 },
      formatter: v => Number(v).toLocaleString('en-IN'),
    },
  });
  const opts = base(t, { legend: true, animate: animation !== false, kind: 'line' });
  opts.plugins.legend.labels.filter = item => item.text !== 'Change';
  opts.plugins.tooltip.filter = item => item.dataset.label !== 'Change';
  opts.plugins.tooltip.callbacks.label = c => ` ${c.dataset.label}: ${Number(c.raw).toLocaleString('en-IN')}`;
  opts.plugins.tooltip.callbacks.footer = items => {
    const i = items[0]?.dataIndex;
    return i === undefined ? '' : `Retention ${((last[i] / first[i]) * 100).toFixed(1)}%`;
  };
  opts.plugins.tooltip.footerColor = t.ink;
  opts.layout.padding.top = 30;
  const chart = new Chart(canvas, {
    plugins: [ChartDataLabels],
    data: {
      labels,
      datasets: [
        point('Day 1', first, c1, 'left'),
        point('Last day', last, c2, 'right'),
        {
          type: 'bar', label: 'Change', order: 2,
          data: first.map((f, i) => [Math.min(f, last[i]), Math.max(f, last[i])]),
          backgroundColor: neutralSeries(), borderSkipped: false, borderRadius: 2, maxBarThickness: 3, barPercentage: 1,
          datalabels: {
            display: true, anchor: 'end', align: 'top', offset: 12, color: t.ink, font: { size: 11.5, weight: 600 },
            formatter: (_, ctx) => `${Math.round((last[ctx.dataIndex] / first[ctx.dataIndex]) * 100)}%`,
          },
        },
      ],
    },
    options: opts,
  });
  registry.set(id, chart);
  return chart;
}

// ── HTML figures ─────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Heatmap: rows × columns, every cell labelled. Optional summary column (e.g. average).
export function heatmap(el, { rows, cols, cells, format, ramp = 'blue', summary, rowLabel = '', higherIsBetter = true }) {
  const steps = RAMPS[ramp];
  const all = cells.flat().concat(summary?.values || []).filter(v => v !== null && v !== undefined && !isNaN(v));
  const min = Math.min(...all), max = Math.max(...all);
  const shade = v => {
    if (v === null || v === undefined || isNaN(v)) return null;
    const k = max === min ? 3 : Math.round(((v - min) / (max - min)) * (steps.length - 1));
    return { bg: steps[k], ink: k >= 3 ? '#ffffff' : '#16171a' };
  };
  const cell = (v, i, extra = '') => {
    const s = shade(v);
    return s
      ? `<td class="hm-cell${extra}" style="--bg:${s.bg};--fg:${s.ink};--d:${i * 18}ms" title="${esc(format(v))}">${esc(format(v))}</td>`
      : `<td class="hm-cell hm-none${extra}" style="--d:${i * 18}ms">–</td>`;
  };
  let n = 0;
  el.innerHTML = `
    <div class="hm-wrap"><table class="hm">
      <thead><tr><th>${esc(rowLabel)}</th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}${summary ? `<th class="hm-gap"></th><th class="hm-sum">${esc(summary.label)}</th>` : ''}</tr></thead>
      <tbody>${rows.map((r, ri) => `<tr><th>${esc(r)}</th>${cols.map((_, ci) => cell(cells[ri][ci], n++)).join('')}${summary ? '<td class="hm-gap"></td>' + cell(summary.values[ri], n++, ' hm-sum') : ''}</tr>`).join('')}</tbody>
    </table></div>
    <div class="hm-scale"><span>${esc(format(min))}</span><i style="background:linear-gradient(90deg,${steps.join(',')})"></i><span>${esc(format(max))}</span><em>${higherIsBetter ? 'Darker = better' : 'Darker = higher drop'}</em></div>`;
  requestAnimationFrame(() => el.querySelector('.hm')?.classList.add('in'));
}

// Segmented bar: one whole split into parts, labelled inside when there is room and in the key below.
export function segmentBar(el, items, { max = 6 } = {}) {
  let list = items.slice(0, max);
  if (items.length > max) {
    const rest = items.slice(max);
    list.push({ name: 'Other', n: rest.reduce((a, b) => a + b.n, 0), pct: rest.reduce((a, b) => a + b.pct, 0) });
  }
  const darkText = new Set([2, 3, 4]); // aqua, yellow, magenta read better with dark text
  el.innerHTML = `
    <div class="seg-bar">${list.map((s, i) => `<span style="--w:${s.pct}%;--c:${s.name === 'Other' ? neutralSeries() : seriesColor(i)};--fg:${darkText.has(i) || s.name === 'Other' ? '#16171a' : '#fff'};--d:${i * 80}ms" title="${esc(s.name)}: ${s.n} (${s.pct.toFixed(1)}%)">${s.pct >= 9 ? `${Math.round(s.pct)}%` : ''}</span>`).join('')}</div>
    <ul class="seg-key">${list.map((s, i) => `<li><i style="background:${s.name === 'Other' ? neutralSeries() : seriesColor(i)}"></i><b>${esc(s.name)}</b><span>${s.n.toLocaleString('en-IN')} · ${s.pct.toFixed(1)}%</span></li>`).join('')}</ul>`;
  requestAnimationFrame(() => el.querySelector('.seg-bar')?.classList.add('in'));
}

// Ring gauge (0–1). Animates from empty to the value.
export function ring(fraction, size = 56) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, fraction || 0));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fill" style="stroke-dasharray:${c};stroke-dashoffset:${c};--to:${c * (1 - f)}"/>
  </svg>`;
}
export function playRings(root = document) {
  root.querySelectorAll('.ring-fill').forEach(el => {
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.strokeDashoffset = el.style.getPropertyValue('--to'); }));
  });
}

// Count-up for KPI numbers: <span data-count="75.5" data-dec="1">75.5</span>
export function countUp(root = document) {
  if (reduced()) return;
  root.querySelectorAll('[data-count]').forEach(el => {
    const to = +el.dataset.count, dec = +(el.dataset.dec || 0);
    if (isNaN(to)) return;
    const t0 = performance.now(), dur = 800;
    const step = now => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = (to * e).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
