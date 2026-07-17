import { store } from "../state.js";
import { escapeHtml } from "../utils/dom.js";

export function initAnalytics() {
  store.subscribe(topic => { if (topic === "events" || topic === "filters") render(); });
  render();
}

function getCss(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

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
  const rows = Object.values(counts).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...rows.map(r => r.n));
  root.innerHTML = rows.length ? rows.map(r => `
    <div class="bar-row"><span class="name">${escapeHtml(r.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.n / max * 100).toFixed(0)}%;background:${r.color}"></div></div>
      <span class="num">${r.n}</span></div>`).join("") : '<div class="empty-state">No data yet.</div>';
}

function renderSeverityDonut(events) {
  const canvas = document.getElementById("severityDonut");
  if (!canvas) return;
  const high = events.filter(e => e.severity === "HIGH").length;
  const medium = events.filter(e => e.severity === "MEDIUM").length;
  const low = events.filter(e => e.severity === "LOW").length;
  const total = Math.max(1, high + medium + low);

  drawDonut(canvas, [
    { value: high, color: getCss("--high") },
    { value: medium, color: getCss("--medium") },
    { value: low, color: getCss("--low") }
  ]);

  document.getElementById("severityLegend").innerHTML = `
    <div title="Titles mentioning deaths, casualties, explosions, terrorism, hostages, or mass-casualty language."><span class="sw" style="background:${getCss("--high")}"></span>High<b>${high}</b></div>
    <div title="Titles mentioning injuries, clashes, arrests, threats, warnings, or advisories."><span class="sw" style="background:${getCss("--medium")}"></span>Medium<b>${medium}</b></div>
    <div title="Everything else that matched a category but not a high/medium keyword."><span class="sw" style="background:${getCss("--low")}"></span>Low<b>${low}</b></div>`;
}

function renderCountryBars(events) {
  const root = document.getElementById("countryBars");
  if (!root) return;
  const counts = {};
  events.forEach(e => { if (e.country && e.country !== "Unknown") counts[e.country] = (counts[e.country] || 0) + 1; });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, ...rows.map(r => r[1]));
  root.innerHTML = rows.length ? rows.map(([c, n]) => `
    <div class="bar-row"><span class="name">${escapeHtml(c)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / max * 100).toFixed(0)}%;background:${getCss("--accent")}"></div></div>
      <span class="num">${n}</span></div>`).join("") : '<div class="empty-state">No country data yet.</div>';
}

function renderSourceBars(events) {
  const root = document.getElementById("sourceBars");
  if (!root) return;
  const counts = {};
  events.forEach(e => { counts[e.primaryDomain] = (counts[e.primaryDomain] || 0) + 1; });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, ...rows.map(r => r[1]));
  root.innerHTML = rows.length ? rows.map(([d, n]) => `
    <div class="bar-row"><span class="name">${escapeHtml(d)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / max * 100).toFixed(0)}%;background:${getCss("--low")}"></div></div>
      <span class="num">${n}</span></div>`).join("") : '<div class="empty-state">No source data yet.</div>';
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
}

function drawDonut(canvas, segments) {
  const ctx = setupCanvas(canvas);
  if (!ctx) return;
  const w = canvas.clientWidth, h = canvas.clientHeight || 160;
  const cx = w / 2, cy = h / 2;
  const rOuter = Math.max(6, Math.min(w, h) / 2 - 6);
  const rInner = rOuter * 0.6;
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  let start = -Math.PI / 2;
  ctx.clearRect(0, 0, w, h);
  segments.forEach(seg => {
    const angle = (seg.value / total) * Math.PI * 2;
    if (seg.value > 0) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rOuter, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
    }
    start += angle;
  });
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath(); ctx.arc(cx, cy, rInner, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

function drawLineChart(canvas, values) {
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

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0) return null; // canvas is hidden (wrong tab) - skip drawing, don't crash
  const h = rect.height || 160;
  canvas.width = rect.width * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
