"use strict";

/* ============================================================
   Network Packet Tracer — minimum-latency routing via Dijkstra
   9-node ISP/backbone topology; edge weights = milliseconds.
   ============================================================ */

const NODE_R = 24;
const C = () => window.CTHEME?.c ?? {};

// Theme-aware link colours (canvas only — CSS handles legend)
const LINK_DARK  = { fiber:"#38bdf8", cable:"#a78bfa", wireless:"#f97316", local:"#34d399" };
const LINK_LIGHT = { fiber:"#1a73e8", cable:"#7c3aed", wireless:"#d97706", local:"#059669" };
const linkCol  = t => (window.CTHEME?.isLight() ? LINK_LIGHT : LINK_DARK)[t] ?? "#888";
const linkW    = t => ({ fiber:6, cable:4, wireless:3, local:3 }[t] ?? 3);

// ---- Network topology -------------------------------------------------------

const NODES = [
  { id:1, label:"Home PC",     icon:"💻",  x: 68, y:280 },
  { id:2, label:"Router",      icon:"📡",  x:200, y:280 },
  { id:3, label:"ISP-North",   icon:"🏢",  x:370, y:118 },
  { id:4, label:"ISP-South",   icon:"🔌",  x:370, y:442 },
  { id:5, label:"Backbone",    icon:"🌐",  x:512, y:280 },
  { id:6, label:"IX East",     icon:"🔗",  x:662, y:118 },
  { id:7, label:"Cloud",       icon:"☁️",  x:662, y:442 },
  { id:8, label:"CDN Edge",    icon:"⚡",  x:793, y:208 },
  { id:9, label:"Game Server", icon:"🎮",  x:843, y:372 },
];

const EDGES = [
  { from:1, to:2, weight: 1, type:"local",    name:"Ethernet"       },
  { from:2, to:3, weight: 8, type:"fiber",    name:"Fiber PoP-A"    },
  { from:2, to:4, weight:10, type:"cable",    name:"Cable PoP-B"    },
  { from:3, to:5, weight:14, type:"fiber",    name:"North Backbone"  },
  { from:4, to:5, weight:11, type:"cable",    name:"South Backbone"  },
  { from:3, to:6, weight:22, type:"fiber",    name:"Direct Peering"  },
  { from:5, to:6, weight:16, type:"fiber",    name:"Core–IX Link"   },
  { from:5, to:7, weight:18, type:"fiber",    name:"Cloud Connect"   },
  { from:4, to:7, weight:25, type:"wireless", name:"Wireless Bridge" },
  { from:6, to:8, weight: 5, type:"fiber",    name:"CDN Peering"    },
  { from:7, to:8, weight:15, type:"cable",    name:"Cloud-CDN Link"  },
  { from:8, to:9, weight: 3, type:"local",    name:"Co-located"      },
];

const REGIONS = [
  { label:"LOCAL NETWORK", x:10,  y:10, w:285, h:540, fill:"rgba(16,185,129,0.05)",  lightFill:"rgba(16,185,129,0.10)", r:14 },
  { label:"ISP LAYER",     x:308, y:10, w:256, h:540, fill:"rgba(56,189,248,0.05)",  lightFill:"rgba(26,115,232,0.09)", r:14 },
  { label:"INTERNET CORE", x:577, y:10, w:312, h:540, fill:"rgba(139,92,246,0.05)",  lightFill:"rgba(124,58,237,0.09)", r:14 },
];

// Optimal routes verified:
//   1→9: 1+8+22+5+3=39ms  (via direct peering ISP-North→IX East)
//   1→7: 1+10+25=36ms     (wireless bridge beats fiber backbone 41ms)
//   3→8: 22+5=27ms        (direct peering beats backbone 35ms)
//   1→8: 1+8+22+5=36ms    (same direct-peering path)
const PRESETS = [
  { from:1, to:9, label:"Home PC → Game Server", altRoute:{ label:"via ISP-South backbone", cost:46 } },
  { from:1, to:7, label:"Home PC → Cloud",        altRoute:{ label:"via ISP-North fiber",    cost:41 } },
  { from:3, to:8, label:"ISP-North → CDN Edge",   altRoute:{ label:"via Backbone+IX",        cost:35 } },
  { from:1, to:8, label:"Home PC → CDN Edge",     altRoute:{ label:"via ISP-South",          cost:43 } },
];

// ---- DOM refs ---------------------------------------------------------------

const canvas        = document.getElementById("graph");
const ctx           = canvas.getContext("2d");
const queueEl       = document.getElementById("queue");
const tableBody     = document.getElementById("distTable").querySelector("tbody");
const pseudoItems   = Array.from(document.querySelectorAll("#pseudocode li"));
const narrationEl   = document.getElementById("narration");
const resultEl      = document.getElementById("result");
const latencyCardEl = document.getElementById("latencyCard");
const stepCounterEl = document.getElementById("stepCounter");
const addrFrom      = document.getElementById("addr-from");
const addrTo        = document.getElementById("addr-to");

// ---- State ------------------------------------------------------------------

let sourceId = PRESETS[0].from, targetId = PRESETS[0].to;
let steps = [], stepIndex = -1, timer = null;
let fromMode = false, toMode = false;
let currentPresetIdx = 0;

// ---- Helpers ----------------------------------------------------------------

const getNode = id => NODES.find(n => n.id === id);
const getEdge = (a, b) => EDGES.find(e => (e.from===a&&e.to===b)||(e.from===b&&e.to===a));
const fmtMs   = d => Number.isFinite(d) ? d+"ms" : "∞";

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w,y, x+w,y+h, r); ctx.arcTo(x+w,y+h, x,y+h, r);
  ctx.arcTo(x,y+h, x,y, r);     ctx.arcTo(x,y, x+w,y, r);
  ctx.closePath();
}
function toCanvas(evt) {
  const rect = canvas.getBoundingClientRect();
  return { x:(evt.clientX-rect.left)*canvas.width/rect.width,
           y:(evt.clientY-rect.top)*canvas.height/rect.height };
}
function nodeAt(x, y) {
  for (let i = NODES.length-1; i >= 0; i--)
    if (Math.hypot(NODES[i].x-x, NODES[i].y-y) <= NODE_R+8) return NODES[i];
  return null;
}
function buildAdjacency() {
  const adj = new Map();
  NODES.forEach(n => adj.set(n.id, new Map()));
  for (const e of EDGES) { adj.get(e.from)?.set(e.to, e.weight); adj.get(e.to)?.set(e.from, e.weight); }
  return adj;
}
function frontierList(dist, visitedArr) {
  const vis = new Set(visitedArr);
  return NODES
    .filter(n => !vis.has(n.id) && Number.isFinite(dist[n.id]))
    .map(n => ({ id:n.id, label:n.label, dist:dist[n.id] }))
    .sort((a, b) => a.dist - b.dist || a.label.localeCompare(b.label));
}
function mkSnap(extra) {
  return Object.assign({
    pseudoLine:null, current:null, highlightEdge:null,
    pathNodes:null, pathEdges:null, description:"", result:null,
  }, extra, {
    distances: { ...extra._dist },
    previous:  { ...extra._prev },
    visited:   [...extra._visited],
    queue:     frontierList(extra._dist, extra._visited),
  });
}

// ---- Min-heap (same as city.js) --------------------------------------------

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a; a.push(item); let i = a.length-1;
    while (i > 0) { const p=(i-1)>>1; if(a[p].dist<=a[i].dist) break; [a[p],a[i]]=[a[i],a[p]]; i=p; }
  }
  pop() {
    const a = this.a; if (!a.length) return null;
    const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0, n = a.length;
      for (;;) {
        const l=2*i+1, r=2*i+2; let s=i;
        if(l<n&&a[l].dist<a[s].dist) s=l; if(r<n&&a[r].dist<a[s].dist) s=r;
        if(s===i) break; [a[s],a[i]]=[a[i],a[s]]; i=s;
      }
    }
    return top;
  }
}

// ---- Dijkstra step-recorder ------------------------------------------------

function runDijkstra() {
  if (!sourceId) { narrationEl.textContent = "Click ‘Source’ then a device to set source."; return; }
  const adj = buildAdjacency();
  const dist = {}, prev = {};
  NODES.forEach(n => { dist[n.id] = Infinity; prev[n.id] = null; });
  dist[sourceId] = 0;
  const visited = [], vis = new Set();
  const heap = new MinHeap();
  heap.push({ id:sourceId, dist:0 });
  const rec = [];
  const srcN = getNode(sourceId), tgtN = targetId ? getNode(targetId) : null;

  rec.push(mkSnap({ pseudoLine:0, _dist:dist, _prev:prev, _visited:visited,
    description:`Initializing: dist[${srcN.icon} ${srcN.label}] = 0ms. All other devices = ∞.` }));
  rec.push(mkSnap({ pseudoLine:1, _dist:dist, _prev:prev, _visited:visited,
    description:`${srcN.icon} ${srcN.label} pushed to priority queue with priority 0ms.` }));

  let reachedTarget = false;
  while (heap.size > 0) {
    const top = heap.pop();
    if (vis.has(top.id) || top.dist > dist[top.id]) continue;
    const u = top.id; const uN = getNode(u);
    visited.push(u); vis.add(u);

    rec.push(mkSnap({ pseudoLine:3, current:u, _dist:dist, _prev:prev, _visited:visited,
      description:`Dequeued ${uN.icon} <b>${uN.label}</b> — minimum unconfirmed latency: ${fmtMs(dist[u])}.` }));

    if (tgtN && u === targetId) { reachedTarget = true; break; }

    const nbrs = [...(adj.get(u)||new Map()).entries()]
      .sort((p, q) => getNode(p[0]).label.localeCompare(getNode(q[0]).label));

    for (const [v, w] of nbrs) {
      const vN = getNode(v); const edge = getEdge(u, v);
      if (vis.has(v)) {
        rec.push(mkSnap({ pseudoLine:5, current:u, highlightEdge:{from:u,to:v},
          _dist:dist, _prev:prev, _visited:visited,
          description:`${vN.icon} ${vN.label} already confirmed — skip ${edge?.name}.` }));
        continue;
      }
      const alt = dist[u] + w, before = fmtMs(dist[v]);
      if (alt < dist[v]) {
        dist[v] = alt; prev[v] = u; heap.push({ id:v, dist:alt });
        rec.push(mkSnap({ pseudoLine:8, current:u, highlightEdge:{from:u,to:v},
          _dist:dist, _prev:prev, _visited:visited,
          description:`Faster route! ${uN.icon}→${vN.icon} via ${edge?.name}: ${fmtMs(dist[u])}+${w}=${fmtMs(alt)} (was ${before}). Updated!` }));
      } else {
        rec.push(mkSnap({ pseudoLine:7, current:u, highlightEdge:{from:u,to:v},
          _dist:dist, _prev:prev, _visited:visited,
          description:`${edge?.name} to ${vN.icon} ${vN.label}: ${fmtMs(dist[u])}+${w}=${fmtMs(alt)} — not faster than ${fmtMs(dist[v])}.` }));
      }
    }
  }

  let final;
  if (tgtN) {
    if (reachedTarget && Number.isFinite(dist[targetId])) {
      const pathNodes = []; let cur = targetId;
      while (cur != null) { pathNodes.unshift(cur); cur = prev[cur]; }
      const pathEdges = [];
      for (let i = 0; i+1 < pathNodes.length; i++) pathEdges.push({ from:pathNodes[i], to:pathNodes[i+1] });
      final = mkSnap({ pseudoLine:10, _dist:dist, _prev:prev, _visited:visited, pathNodes, pathEdges,
        description:`Packet delivered! ${srcN.icon} ${srcN.label} → ${tgtN.icon} ${tgtN.label}: ${fmtMs(dist[targetId])} via ${pathNodes.length-1} hop(s).`,
        result:{ text:`${fmtMs(dist[targetId])} — ${pathNodes.length-1} hop(s)`, ok:true } });
    } else {
      final = mkSnap({ pseudoLine:10, _dist:dist, _prev:prev, _visited:visited,
        description:`${tgtN.icon} ${tgtN.label} unreachable from ${srcN.label}.`,
        result:{ text:`No route to ${tgtN.label}`, ok:false } });
    }
  } else {
    final = mkSnap({ pseudoLine:10, _dist:dist, _prev:prev, _visited:visited,
      description:`All reachable latencies from ${srcN.icon} ${srcN.label} computed.`,
      result:{ text:`Single-source complete from ${srcN.label}`, ok:true } });
  }
  rec.push(final);
  steps = rec; stepIndex = 0;
  stopPlayback(); renderAll();
}

// ---- Playback ---------------------------------------------------------------

function stepForward()  { if (!steps.length) { runDijkstra(); return; } if (stepIndex < steps.length-1) { stepIndex++; renderAll(); } else stopPlayback(); }
function stepBack()     { if (steps.length && stepIndex > 0) { stepIndex--; renderAll(); } }
function stopPlayback() { if(timer){clearInterval(timer);timer=null;} const b=document.getElementById("btnPlay"); if(b) b.textContent="⏯ Play"; }
function togglePlay() {
  if (timer) { stopPlayback(); return; }
  if (!steps.length) runDijkstra();
  if (stepIndex >= steps.length-1) stepIndex = 0;
  const ms = 1100 - (+document.getElementById("speed").value) * 95;
  document.getElementById("btnPlay").textContent = "⏸ Pause";
  timer = setInterval(() => { if(stepIndex>=steps.length-1){stopPlayback();return;} stepIndex++; renderAll(); }, ms);
}
function invalidateRun() {
  stopPlayback(); steps = []; stepIndex = -1;
  resultEl.textContent = ""; resultEl.className = "result";
  latencyCardEl.style.display = "none";
  renderPanels(); draw();
}

// ---- Draw state ------------------------------------------------------------

const STATE_FILL = { idle:"#475569", unvisited:"#475569", frontier:"#2563eb", current:"#f59e0b", visited:"#16a34a", path:"#fbbf24" };
const curStep = () => stepIndex >= 0 ? steps[stepIndex] : null;
function nodeState(id, step) {
  if (!step) return "idle";
  if (step.pathNodes?.includes(id)) return "path";
  if (step.current === id) return "current";
  if (step.visited.includes(id)) return "visited";
  if (Number.isFinite(step.distances[id])) return "frontier";
  return "unvisited";
}

// ---- Background ------------------------------------------------------------

function drawBackground() {
  ctx.fillStyle = C().mapBg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.strokeStyle = C().grid; ctx.lineWidth = 1;
  for (let x=0; x<canvas.width; x+=60) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
  for (let y=0; y<canvas.height; y+=60) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
  ctx.restore();
  const isLight = window.CTHEME?.isLight();
  ctx.save();
  for (const z of REGIONS) {
    ctx.fillStyle = isLight ? z.lightFill : z.fill; roundRect(z.x,z.y,z.w,z.h,z.r); ctx.fill();
    ctx.strokeStyle = C().districtBdr; ctx.lineWidth = 1; roundRect(z.x,z.y,z.w,z.h,z.r); ctx.stroke();
    ctx.fillStyle = C().districtLabel; ctx.font = "bold 8.5px 'Segoe UI',sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(z.label, z.x+9, z.y+7);
  }
  ctx.restore();
}

// ---- Link drawing ----------------------------------------------------------

function drawLink(a, b, edge, hot, onPath) {
  const lc = linkCol(edge.type), lw = linkW(edge.type);
  ctx.save(); ctx.lineCap = "round";
  if (edge.type === "wireless") ctx.setLineDash([10, 6]);
  else if (edge.type === "local") ctx.setLineDash([5, 4]);
  if (onPath)    { ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = lw+4; ctx.globalAlpha = 1; }
  else if (hot)  { ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = lw+2; ctx.globalAlpha = 1; }
  else           { ctx.strokeStyle = lc;         ctx.lineWidth = lw;   ctx.globalAlpha = 0.72; }
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  const mx = (a.x+b.x)/2, my = (a.y+b.y)/2, label = edge.weight+"ms";
  ctx.font = "bold 10px Consolas,monospace";
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = C().pillBg; roundRect(mx-tw/2-5, my-9, tw+10, 18, 5); ctx.fill();
  ctx.strokeStyle = onPath?"#fbbf24":hot?"#f59e0b":lc; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = onPath?"#fbbf24":hot?"#f59e0b":C().pillTxt;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, mx, my);
  ctx.restore();
}

// ---- Device drawing --------------------------------------------------------

function drawDevice(n, state, step) {
  const r = NODE_R, fill = STATE_FILL[state] || STATE_FILL.idle;
  ctx.save();
  if (state === "current" || state === "path") { ctx.shadowColor = fill; ctx.shadowBlur = 16; }
  ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI*2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = C().sbNodeStroke; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(n.x, n.y, r-5, 0, Math.PI*2);
  ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.shadowBlur = 0;
  if (n.id === sourceId) { ctx.beginPath(); ctx.arc(n.x,n.y,r+5,0,Math.PI*2); ctx.strokeStyle="#10b981"; ctx.lineWidth=3; ctx.stroke(); }
  if (n.id === targetId) { ctx.beginPath(); ctx.arc(n.x,n.y,r+5,0,Math.PI*2); ctx.strokeStyle="#ef4444"; ctx.lineWidth=3; ctx.stroke(); }
  if (fromMode || toMode) { ctx.beginPath(); ctx.arc(n.x,n.y,r+3,0,Math.PI*2); ctx.strokeStyle="rgba(56,189,248,0.45)"; ctx.lineWidth=2; ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]); }
  ctx.font = "16px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff"; ctx.fillText(n.icon, n.x, n.y);
  if (step) {
    const d = step.distances[n.id], txt = fmtMs(d);
    ctx.font = "bold 10px Consolas,monospace";
    const tw = ctx.measureText(txt).width, bx = n.x, by = n.y-r-12;
    ctx.fillStyle = C().badgeBg; roundRect(bx-tw/2-4, by-8, tw+8, 16, 4); ctx.fill();
    ctx.strokeStyle = C().badgeBdr; ctx.lineWidth = 1; roundRect(bx-tw/2-4, by-8, tw+8, 16, 4); ctx.stroke();
    ctx.fillStyle = Number.isFinite(d) ? C().badgeTxtFin : C().badgeTxtInf; ctx.fillText(txt, bx, by);
  }
  ctx.font = "bold 10px 'Segoe UI',sans-serif";
  const lw2 = ctx.measureText(n.label).width, labelY = n.y+r+10;
  ctx.fillStyle = C().labelBg; roundRect(n.x-lw2/2-4, labelY-1, lw2+8, 13, 3); ctx.fill();
  ctx.fillStyle = state === "path" ? "#fbbf24" : C().labelTxt;
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(n.label, n.x, labelY);
  ctx.restore();
}

// ---- Full canvas draw ------------------------------------------------------

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  const step = curStep();
  for (const e of EDGES) {
    const a = getNode(e.from), b = getNode(e.to); if (!a||!b) continue;
    const hot    = !!(step?.highlightEdge && ((step.highlightEdge.from===e.from&&step.highlightEdge.to===e.to)||(step.highlightEdge.from===e.to&&step.highlightEdge.to===e.from)));
    const onPath = !!(step?.pathEdges?.some(pe => (pe.from===e.from&&pe.to===e.to)||(pe.from===e.to&&pe.to===e.from)));
    drawLink(a, b, e, hot, onPath);
  }
  for (const n of NODES) drawDevice(n, nodeState(n.id, step), step);
}

function renderAll() { draw(); renderPanels(); }

// ---- Side-panel updates ----------------------------------------------------

function renderPanels() {
  const step = curStep();
  pseudoItems.forEach(li => li.classList.remove("active"));
  if (step?.pseudoLine != null) { const li = pseudoItems.find(x => +x.dataset.line === step.pseudoLine); if (li) li.classList.add("active"); }

  if (step) {
    queueEl.innerHTML = step.queue.length === 0
      ? '<span class="empty">empty</span>'
      : step.queue.map((q, i) => `<span class="qitem${i===0?" head":""}">${getNode(q.id).icon} ${q.label}: ${fmtMs(q.dist)}</span>`).join("");
  } else { queueEl.innerHTML = '<span class="empty">—</span>'; }

  const ordered = [...NODES].sort((a, b) => a.label.localeCompare(b.label));
  tableBody.innerHTML = ordered.map(n => {
    const d  = step ? fmtMs(step.distances[n.id]) : "—";
    const pn = step && step.previous[n.id] != null ? getNode(step.previous[n.id]).label : "—";
    let cls = "", badge = "—";
    if (step) {
      const st = nodeState(n.id, step);
      if      (st==="current") { cls="r-current"; badge="checking"; }
      else if (st==="path")    { cls="r-path";    badge="on route"; }
      else if (st==="visited") { cls="r-visited"; badge="confirmed"; }
      else if (st==="frontier"){ badge="queued"; }
    }
    return `<tr class="${cls}"><td>${n.icon} ${n.label}</td><td>${d}</td><td>${pn}</td><td><span class="badge">${badge}</span></td></tr>`;
  }).join("");

  if (step) {
    narrationEl.innerHTML = step.description;
    stepCounterEl.textContent = `${stepIndex+1} / ${steps.length}`;
    if (step.result) { resultEl.textContent = step.result.text; resultEl.className = "result "+(step.result.ok?"ok":"fail"); }
    else             { resultEl.textContent = ""; resultEl.className = "result"; }
    if (step.pathNodes) { latencyCardEl.innerHTML = buildLatencyCard(step); latencyCardEl.style.display = "block"; }
    else                { latencyCardEl.style.display = "none"; }
  } else {
    narrationEl.innerHTML = 'Select a scenario, then press <b>Find Route</b> to route the packet.';
    stepCounterEl.textContent = ""; resultEl.textContent = ""; resultEl.className = "result";
    latencyCardEl.style.display = "none";
  }
  updateAddressBar();
}

function buildLatencyCard(step) {
  const ids = step.pathNodes;
  const from = getNode(ids[0]), to = getNode(ids[ids.length-1]);
  let html = `<div class="lc-header">${from.icon} ${from.label} &rarr; ${to.icon} ${to.label}</div>`;
  for (let i = 0; i < ids.length; i++) {
    const n = getNode(ids[i]);
    html += `<div class="lc-hop" style="display:flex;justify-content:space-between"><span>${n.icon} <b>${n.label}</b></span><span style="color:var(--muted)">${fmtMs(step.distances[n.id])}</span></div>`;
    if (i < ids.length-1) {
      const e = getEdge(ids[i], ids[i+1]);
      const typeLabel = { fiber:"⬡ Fiber", cable:"◈ Cable", wireless:"〜 Wireless", local:"— Local" }[e?.type] ?? e?.type;
      html += `<div class="lc-link">&#8595; ${e?.name} (${e?.weight}ms) &middot; ${typeLabel}</div>`;
    }
  }
  const total = step.distances[ids[ids.length-1]];
  html += `<div class="lc-total">&#9654; Total latency: ${fmtMs(total)}</div>`;
  const preset = PRESETS.find(p => p.from===ids[0] && p.to===ids[ids.length-1]);
  if (preset?.altRoute) {
    const saved = preset.altRoute.cost - total;
    html += `<div class="lc-alt">Alternative: ${preset.altRoute.label} = ${preset.altRoute.cost}ms</div>`;
    if (saved > 0) html += `<div class="lc-save">&#10003; Dijkstra saves ${saved}ms vs. naive route</div>`;
  }
  return html;
}

function updateAddressBar() {
  const f = sourceId ? getNode(sourceId) : null, t = targetId ? getNode(targetId) : null;
  addrFrom.innerHTML = f ? `&#128230; ${f.icon} ${f.label}` : "&#128230; —";
  addrTo.innerHTML   = t ? `&#127919; ${t.icon} ${t.label}` : "&#127919; —";
}

function loadPreset(idx) {
  currentPresetIdx = idx;
  const p = PRESETS[idx]; sourceId = p.from; targetId = p.to;
  updateAddressBar(); invalidateRun();
}

// ---- Interaction ------------------------------------------------------------

canvas.addEventListener("mousedown", evt => {
  if (!fromMode && !toMode) return;
  const p = toCanvas(evt), n = nodeAt(p.x, p.y);
  if (!n) {
    fromMode = toMode = false;
    document.getElementById("btnFrom").classList.remove("active");
    document.getElementById("btnTo").classList.remove("active");
    canvas.style.cursor = "default"; draw(); return;
  }
  if (fromMode) { sourceId = n.id; if(targetId===n.id) targetId=null; fromMode=false; document.getElementById("btnFrom").classList.remove("active"); }
  else          { targetId = n.id; if(sourceId===n.id) sourceId=null; toMode=false;   document.getElementById("btnTo").classList.remove("active"); }
  canvas.style.cursor = "default";
  const pi = PRESETS.findIndex(p => p.from===sourceId && p.to===targetId);
  if (pi >= 0) { currentPresetIdx=pi; document.getElementById("scenarioPicker").value=pi; }
  updateAddressBar(); invalidateRun();
});

document.getElementById("scenarioPicker").addEventListener("change", e => loadPreset(+e.target.value));
document.getElementById("btnFrom").addEventListener("click", () => { fromMode=!fromMode; toMode=false; document.getElementById("btnFrom").classList.toggle("active",fromMode); document.getElementById("btnTo").classList.remove("active"); canvas.style.cursor=fromMode?"crosshair":"default"; });
document.getElementById("btnTo").addEventListener("click",   () => { toMode=!toMode; fromMode=false; document.getElementById("btnTo").classList.toggle("active",toMode); document.getElementById("btnFrom").classList.remove("active"); canvas.style.cursor=toMode?"crosshair":"default"; });
document.getElementById("btnRun").addEventListener("click",  runDijkstra);
document.getElementById("btnStep").addEventListener("click", stepForward);
document.getElementById("btnBack").addEventListener("click", stepBack);
document.getElementById("btnPlay").addEventListener("click", togglePlay);
document.getElementById("btnReset").addEventListener("click", () => { stopPlayback(); steps=[]; stepIndex=-1; renderAll(); });

// ---- Boot ------------------------------------------------------------------

loadPreset(0);
window.addEventListener("themechange", renderAll);
