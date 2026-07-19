import { store } from "../state.js";
import { escapeHtml } from "../utils/dom.js";
import { drillDownTo } from "../utils/drilldown.js";

export function initAnalytics() {
  store.subscribe(topic => { if (topic === "events" || topic === "filters") render(); });
  render();
}

/** Canvas-based charts (the severity donut, the trend line) only get their
 *  correct pixel dimensions if the canvas is actually visible (non-zero
 *  width) at the moment they're drawn. If the page loads on a different
 *  default tab, these canvases get drawn once while hidden behind
 *  display:none, silently produce nothing, and never redraw again until
 *  the next unrelated data/filter change happens to occur. Call this when
 *  the Analytics tab becomes visible (same pattern as onMapViewShown for
 *  the Map tab) so the charts always render correctly the moment you
 *  actually look at them. */
export function onAnalyticsViewShown() {
  render();
}

export function getCss(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

function render() {
  if (!store.data.loaded) return;
  const events = store.data.events;

  renderCategoryBars(events);
  renderSeverityDonut(events);
  renderCountryBars(events);
  renderSourceBars(events);
  renderTrendChart(events);
}

function renderCategoryBars(events) {
  const root = document.getElementById("categoryBars");
  if (!root) return;
  const counts = {};
  events.forEach(e => { counts[e.category] = counts[e.category] || { label: e.categoryLabel, color: e.categoryColor, n: 0 }; counts[e.category].n++; });
  const rows = Object.entries(counts).map(([id, r]) => ({ id, ...r })).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...rows.map(r => r.n));
  root.innerHTML = rows.length ? rows.map(r => `
    <div class="bar-row" data-drill-category="${escapeHtml(r.id)}" style="cursor:pointer;" title="${r.n} ${escapeHtml(r.label)} event${r.n === 1 ? "" : "s"} - click to view them">
      <span class="name">${escapeHtml(r.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.n / max * 100).toFixed(0)}%;background:${r.color}"></div></div>
      <span class="num">${r.n}</span></div>`).join("") : '<div class="empty-state">No data yet.</div>';

  root.querySelectorAll("[data-drill-category]").forEach(rowEl => {
    rowEl.addEventListener("click", () => drillDownTo({ category: rowEl.getAttribute("data-drill-category") }));
  });
}

function renderSeverityDonut(events) {
  const canvas = document.getElementById("severityDonut");
  if (!canvas) return;
  const high = events.filter(e => e.severity === "HIGH").length;
  const medium = events.filter(e => e.severity === "MEDIUM").length;
  const low = events.filter(e => e.severity === "LOW").length;
  const total = high + medium + low;
  const safeTotal = Math.max(1, total);
  const pct = n => total ? Math.round(n / safeTotal * 100) : 0;

  drawDonut(canvas, [
    { value: high, color: getCss("--high"), label: "High" },
    { value: medium, color: getCss("--medium"), label: "Medium" },
    { value: low, color: getCss("--low"), label: "Low" }
  ]);
  attachDonutTooltip(canvas, [
    { value: high, label: "High", pct: pct(high), severity: "HIGH" },
    { value: medium, label: "Medium", pct: pct(medium), severity: "MEDIUM" },
    { value: low, label: "Low", pct: pct(low), severity: "LOW" }
  ]);

  const legendRoot = document.getElementById("severityLegend");
  legendRoot.innerHTML = `
    <div data-drill-severity="HIGH" style="cursor:pointer;" title="${high} high-severity event${high === 1 ? "" : "s"} (${pct(high)}% of all events) - click to view them"><span class="sw" style="background:${getCss("--high")}"></span>High<b>${high}</b><span class="pct">${pct(high)}%</span></div>
    <div data-drill-severity="MEDIUM" style="cursor:pointer;" title="${medium} medium-severity event${medium === 1 ? "" : "s"} (${pct(medium)}% of all events) - click to view them"><span class="sw" style="background:${getCss("--medium")}"></span>Medium<b>${medium}</b><span class="pct">${pct(medium)}%</span></div>
    <div data-drill-severity="LOW" style="cursor:pointer;" title="${low} low-severity event${low === 1 ? "" : "s"} (${pct(low)}% of all events) - click to view them"><span class="sw" style="background:${getCss("--low")}"></span>Low<b>${low}</b><span class="pct">${pct(low)}%</span></div>`;

  legendRoot.querySelectorAll("[data-drill-severity]").forEach(elm => {
    elm.addEventListener("click", () => drillDownTo({ severity: elm.getAttribute("data-drill-severity") }));
  });

  renderTopHighSeverityCategories(events);
}

/** Fills the remaining vertical space in the Severity panel with an actual
 *  useful breakdown - which categories are driving the HIGH-severity count -
 *  instead of leaving dead space below a small chart. Real information, not
 *  decoration. */
function renderTopHighSeverityCategories(events) {
  const root = document.getElementById("severityTopCategories");
  if (!root) return;
  const highEvents = events.filter(e => e.severity === "HIGH");
  const counts = {};
  highEvents.forEach(e => { counts[e.category] = counts[e.category] || { label: e.categoryLabel, color: e.categoryColor, n: 0 }; counts[e.category].n++; });
  const rows = Object.entries(counts).map(([id, r]) => ({ id, ...r })).sort((a, b) => b.n - a.n).slice(0, 5);

  if (!rows.length) {
    root.innerHTML = "";
    return;
  }

  const max = Math.max(1, ...rows.map(r => r.n));
  root.innerHTML = `<div class="severity-breakdown-title">Top High-Severity Categories</div>` +
    rows.map(r => `
      <div class="bar-row" data-drill-category="${escapeHtml(r.id)}" data-drill-severity="HIGH" style="cursor:pointer;" title="${r.n} high-severity ${escapeHtml(r.label)} event${r.n === 1 ? "" : "s"} - click to view them">
        <span class="name">${escapeHtml(r.label)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(r.n / max * 100).toFixed(0)}%;background:${r.color}"></div></div>
        <span class="num">${r.n}</span></div>`).join("");

  root.querySelectorAll("[data-drill-category]").forEach(rowEl => {
    rowEl.addEventListener("click", () => drillDownTo({
      category: rowEl.getAttribute("data-drill-category"),
      severity: rowEl.getAttribute("data-drill-severity")
    }));
  });
}

function renderCountryBars(events) {
  const root = document.getElementById("countryBars");
  if (!root) return;
  const counts = {};
  events.forEach(e => { if (e.country && e.country !== "Unknown") counts[e.country] = (counts[e.country] || 0) + 1; });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, ...rows.map(r => r[1]));
  root.innerHTML = rows.length ? rows.map(([c, n]) => `
    <div class="bar-row" data-drill-country="${escapeHtml(c)}" style="cursor:pointer;" title="${n} event${n === 1 ? "" : "s"} in ${escapeHtml(c)} - click to view them">
      <span class="name">${escapeHtml(c)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / max * 100).toFixed(0)}%;background:${getCss("--accent")}"></div></div>
      <span class="num">${n}</span></div>`).join("") : '<div class="empty-state">No country data yet.</div>';

  root.querySelectorAll("[data-drill-country]").forEach(rowEl => {
    rowEl.addEventListener("click", () => drillDownTo({ country: rowEl.getAttribute("data-drill-country") }));
  });
}

function renderSourceBars(events) {
  const root = document.getElementById("sourceBars");
  if (!root) return;
  const counts = {};
  events.forEach(e => { counts[e.primaryDomain] = (counts[e.primaryDomain] || 0) + 1; });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, ...rows.map(r => r[1]));
  root.innerHTML = rows.length ? rows.map(([d, n]) => `
    <div class="bar-row" data-drill-source="${escapeHtml(d)}" style="cursor:pointer;" title="${n} event${n === 1 ? "" : "s"} from ${escapeHtml(d)} - click to view them">
      <span class="name">${escapeHtml(d)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / max * 100).toFixed(0)}%;background:${getCss("--low")}"></div></div>
      <span class="num">${n}</span></div>`).join("") : '<div class="empty-state">No source data yet.</div>';

  root.querySelectorAll("[data-drill-source]").forEach(rowEl => {
    rowEl.addEventListener("click", () => drillDownTo({ source: rowEl.getAttribute("data-drill-source") }));
  });
}

function renderTrendChart(events) {
  const canvas = document.getElementById("trendChart");
  if (!canvas) return;
  const days = 14;
  const buckets = Array.from({ length: days }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (days - 1 - i));
    return { date: d, count: 0 };
  });
  events.forEach(e => {
    const d = new Date(e.publishedAt); d.setHours(0, 0, 0, 0);
    const bucket = buckets.find(b => b.date.getTime() === d.getTime());
    if (bucket) bucket.count++;
  });
  drawLineChart(canvas, buckets.map(b => b.count));
  attachLineChartTooltip(canvas, buckets);
}

let activeDonutTooltipEl = null;

/** Hover tooltip directly on the donut ring itself - detects which colored
 *  segment the cursor is over (by angle from center, same start-angle
 *  convention as drawDonut) and shows its label/count/percentage. Without
 *  this, the only way to see a percentage was reading the legend text -
 *  hovering the actual visual ring showed nothing, which is the "the chart
 *  I'm looking at doesn't respond to me" problem. */
function attachDonutTooltip(canvas, segments) {
  if (!activeDonutTooltipEl) {
    activeDonutTooltipEl = document.createElement("div");
    activeDonutTooltipEl.style.cssText = "position:fixed;pointer-events:none;background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text);box-shadow:var(--shadow);z-index:1000;display:none;white-space:nowrap;";
    document.body.appendChild(activeDonutTooltipEl);
  }
  const tooltip = activeDonutTooltipEl;
  canvas._donutSegments = segments;

  if (canvas.dataset.donutTooltipBound === "true") return;
  canvas.dataset.donutTooltipBound = "true";

  canvas.addEventListener("mousemove", (e) => {
    const segs = canvas._donutSegments;
    if (!segs) return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const x = e.clientX - rect.left - cx;
    const y = e.clientY - rect.top - cy;
    const dist = Math.sqrt(x * x + y * y);
    const rOuter = Math.min(rect.width, rect.height) / 2 - 6;
    const rInner = rOuter * 0.62;

    if (dist < rInner || dist > rOuter) { tooltip.style.display = "none"; return; }

    let angle = Math.atan2(y, x) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;

    const total = Math.max(1, segs.reduce((s, x) => s + x.value, 0));
    const visible = segs.filter(s => s.value > 0);
    const gapAngle = 0.045;
    const totalGap = visible.length > 1 ? gapAngle * visible.length : 0;
    const availableAngle = Math.PI * 2 - totalGap;

    let cursor = 0;
    let found = null;
    for (const seg of visible) {
      const segAngle = (seg.value / total) * availableAngle;
      if (angle >= cursor && angle <= cursor + segAngle) { found = seg; break; }
      cursor += segAngle + gapAngle;
    }

    if (found) {
      tooltip.textContent = `${found.label}: ${found.value} event${found.value === 1 ? "" : "s"} (${found.pct}%)`;
      tooltip.style.left = `${e.clientX + 12}px`;
      tooltip.style.top = `${e.clientY - 28}px`;
      tooltip.style.display = "block";
      canvas.style.cursor = "pointer";
    } else {
      tooltip.style.display = "none";
      canvas.style.cursor = "default";
    }
  });

  canvas.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const x = e.clientX - rect.left - cx;
    const y = e.clientY - rect.top - cy;
    let angle = Math.atan2(y, x) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    const segs = canvas._donutSegments || [];
    const total = Math.max(1, segs.reduce((s, x) => s + x.value, 0));
    const visible = segs.filter(s => s.value > 0);
    const gapAngle = 0.045;
    const availableAngle = Math.PI * 2 - (visible.length > 1 ? gapAngle * visible.length : 0);
    let cursor = 0;
    for (const seg of visible) {
      const segAngle = (seg.value / total) * availableAngle;
      if (angle >= cursor && angle <= cursor + segAngle) { drillDownTo({ severity: seg.severity }); break; }
      cursor += segAngle + gapAngle;
    }
  });
}

export function drawDonut(canvas, segments) {
  const ctx = setupCanvas(canvas);
  if (!ctx) return;
  const w = canvas.clientWidth, h = canvas.clientHeight || 160;
  const cx = w / 2, cy = h / 2;
  const rOuter = Math.max(6, Math.min(w, h) / 2 - 6);
  const rInner = rOuter * 0.62;
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));

  // Small gap between segments - this is what separates a clean, modern
  // donut (Stripe/Chart.js style) from flat touching arcs. Gap size is
  // proportional to the circle's radius so it scales sensibly at any size.
  const gapAngle = 0.045;
  const visibleSegments = segments.filter(s => s.value > 0);
  const totalGap = visibleSegments.length > 1 ? gapAngle * visibleSegments.length : 0;
  const availableAngle = Math.PI * 2 - totalGap;

  ctx.clearRect(0, 0, w, h);
  let start = -Math.PI / 2;
  visibleSegments.forEach(seg => {
    const angle = (seg.value / total) * availableAngle;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, start + gapAngle / 2, start + angle - gapAngle / 2);
    ctx.arc(cx, cy, rInner, start + angle - gapAngle / 2, start + gapAngle / 2, true);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    start += angle + gapAngle;
  });
}

/** Exported so other modules (e.g. the Executive Summary panel) can draw a
 *  trend line without duplicating canvas setup/drawing code. */
export function drawLineChart(canvas, values) {
  const ctx = setupCanvas(canvas);
  if (!ctx) return;
  const w = canvas.clientWidth, h = canvas.clientHeight || 140;
  const pad = 10;
  const max = Math.max(1, ...values);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = getCss("--accent");
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - (v / max) * (h - pad * 2);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = getCss("--accent-bg");
  ctx.lineTo(w - pad, h - pad); ctx.lineTo(pad, h - pad); ctx.closePath(); ctx.fill();
}

let activeTooltipEl = null;

/** Attaches a hover tooltip to a line chart canvas - shows the exact date
 *  and count for whichever point the cursor is nearest to. Without this,
 *  a line chart is exactly the "eye-pleasing but useless" problem: a shape
 *  with no way to know what any point on it actually means. Reused by both
 *  the Analytics 14-day trend and the Executive Summary 7-day trend, since
 *  they share the same canvas-drawing approach. */
export function attachLineChartTooltip(canvas, buckets) {
  if (!activeTooltipEl) {
    activeTooltipEl = document.createElement("div");
    activeTooltipEl.style.cssText = "position:fixed;pointer-events:none;background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text);box-shadow:var(--shadow);z-index:1000;display:none;white-space:nowrap;";
    document.body.appendChild(activeTooltipEl);
  }
  const tooltip = activeTooltipEl;

  // Store the current bucket data ON the canvas element itself, so the
  // mousemove listener (bound only once, below) always reads fresh data on
  // every render instead of closing over whatever buckets existed the
  // first time this was called - otherwise the tooltip would silently show
  // stale counts after every data refresh past the first one.
  canvas._tooltipBuckets = buckets;

  if (canvas.dataset.tooltipBound === "true") return;
  canvas.dataset.tooltipBound = "true";

  canvas.addEventListener("mousemove", (e) => {
    const currentBuckets = canvas._tooltipBuckets;
    if (!currentBuckets) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pad = 10;
    const w = rect.width;
    const idx = Math.round(((x - pad) / (w - pad * 2)) * (currentBuckets.length - 1));
    const bucket = currentBuckets[Math.max(0, Math.min(currentBuckets.length - 1, idx))];
    if (!bucket) return;

    const dateLabel = bucket.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    tooltip.textContent = `${dateLabel}: ${bucket.count} event${bucket.count === 1 ? "" : "s"}`;
    tooltip.style.left = `${e.clientX + 12}px`;
    tooltip.style.top = `${e.clientY - 28}px`;
    tooltip.style.display = "block";
  });

  canvas.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
  });
}

export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  // Read size from the PARENT wrapper's actual layout box, not the canvas
  // element's own getBoundingClientRect() - the canvas's self-measurement
  // can latch onto a stale smaller value from an earlier render (e.g. one
  // that happened before the final CSS size settled) and then keep
  // re-confirming that same wrong size on every subsequent redraw. The
  // wrapper div's dimensions are set directly and explicitly in HTML/CSS,
  // so reading from it every time is reliable regardless of render timing.
  const parent = canvas.parentElement;
  const w = parent ? parent.clientWidth : canvas.clientWidth;
  const h = parent ? parent.clientHeight : (canvas.clientHeight || 160);
  if (w <= 0 || h <= 0) return null; // still genuinely hidden (wrong tab) - skip, don't crash
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
