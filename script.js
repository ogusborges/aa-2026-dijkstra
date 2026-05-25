"use strict";

/* ============================================================
   Dijkstra's Algorithm — interactive demo
   Vanilla JS. Graph editor on <canvas> + step-recorded run.
   ============================================================ */

const C = () => window.CTHEME?.c ?? {};

// ---------- Data model ----------
let nodes = [];   // { id, label, x, y }
let edges = [];   // { from, to, weight }   (from/to are node ids)
let nextId = 1;
let labelCount = 0;

// ---------- App state ----------
let mode = "addNode";
let sourceId = null;
let targetId = null;
let directed = false;

let pendingFrom = null;     // node id while drawing an edge
let dragNode = null;        // node id being dragged in move mode
let selection = null;       // { type:'node'|'edge', ref } for keyboard delete
let mouse = { x: 0, y: 0 }; // canvas coords of cursor

// ---------- Playback ----------
let steps = [];             // recorded snapshots
let stepIndex = -1;         // -1 => editing (no active run)
let timer = null;

const NODE_R = 22;

// ---------- DOM ----------
const canvas = document.getElementById("graph");
const ctx = canvas.getContext("2d");
const LOGICAL_W = 900;
const LOGICAL_H = 640;

function resizeCanvasToDisplaySize() {
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const w = Math.round(rect.width  * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width  = w;
    canvas.height = h;
  }
}
const modeHint = document.getElementById("modeHint");
const queueEl = document.getElementById("queue");
const tableBody = document.querySelector("#distTable tbody");
const narrationEl = document.getElementById("narration");
const resultEl = document.getElementById("result");
const stepCounterEl = document.getElementById("stepCounter");
const pseudoItems = Array.from(document.querySelectorAll("#pseudocode li"));

const MODE_HINTS = {
  addNode:   "Add Node — click empty space to drop a node.",
  addEdge:   "Add Edge — click a node, then another; you'll be asked for the weight.",
  move:      "Move — drag nodes to reposition them.",
  setSource: "Set Source — click a node to mark it as the start (green).",
  setTarget: "Set Target — click a node to mark it as the goal (red).",
  delete:    "Delete — click a node or edge to remove it (or right-click anything).",
};

// ============================================================
//  Helpers
// ============================================================
function labelFor(n) {
  const letter = String.fromCharCode(65 + (n % 26));
  const tier = Math.floor(n / 26);
  return tier === 0 ? letter : letter + tier;
}
function getNode(id) { return nodes.find(n => n.id === id); }

function samePair(e, a, b) {
  if (directed) return e.from === a && e.to === b;
  return (e.from === a && e.to === b) || (e.from === b && e.to === a);
}
function findEdge(a, b) { return edges.find(e => samePair(e, a, b)); }

// Build adjacency: Map<nodeId, Map<neighborId, minWeight>>
function buildAdjacency() {
  const adj = new Map();
  nodes.forEach(n => adj.set(n.id, new Map()));
  for (const e of edges) {
    addAdj(adj, e.from, e.to, e.weight);
    if (!directed) addAdj(adj, e.to, e.from, e.weight);
  }
  return adj;
}
function addAdj(adj, u, v, w) {
  const m = adj.get(u);
  if (!m) return;
  if (!m.has(v) || w < m.get(v)) m.set(v, w);
}

// Mouse event -> canvas coordinate (accounting for CSS scaling)
function toCanvas(evt) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (evt.clientX - r.left) * (LOGICAL_W / r.width),
    y: (evt.clientY - r.top) * (LOGICAL_H / r.height),
  };
}
function nodeAt(x, y) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (Math.hypot(n.x - x, n.y - y) <= NODE_R) return n;
  }
  return null;
}
function edgeAt(x, y) {
  for (const e of edges) {
    const a = getNode(e.from), b = getNode(e.to);
    if (!a || !b) continue;
    if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= 7) return e;
  }
  return null;
}
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Any structural change to the graph invalidates a recorded run.
function invalidateRun() {
  stopPlayback();
  steps = [];
  stepIndex = -1;
  resultEl.textContent = "";
  resultEl.className = "result";
  renderPanels();
  draw();
}

// ============================================================
//  Min-heap (binary), keyed by .dist
// ============================================================
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].dist <= a[i].dist) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    if (a.length === 0) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let s = i;
        if (l < n && a[l].dist < a[s].dist) s = l;
        if (r < n && a[r].dist < a[s].dist) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

// ============================================================
//  Dijkstra — records a snapshot per meaningful event
// ============================================================
function snapshot(extra) {
  return Object.assign({
    pseudoLine: null,
    current: null,
    highlightEdge: null,     // { from, to }
    pathNodes: null,
    pathEdges: null,
    description: "",
    result: null,            // { text, ok }
  }, extra, {
    distances: { ...extra._dist },
    previous: { ...extra._prev },
    visited: [...extra._visited],
    queue: frontierList(extra._dist, extra._visited),
  });
}

// Conceptual queue contents: reachable, not-yet-finalized nodes, sorted by dist.
function frontierList(dist, visitedArr) {
  const visited = new Set(visitedArr);
  return nodes
    .filter(n => !visited.has(n.id) && Number.isFinite(dist[n.id]))
    .map(n => ({ id: n.id, label: n.label, dist: dist[n.id] }))
    .sort((p, q) => p.dist - q.dist || p.label.localeCompare(q.label));
}

function fmt(d) { return Number.isFinite(d) ? d : "∞"; }

function runDijkstra() {
  if (nodes.length === 0) { narrationEl.textContent = "Add some nodes first."; return; }
  if (sourceId == null || !getNode(sourceId)) {
    sourceId = nodes[0].id; // friendly default
  }

  const adj = buildAdjacency();
  const dist = {}, prev = {};
  nodes.forEach(n => { dist[n.id] = Infinity; prev[n.id] = null; });
  dist[sourceId] = 0;

  const visited = [];
  const visitedSet = new Set();
  const heap = new MinHeap();
  heap.push({ id: sourceId, dist: 0 });

  const rec = [];
  const srcLabel = getNode(sourceId).label;

  rec.push(snapshot({
    pseudoLine: 1, _dist: dist, _prev: prev, _visited: visited,
    description: `Initialize: dist[${srcLabel}] = 0, every other node = ∞. ` +
                 `Push ${srcLabel} into the priority queue.`,
  }));

  let reachedTarget = false;

  while (heap.size > 0) {
    const top = heap.pop();
    if (visitedSet.has(top.id) || top.dist > dist[top.id]) continue; // stale entry

    const u = top.id;
    const uNode = getNode(u);
    visited.push(u);
    visitedSet.add(u);

    rec.push(snapshot({
      pseudoLine: 3, current: u, _dist: dist, _prev: prev, _visited: visited,
      description: `Pop ${uNode.label} (distance ${fmt(dist[u])}) — the unvisited node with ` +
                   `the smallest tentative distance. Mark it finalized.`,
    }));

    if (targetId != null && u === targetId) { reachedTarget = true; break; }

    const neighbors = [...(adj.get(u) || new Map()).entries()]
      .sort((p, q) => getNode(p[0]).label.localeCompare(getNode(q[0]).label));

    for (const [v, w] of neighbors) {
      const vNode = getNode(v);
      if (visitedSet.has(v)) {
        rec.push(snapshot({
          pseudoLine: 5, current: u, highlightEdge: { from: u, to: v },
          _dist: dist, _prev: prev, _visited: visited,
          description: `Neighbor ${vNode.label} is already finalized — skip it.`,
        }));
        continue;
      }
      const alt = dist[u] + w;
      if (alt < dist[v]) {
        const before = fmt(dist[v]);
        dist[v] = alt;
        prev[v] = u;
        heap.push({ id: v, dist: alt });
        rec.push(snapshot({
          pseudoLine: 8, current: u, highlightEdge: { from: u, to: v },
          _dist: dist, _prev: prev, _visited: visited,
          description: `Relax ${uNode.label}→${vNode.label}: ${fmt(dist[u])} + ${w} = ${alt} ` +
                       `< ${before}, so update dist[${vNode.label}] = ${alt} and prev[${vNode.label}] = ${uNode.label}.`,
        }));
      } else {
        rec.push(snapshot({
          pseudoLine: 7, current: u, highlightEdge: { from: u, to: v },
          _dist: dist, _prev: prev, _visited: visited,
          description: `Check ${uNode.label}→${vNode.label}: ${fmt(dist[u])} + ${w} = ${alt} ` +
                       `≥ dist[${vNode.label}] = ${fmt(dist[v])}. No improvement.`,
        }));
      }
    }
  }

  // ---- Final snapshot ----
  let final;
  if (targetId != null && getNode(targetId)) {
    const tLabel = getNode(targetId).label;
    if (reachedTarget && Number.isFinite(dist[targetId])) {
      const pathNodes = [];
      let cur = targetId;
      while (cur != null) { pathNodes.unshift(cur); cur = prev[cur]; }
      const pathEdges = [];
      for (let i = 0; i + 1 < pathNodes.length; i++)
        pathEdges.push({ from: pathNodes[i], to: pathNodes[i + 1] });
      const labels = pathNodes.map(id => getNode(id).label).join(" → ");
      final = snapshot({
        pseudoLine: 10, _dist: dist, _prev: prev, _visited: visited,
        pathNodes, pathEdges,
        description: `Target ${tLabel} finalized. Reconstruct the path by following prev[] backward.`,
        result: { text: `Shortest path: ${labels}  (total cost ${dist[targetId]})`, ok: true },
      });
    } else {
      final = snapshot({
        pseudoLine: 10, _dist: dist, _prev: prev, _visited: visited,
        description: `The queue is exhausted but ${tLabel} was never reached.`,
        result: { text: `No path exists from ${srcLabel} to ${tLabel}.`, ok: false },
      });
    }
  } else {
    final = snapshot({
      pseudoLine: 10, _dist: dist, _prev: prev, _visited: visited,
      description: `Queue empty — all reachable nodes are finalized. Single-source distances computed.`,
      result: { text: `Done. Shortest distances from ${srcLabel} computed for all reachable nodes.`, ok: true },
    });
  }
  rec.push(final);

  steps = rec;
  stepIndex = 0;
  stopPlayback();
  renderAll();
}

// ============================================================
//  Playback
// ============================================================
function stepForward() {
  if (steps.length === 0) { runDijkstra(); return; }
  if (stepIndex < steps.length - 1) { stepIndex++; renderAll(); }
  else stopPlayback();
}
function stepBack() {
  if (steps.length === 0) return;
  if (stepIndex > 0) { stepIndex--; renderAll(); }
}
function togglePlay() {
  if (timer) { stopPlayback(); return; }
  if (steps.length === 0) runDijkstra();
  if (stepIndex >= steps.length - 1) stepIndex = 0; // replay from start
  const speed = +document.getElementById("speed").value;
  const interval = 1100 - speed * 95; // 1=~1000ms ... 10=~150ms
  document.getElementById("btnPlay").textContent = "⏸ Pause";
  timer = setInterval(() => {
    if (stepIndex >= steps.length - 1) { stopPlayback(); return; }
    stepIndex++;
    renderAll();
  }, interval);
}
function stopPlayback() {
  if (timer) { clearInterval(timer); timer = null; }
  const b = document.getElementById("btnPlay");
  if (b) b.textContent = "⏯ Play";
}
function resetRun() {
  stopPlayback();
  steps = [];
  stepIndex = -1;
  renderAll();
}

// ============================================================
//  Rendering — canvas
// ============================================================
function curStep() { return stepIndex >= 0 && steps[stepIndex] ? steps[stepIndex] : null; }

function nodeState(id, step) {
  if (!step) return "idle";
  if (step.pathNodes && step.pathNodes.includes(id)) return "path";
  if (step.current === id) return "current";
  if (step.visited.includes(id)) return "visited";
  if (Number.isFinite(step.distances[id])) return "frontier";
  return "unvisited";
}
const STATE_FILL = {
  idle: "#475569",
  unvisited: "#475569",
  frontier: "#2563eb",
  current: "#f59e0b",
  visited: "#16a34a",
  path: "#fbbf24",
};

function isPathEdge(e, step) {
  if (!step || !step.pathEdges) return false;
  return step.pathEdges.some(pe =>
    (pe.from === e.from && pe.to === e.to) || (!directed && pe.from === e.to && pe.to === e.from));
}
function isHotEdge(e, step) {
  if (!step || !step.highlightEdge) return false;
  const h = step.highlightEdge;
  return (h.from === e.from && h.to === e.to) || (!directed && h.from === e.to && h.to === e.from);
}

function draw() {
  resizeCanvasToDisplaySize();
  ctx.save();
  ctx.scale(canvas.width / LOGICAL_W, canvas.height / LOGICAL_H);
  const step = curStep();
  ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

  // edges
  for (const e of edges) {
    const a = getNode(e.from), b = getNode(e.to);
    if (!a || !b) continue;
    const hot = isHotEdge(e, step);
    const onPath = isPathEdge(e, step);
    drawEdge(a, b, e.weight, { hot, onPath, selected: selection?.type === "edge" && selection.ref === e });
  }

  // rubber band while creating an edge
  if (pendingFrom != null) {
    const a = getNode(pendingFrom);
    if (a) {
      ctx.save();
      ctx.strokeStyle = "#38bdf8";
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(mouse.x, mouse.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  // nodes
  for (const n of nodes) {
    drawNode(n, nodeState(n.id, step), step);
  }
  ctx.restore();
}

function drawEdge(a, b, weight, opt) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  // trim endpoints to circle boundary
  const sx = a.x + Math.cos(ang) * NODE_R;
  const sy = a.y + Math.sin(ang) * NODE_R;
  const ex = b.x - Math.cos(ang) * NODE_R;
  const ey = b.y - Math.sin(ang) * NODE_R;

  ctx.save();
  ctx.lineWidth = opt.onPath ? 5 : (opt.hot ? 4 : 2);
  ctx.strokeStyle = opt.onPath ? "#fbbf24" : (opt.hot ? "#f59e0b" : (opt.selected ? "#38bdf8" : "#64748b"));
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  if (directed) {
    const ah = 11;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ah * Math.cos(ang - 0.4), ey - ah * Math.sin(ang - 0.4));
    ctx.lineTo(ex - ah * Math.cos(ang + 0.4), ey - ah * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  // weight label with background pill
  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
  const text = String(weight);
  ctx.font = "bold 13px Consolas, monospace";
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = C().sbPillBg;
  roundRect(mx - tw / 2 - 6, my - 11, tw + 12, 22, 6);
  ctx.fill();
  ctx.strokeStyle = opt.onPath ? "#fbbf24" : C().sbPillBdr;
  ctx.lineWidth = 1;
  roundRect(mx - tw / 2 - 6, my - 11, tw + 12, 22, 6);
  ctx.stroke();
  ctx.fillStyle = opt.onPath ? "#fbbf24" : C().sbPillTxt;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, mx, my);
  ctx.restore();
}

function drawNode(n, state, step) {
  ctx.save();
  // fill
  ctx.beginPath();
  ctx.arc(n.x, n.y, NODE_R, 0, Math.PI * 2);
  ctx.fillStyle = STATE_FILL[state] || STATE_FILL.idle;
  ctx.fill();

  // pending-edge highlight
  if (pendingFrom === n.id) {
    ctx.lineWidth = 4; ctx.strokeStyle = "#38bdf8";
    ctx.stroke();
  } else {
    ctx.lineWidth = 2; ctx.strokeStyle = "#0b1120";
    ctx.stroke();
  }

  // source / target rings (always visible)
  if (n.id === sourceId) ring(n, "#10b981");
  if (n.id === targetId) ring(n, "#ef4444");
  if (selection?.type === "node" && selection.ref === n) ring(n, "#38bdf8");

  // label
  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 15px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(n.label, n.x, n.y);

  // tentative distance badge (during a run)
  if (step) {
    const d = step.distances[n.id];
    const txt = fmt(d);
    ctx.font = "bold 12px Consolas, monospace";
    const tw = ctx.measureText(txt).width;
    const bx = n.x, by = n.y - NODE_R - 12;
    ctx.fillStyle = C().badgeBg;
    roundRect(bx - tw / 2 - 5, by - 9, tw + 10, 18, 5); ctx.fill();
    ctx.strokeStyle = C().badgeBdr; ctx.lineWidth = 1;
    roundRect(bx - tw / 2 - 5, by - 9, tw + 10, 18, 5); ctx.stroke();
    ctx.fillStyle = Number.isFinite(d) ? C().badgeTxtFin : C().badgeTxtInf;
    ctx.fillText(txt, bx, by);
  }
  ctx.restore();
}
function ring(n, color) {
  ctx.beginPath();
  ctx.arc(n.x, n.y, NODE_R + 5, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ============================================================
//  Rendering — side panels
// ============================================================
function renderAll() { draw(); renderPanels(); }

function renderPanels() {
  const step = curStep();

  // pseudocode highlight
  pseudoItems.forEach(li => li.classList.remove("active"));
  if (step && step.pseudoLine != null) {
    const li = pseudoItems.find(x => +x.dataset.line === step.pseudoLine);
    if (li) li.classList.add("active");
  }

  // queue
  if (step) {
    if (step.queue.length === 0) {
      queueEl.innerHTML = '<span class="empty">empty</span>';
    } else {
      queueEl.innerHTML = step.queue
        .map((q, i) => `<span class="qitem${i === 0 ? " head" : ""}">${q.label}:${fmt(q.dist)}</span>`)
        .join("");
    }
  } else {
    queueEl.innerHTML = '<span class="empty">—</span>';
  }

  // distance table
  const ordered = [...nodes].sort((a, b) => a.label.localeCompare(b.label));
  tableBody.innerHTML = ordered.map(n => {
    const d = step ? fmt(step.distances[n.id]) : "—";
    const p = step && step.previous[n.id] != null ? getNode(step.previous[n.id]).label : "—";
    let cls = "", badge = "—";
    if (step) {
      const st = nodeState(n.id, step);
      if (st === "current") { cls = "r-current"; badge = "current"; }
      else if (st === "path") { cls = "r-path"; badge = "path"; }
      else if (st === "visited") { cls = "r-visited"; badge = "done"; }
      else if (st === "frontier") { badge = "queued"; }
      else { badge = "—"; }
    }
    return `<tr class="${cls}"><td>${n.label}</td><td>${d}</td><td>${p}</td>` +
           `<td><span class="badge">${badge}</span></td></tr>`;
  }).join("");

  // narration + counter + result
  if (step) {
    narrationEl.innerHTML = step.description;
    stepCounterEl.textContent = `${stepIndex + 1} / ${steps.length}`;
    if (step.result) {
      resultEl.textContent = step.result.text;
      resultEl.className = "result " + (step.result.ok ? "ok" : "fail");
    } else {
      resultEl.textContent = "";
      resultEl.className = "result";
    }
  } else {
    narrationEl.innerHTML = "Build or load a graph, set a source, then press <b>Run</b> to record the algorithm's steps.";
    stepCounterEl.textContent = "";
    resultEl.textContent = "";
    resultEl.className = "result";
  }
}

// ============================================================
//  Interaction
// ============================================================
function setMode(m) {
  mode = m;
  pendingFrom = null;
  document.querySelectorAll(".tool").forEach(b =>
    b.classList.toggle("active", b.dataset.mode === m));
  modeHint.textContent = MODE_HINTS[m] || "";
  canvas.style.cursor = (m === "move") ? "grab" : (m === "delete" ? "not-allowed" : "crosshair");
  draw();
}

canvas.addEventListener("mousedown", (evt) => {
  const p = toCanvas(evt);
  mouse = p;
  const n = nodeAt(p.x, p.y);

  switch (mode) {
    case "addNode":
      if (!n) {
        nodes.push({ id: nextId++, label: labelFor(labelCount++), x: p.x, y: p.y });
        invalidateRun();
      }
      break;

    case "addEdge":
      if (n) {
        if (pendingFrom == null) { pendingFrom = n.id; draw(); }
        else if (pendingFrom !== n.id) { createEdge(pendingFrom, n.id); pendingFrom = null; }
        else { pendingFrom = null; draw(); } // clicked same node -> cancel
      } else { pendingFrom = null; draw(); }
      break;

    case "move":
      if (n) { dragNode = n.id; selection = { type: "node", ref: n }; canvas.style.cursor = "grabbing"; draw(); }
      break;

    case "setSource":
      if (n) { sourceId = n.id; if (targetId === n.id) targetId = null; invalidateRun(); }
      break;

    case "setTarget":
      if (n) { targetId = n.id; if (sourceId === n.id) sourceId = null; invalidateRun(); }
      break;

    case "delete":
      if (n) deleteNode(n.id);
      else { const e = edgeAt(p.x, p.y); if (e) deleteEdge(e); }
      break;
  }
});

canvas.addEventListener("mousemove", (evt) => {
  mouse = toCanvas(evt);
  if (dragNode != null) {
    const n = getNode(dragNode);
    if (n) { n.x = mouse.x; n.y = mouse.y; draw(); }
  } else if (pendingFrom != null) {
    draw();
  }
});

window.addEventListener("mouseup", () => {
  if (dragNode != null) {
    dragNode = null;
    if (mode === "move") canvas.style.cursor = "grab";
  }
});

// right-click deletes whatever is under the cursor
canvas.addEventListener("contextmenu", (evt) => {
  evt.preventDefault();
  const p = toCanvas(evt);
  const n = nodeAt(p.x, p.y);
  if (n) { deleteNode(n.id); return; }
  const e = edgeAt(p.x, p.y);
  if (e) deleteEdge(e);
});

window.addEventListener("keydown", (evt) => {
  if (evt.key === "Delete" || evt.key === "Backspace") {
    if (selection?.type === "node") { deleteNode(selection.ref.id); evt.preventDefault(); }
    else if (selection?.type === "edge") { deleteEdge(selection.ref); evt.preventDefault(); }
  }
});

function createEdge(a, b) {
  const existing = findEdge(a, b);
  const def = existing ? existing.weight : 1;
  const raw = window.prompt("Edge weight (positive number):", def);
  if (raw === null) return;            // cancelled
  const w = Number(raw);
  if (!Number.isFinite(w) || w <= 0) { alert("Weight must be a positive number."); return; }
  if (existing) existing.weight = w;
  else edges.push({ from: a, to: b, weight: w });
  invalidateRun();
}

function deleteNode(id) {
  nodes = nodes.filter(n => n.id !== id);
  edges = edges.filter(e => e.from !== id && e.to !== id);
  if (sourceId === id) sourceId = null;
  if (targetId === id) targetId = null;
  if (selection?.type === "node" && selection.ref.id === id) selection = null;
  invalidateRun();
}
function deleteEdge(e) {
  edges = edges.filter(x => x !== e);
  if (selection?.type === "edge" && selection.ref === e) selection = null;
  invalidateRun();
}

// ============================================================
//  Samples / clearing
// ============================================================
function loadSample() {
  clearAll(true);
  const S = [
    ["A", 120, 150], ["B", 360, 90], ["C", 300, 320],
    ["D", 560, 180], ["E", 600, 400], ["F", 810, 270],
  ];
  const idByLabel = {};
  for (const [label, x, y] of S) {
    const id = nextId++;
    idByLabel[label] = id;
    nodes.push({ id, label, x, y });
  }
  labelCount = S.length;
  const E = [
    ["A", "B", 4], ["A", "C", 2], ["B", "C", 1], ["B", "D", 5],
    ["C", "D", 8], ["C", "E", 10], ["D", "E", 2], ["D", "F", 6], ["E", "F", 3],
  ];
  for (const [a, b, w] of E) edges.push({ from: idByLabel[a], to: idByLabel[b], weight: w });
  sourceId = idByLabel["A"];
  targetId = idByLabel["F"];
  invalidateRun();
}

function clearAll(silent) {
  if (!silent && nodes.length && !confirm("Clear the entire graph?")) return;
  stopPlayback();
  nodes = []; edges = [];
  nextId = 1; labelCount = 0;
  sourceId = null; targetId = null;
  pendingFrom = null; selection = null;
  steps = []; stepIndex = -1;
  renderAll();
}

// ============================================================
//  Wire up controls
// ============================================================
document.querySelectorAll(".tool").forEach(b =>
  b.addEventListener("click", () => setMode(b.dataset.mode)));

document.getElementById("btnRun").addEventListener("click", runDijkstra);
document.getElementById("btnStep").addEventListener("click", stepForward);
document.getElementById("btnBack").addEventListener("click", stepBack);
document.getElementById("btnPlay").addEventListener("click", togglePlay);
document.getElementById("btnReset").addEventListener("click", resetRun);
document.getElementById("btnSample").addEventListener("click", loadSample);
document.getElementById("btnClear").addEventListener("click", () => clearAll(false));
document.getElementById("directed").addEventListener("change", (e) => {
  directed = e.target.checked;
  invalidateRun();
});

// ---------- init ----------
setMode("addNode");
loadSample();
renderAll();

window.addEventListener("themechange", draw);
