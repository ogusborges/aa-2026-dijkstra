'use strict';

const COLS = 30, ROWS = 18, CELL = 30;
const C = () => window.CTHEME?.c ?? {};

const TERRAIN = {
  road:     { cost:1,        label:'Road',     darkFill:'#374151', lightFill:'#d1d5db' },
  grass:    { cost:3,        label:'Grass',    darkFill:'#14532d', lightFill:'#bbf7d0' },
  swamp:    { cost:8,        label:'Swamp',    darkFill:'#134e4a', lightFill:'#99f6e4' },
  mountain: { cost:15,       label:'Mountain', darkFill:'#1c1917', lightFill:'#d6d3d1' },
  wall:     { cost:Infinity, label:'Wall',     darkFill:'#050a14', lightFill:'#64748b' },
};

const STATE_OVERLAY = {
  frontier: 'rgba(37,99,235,0.50)',
  current:  'rgba(245,158,11,0.85)',
  visited:  'rgba(22,163,74,0.38)',
  path:     'rgba(251,191,36,0.80)',
};

// ---- mutable state ----
let grid = [];
let src = { r: 9, c: 2 };
let tgt = { r: 9, c: 27 };
let steps = [];
let stepIndex = -1;
let paintMode = 'road';
let painting  = false;
let playTimer = null;

// ---- canvas setup ----
const canvas = document.getElementById('graph');
const ctx    = canvas.getContext('2d');
const W = canvas.width;   // 900
const H = canvas.height;  // 540

// ---- MinHeap ----
class MinHeap {
  constructor() { this.h = []; }
  push(item) {
    this.h.push(item);
    let i = this.h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.h[p].dist <= this.h[i].dist) break;
      [this.h[p], this.h[i]] = [this.h[i], this.h[p]];
      i = p;
    }
  }
  pop() {
    const top  = this.h[0];
    const last = this.h.pop();
    if (this.h.length) {
      this.h[0] = last;
      let i = 0;
      while (true) {
        let s = i, l = 2*i+1, r = 2*i+2;
        if (l < this.h.length && this.h[l].dist < this.h[s].dist) s = l;
        if (r < this.h.length && this.h[r].dist < this.h[s].dist) s = r;
        if (s === i) break;
        [this.h[s], this.h[i]] = [this.h[i], this.h[s]];
        i = s;
      }
    }
    return top;
  }
  get size() { return this.h.length; }
}

// ---- helpers ----
const key     = (r, c) => `${r},${c}`;
const unkey   = k => { const [r, c] = k.split(',').map(Number); return { r, c }; };
const inBounds = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

function initGrid(fill = 'road') {
  grid = Array.from({ length: ROWS }, () => Array(COLS).fill(fill));
}

// ---- presets ----
const PRESETS = [
  {
    name: 'Mountain Pass',
    load() {
      initGrid('grass');
      // mountain band rows 6-12, cols 4-25
      for (let r = 6; r <= 12; r++)
        for (let c = 4; c <= 25; c++)
          grid[r][c] = 'mountain';
      // road gap (cols 11-12)
      for (let r = 6; r <= 12; r++) { grid[r][11] = 'road'; grid[r][12] = 'road'; }
      // swamp gap (cols 19-20)  — shorter detour but costly terrain
      for (let r = 6; r <= 12; r++) { grid[r][19] = 'swamp'; grid[r][20] = 'swamp'; }
      src = { r: 9, c: 1 };
      tgt = { r: 9, c: 28 };
    },
  },
  {
    name: 'Wetlands',
    load() {
      initGrid('grass');
      // road corridor top (rows 0-2) and edges
      for (let c = 0; c < COLS; c++) { grid[0][c] = 'road'; grid[1][c] = 'road'; }
      for (let r = 0; r < ROWS; r++) { grid[r][0] = 'road'; grid[r][COLS-1] = 'road'; }
      // swamp blob center
      for (let r = 4; r <= 14; r++)
        for (let c = 5; c <= 24; c++)
          grid[r][c] = 'swamp';
      // a few grass stepping stones inside swamp
      [[6,10],[6,17],[9,12],[9,19],[12,9],[12,21]].forEach(([r,c]) => { grid[r][c] = 'grass'; });
      src = { r: 9, c: 1 };
      tgt = { r: 9, c: 28 };
    },
  },
  {
    name: 'City Streets',
    load() {
      initGrid('grass');
      // horizontal roads
      [0, 4, 9, 13, 17].forEach(r => { for (let c = 0; c < COLS; c++) grid[r][c] = 'road'; });
      // vertical roads
      [0, 6, 13, 20, 27, 29].forEach(c => { for (let r = 0; r < ROWS; r++) grid[r][c] = 'road'; });
      src = { r: 1, c: 1 };
      tgt = { r: 16, c: 28 };
    },
  },
  {
    name: 'The Maze',
    load() {
      initGrid('wall');
      // horizontal corridors: [row, col_start, col_end]
      [
        [1, 1, 28], [3, 1, 8], [3, 12, 19], [3, 23, 28],
        [5, 4, 13], [5, 17, 24], [7, 2, 7], [7, 11, 22], [7, 26, 28],
        [9, 1, 4], [9, 8, 17], [9, 21, 28], [11, 3, 10], [11, 14, 25],
        [13, 1, 6], [13, 10, 19], [13, 23, 28], [15, 5, 12], [15, 16, 28],
        [16, 1, 28],
      ].forEach(([r, c1, c2]) => { for (let c = c1; c <= c2; c++) grid[r][c] = 'road'; });
      // vertical corridors: [col, row_start, row_end]
      [
        [1, 1, 16], [4, 1, 5], [8, 3, 9], [13, 5, 11], [19, 3, 9],
        [24, 5, 11], [7, 7, 13], [22, 7, 13], [10, 11, 15], [16, 11, 16],
        [28, 1, 16], [3, 11, 16], [25, 13, 16], [6, 13, 16],
      ].forEach(([c, r1, r2]) => { for (let r = r1; r <= r2; r++) grid[r][c] = 'road'; });
      src = { r: 1, c: 1 };
      tgt = { r: 16, c: 28 };
    },
  },
];

// ---- snapshot ----
function mkSnap(extra) {
  return {
    pseudoLine:  extra.pseudoLine  ?? null,
    current:     extra.current     ?? null,
    pathCells:   extra.pathCells   ?? null,
    pathSet:     extra.pathCells   ? new Set(extra.pathCells) : null,
    description: extra.description ?? '',
    result:      extra.result      ?? null,
    dist:     { ...extra._dist },
    prev:     { ...extra._prev },
    visited:  new Set(extra._visited),
    frontier: [...(extra._frontier ?? [])],
  };
}

// ---- Dijkstra ----
function runDijkstra() {
  steps = [];
  const srcKey = key(src.r, src.c);
  const tgtKey = key(tgt.r, tgt.c);

  const _dist    = {};
  const _prev    = {};
  const _visited = [];
  const heap     = new MinHeap();

  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      _dist[key(r, c)] = Infinity;
  _dist[srcKey] = 0;

  const fsnap = () =>
    heap.h.map(x => ({ key: x.id, dist: x.dist })).sort((a,b) => a.dist - b.dist);

  steps.push(mkSnap({
    pseudoLine: 0, _dist, _prev, _visited, _frontier: fsnap(),
    description: `Initialize: cost to source <b>(${src.r},${src.c})</b> = 0, all others = ∞.`,
  }));

  heap.push({ id: srcKey, dist: 0 });

  steps.push(mkSnap({
    pseudoLine: 1, _dist, _prev, _visited, _frontier: fsnap(),
    description: `Push source <b>(${src.r},${src.c})</b> into priority queue.`,
  }));

  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];

  while (heap.size > 0) {
    steps.push(mkSnap({
      pseudoLine: 2, _dist, _prev, _visited, _frontier: fsnap(),
      description: `Queue has <b>${heap.size}</b> cell${heap.size !== 1 ? 's' : ''}.`,
    }));

    const { id: uKey, dist: uDist } = heap.pop();
    if (_visited.includes(uKey)) continue;

    const { r: ur, c: uc } = unkey(uKey);
    const uTerrain = TERRAIN[grid[ur][uc]];

    steps.push(mkSnap({
      pseudoLine: 3, current: uKey, _dist, _prev, _visited, _frontier: fsnap(),
      description: `Pop <b>(${ur},${uc})</b> — ${uTerrain.label}, accumulated cost <b>${uDist}</b>.`,
    }));

    if (uKey === tgtKey) {
      _visited.push(uKey);
      const pathCells = [];
      let cur = tgtKey;
      while (cur) { pathCells.unshift(cur); cur = _prev[cur]; }
      steps.push(mkSnap({
        pseudoLine: 4, current: uKey, pathCells, _dist, _prev, _visited, _frontier: fsnap(),
        description: `<b>Target reached!</b> <b>(${ur},${uc})</b> — total cost <b>${uDist}</b>.`,
        result: 'ok',
      }));
      return;
    }

    steps.push(mkSnap({
      pseudoLine: 5, current: uKey, _dist, _prev, _visited, _frontier: fsnap(),
      description: `Mark <b>(${ur},${uc})</b> as visited (confirmed shortest).`,
    }));
    _visited.push(uKey);

    steps.push(mkSnap({
      pseudoLine: 6, current: uKey, _dist, _prev, _visited, _frontier: fsnap(),
      description: `Expand neighbors of <b>(${ur},${uc})</b>.`,
    }));

    for (const [dr, dc] of DIRS) {
      const nr = ur + dr, nc = uc + dc;
      if (!inBounds(nr, nc)) continue;
      const vKey = key(nr, nc);
      if (_visited.includes(vKey)) continue;
      const t = grid[nr][nc];

      if (t === 'wall') {
        steps.push(mkSnap({
          pseudoLine: 7, current: uKey, _dist, _prev, _visited, _frontier: fsnap(),
          description: `&nbsp;&nbsp;<b>(${nr},${nc})</b> is a <b>Wall</b> — impassable, skip.`,
        }));
        continue;
      }

      const alt = uDist + TERRAIN[t].cost;
      const improved = alt < _dist[vKey];
      const wasInf = _dist[vKey] === Infinity;

      steps.push(mkSnap({
        pseudoLine: 8, current: uKey, _dist, _prev, _visited, _frontier: fsnap(),
        description: `&nbsp;&nbsp;<b>(${nr},${nc})</b> ${TERRAIN[t].label}: ${uDist} + ${TERRAIN[t].cost} = <b>${alt}</b>${improved ? '' : ` (not better than ${_dist[vKey]})`}.`,
      }));

      if (improved) {
        _dist[vKey] = alt;
        _prev[vKey] = uKey;
        heap.push({ id: vKey, dist: alt });
        steps.push(mkSnap({
          pseudoLine: 10, current: uKey, _dist, _prev, _visited, _frontier: fsnap(),
          description: `&nbsp;&nbsp;Update <b>(${nr},${nc})</b>: ${wasInf ? '∞' : _dist[vKey]} → <b>${alt}</b> via (${ur},${uc}).`,
        }));
      }
    }
  }

  steps.push(mkSnap({
    pseudoLine: 12, _dist, _prev, _visited, _frontier: [],
    description: `No path from <b>(${src.r},${src.c})</b> to <b>(${tgt.r},${tgt.c})</b>.`,
    result: 'fail',
  }));
}

// ---- cell state ----
function cellState(k, step) {
  if (!step) return 'idle';
  if (step.pathSet && step.pathSet.has(k)) return 'path';
  if (step.current === k) return 'current';
  if (step.visited.has(k)) return 'visited';
  if (step.dist[k] !== undefined && step.dist[k] < Infinity) return 'frontier';
  return 'idle';
}

// ---- draw ----
function draw() {
  const step    = stepIndex >= 0 ? steps[stepIndex] : null;
  const isLight = window.CTHEME?.isLight?.() ?? false;

  ctx.fillStyle = isLight ? '#e2e8f0' : '#0f172a';
  ctx.fillRect(0, 0, W, H);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * CELL, y = r * CELL;
      const t = grid[r][c];
      const k = key(r, c);
      const state = cellState(k, step);

      // terrain base fill
      ctx.fillStyle = isLight ? TERRAIN[t].lightFill : TERRAIN[t].darkFill;
      ctx.fillRect(x, y, CELL, CELL);

      // state overlay
      if (state !== 'idle') {
        ctx.fillStyle = STATE_OVERLAY[state];
        ctx.fillRect(x, y, CELL, CELL);
      }

      // cell grid lines
      ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x + 0.25, y + 0.25, CELL - 0.5, CELL - 0.5);

      // distance badge for non-idle, non-current cells
      if (step && state !== 'idle' && state !== 'current') {
        const d = step.dist[k];
        if (d !== undefined && d < Infinity) {
          const label = d < 1000 ? String(d) : '···';
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = isLight ? 'rgba(0,0,0,0.50)' : 'rgba(255,255,255,0.55)';
          ctx.fillText(label, x + CELL / 2, y + CELL - 2);
        }
      }
    }
  }

  // source and target markers on top
  drawMarker(src.r, src.c, 'source', step);
  drawMarker(tgt.r, tgt.c, 'target', step);
}

function drawMarker(r, c, type, step) {
  const cx = c * CELL + CELL / 2;
  const cy = r * CELL + CELL / 2;
  const isLight = window.CTHEME?.isLight?.() ?? false;
  const radius = CELL * 0.38;

  // colored ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = type === 'source' ? '#22c55e' : '#ef4444';
  ctx.fill();

  // white border ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = isLight ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // inner dot
  ctx.beginPath();
  ctx.arc(cx, cy, CELL * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // show final cost badge on target after path found
  if (type === 'target' && step && step.pathCells) {
    const k = key(r, c);
    const d = step.dist[k];
    if (d !== undefined && d < Infinity) {
      const label = String(d);
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(label).width;
      const bx = cx + CELL * 0.40, by = cy - CELL * 0.42;
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(bx - tw/2 - 4, by - 8, tw + 8, 16);
      ctx.fillStyle = '#0f172a';
      ctx.fillText(label, bx, by);
    }
  }
}

// ---- panels ----
function renderPanels() {
  const step = stepIndex >= 0 ? steps[stepIndex] : null;

  // pseudocode highlight
  document.querySelectorAll('#pseudocode li').forEach(li => {
    li.classList.toggle('active', step !== null && Number(li.dataset.line) === step.pseudoLine);
  });

  // step counter
  document.getElementById('stepCounter').textContent =
    stepIndex >= 0 ? `(${stepIndex + 1} / ${steps.length})` : '';

  // priority queue
  const queueEl = document.getElementById('queue');
  if (!step || step.frontier.length === 0) {
    queueEl.textContent = step ? '(empty)' : '—';
  } else {
    const top8 = step.frontier.slice(0, 8);
    queueEl.innerHTML = top8.map((item, i) => {
      const { r, c } = unkey(item.key);
      const cls   = i === 0 ? 'qitem head' : 'qitem';
      const label = item.dist < Infinity ? item.dist : '∞';
      return `<span class="${cls}">(${r},${c})=${label}</span>`;
    }).join(' ');
    if (step.frontier.length > 8) {
      queueEl.innerHTML +=
        `<span class="qitem" style="opacity:.5">+${step.frontier.length - 8} more</span>`;
    }
  }

  // exploration log table — top 15 cells with finite dist, sorted ascending
  const tbody = document.querySelector('#distTable tbody');
  if (!step) {
    tbody.innerHTML = '';
  } else {
    const entries = [];
    for (const [k, d] of Object.entries(step.dist)) {
      if (d < Infinity) entries.push({ k, d });
    }
    entries.sort((a, b) => a.d - b.d);
    tbody.innerHTML = entries.slice(0, 15).map(({ k, d }) => {
      const { r, c } = unkey(k);
      const state = cellState(k, step);
      const via   = step.prev[k]
        ? (() => { const { r:vr, c:vc } = unkey(step.prev[k]); return `(${vr},${vc})`; })()
        : '—';
      let cls = '', badge = '—';
      if (state === 'current') { cls = 'r-current'; badge = 'checking'; }
      else if (state === 'path') { cls = 'r-path'; badge = 'on route'; }
      else if (state === 'visited') { cls = 'r-visited'; badge = 'confirmed'; }
      else if (state === 'frontier') { badge = 'queued'; }
      return `<tr class="${cls}"><td>(${r},${c})</td><td>${d}</td><td>${via}</td><td><span class="badge">${badge}</span></td></tr>`;
    }).join('');
  }

  // narration
  const narration = document.getElementById('narration');
  const resultEl  = document.getElementById('result');
  narration.innerHTML = step
    ? step.description
    : 'Select a preset or paint a map, then press <b>Find Path</b>.';
  resultEl.textContent = '';
  resultEl.className   = 'result';

  if (step && step.result === 'ok') {
    const d = step.dist[key(tgt.r, tgt.c)];
    resultEl.textContent = `Path found — total cost ${d}`;
    resultEl.classList.add('ok');
  } else if (step && step.result === 'fail') {
    resultEl.textContent = 'No path — target is unreachable.';
    resultEl.classList.add('fail');
  }

  // terrain card
  const card = document.getElementById('terrainCard');
  if (step && step.pathCells) {
    card.style.display = '';
    card.innerHTML = buildTerrainCard(step);
  } else {
    card.style.display = 'none';
  }
}

function buildTerrainCard(step) {
  const { pathCells } = step;
  if (!pathCells || pathCells.length === 0) return '';

  // group consecutive same-terrain runs
  const segs = [];
  let cur = null;
  for (const k of pathCells) {
    const { r, c } = unkey(k);
    const t = grid[r][c];
    if (t === cur?.t) { cur.count++; }
    else { cur = { t, count: 1, cost: TERRAIN[t].cost }; segs.push(cur); }
  }

  let html = `<div class="tc-header">&#9679; Optimal Route — ${pathCells.length} cells</div>`;
  segs.forEach(seg => {
    const total = seg.cost === Infinity ? '∞' : seg.count * seg.cost;
    html += `<div class="tc-row">${seg.t.charAt(0).toUpperCase()+seg.t.slice(1)} &times; ${seg.count}</div>`;
    html += `<div class="tc-sub">${seg.count} &times; ${seg.cost} = ${total}</div>`;
  });

  const totalCost = step.dist[key(tgt.r, tgt.c)];
  html += `<div class="tc-total">Total cost: ${totalCost}</div>`;
  const manhattan = Math.abs(tgt.r - src.r) + Math.abs(tgt.c - src.c);
  html += `<div class="tc-alt">Min possible (all road): ${manhattan}</div>`;
  return html;
}

function renderAll() { draw(); renderPanels(); }

// ---- playback ----
function loadPreset(idx) {
  stopPlay();
  steps = []; stepIndex = -1;
  PRESETS[idx].load();
  renderAll();
}

function resetSteps() {
  stopPlay();
  steps = []; stepIndex = -1;
  renderAll();
}

function stopPlay() {
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  document.getElementById('btnPlay').textContent = '⏯ Play';
}

function speedMs() {
  return Math.round(1200 / Number(document.getElementById('speed').value));
}

document.getElementById('btnRun').addEventListener('click', () => {
  stopPlay();
  if (grid[src.r][src.c] === 'wall') {
    document.getElementById('narration').innerHTML = 'Source cell is a <b>Wall</b> — move it first.';
    return;
  }
  if (grid[tgt.r][tgt.c] === 'wall') {
    document.getElementById('narration').innerHTML = 'Destination cell is a <b>Wall</b> — move it first.';
    return;
  }
  runDijkstra();
  stepIndex = 0;
  renderAll();
});

document.getElementById('btnBack').addEventListener('click', () => {
  stopPlay();
  if (stepIndex > 0) { stepIndex--; renderAll(); }
});

document.getElementById('btnStep').addEventListener('click', () => {
  stopPlay();
  if (steps.length === 0) { document.getElementById('btnRun').click(); return; }
  if (stepIndex < steps.length - 1) { stepIndex++; renderAll(); }
});

document.getElementById('btnPlay').addEventListener('click', () => {
  if (playTimer) {
    stopPlay(); return;
  }
  if (steps.length === 0) { runDijkstra(); stepIndex = 0; renderAll(); }
  else if (stepIndex >= steps.length - 1) { stepIndex = 0; }
  document.getElementById('btnPlay').textContent = '⏸ Pause';
  playTimer = setInterval(() => {
    if (stepIndex < steps.length - 1) { stepIndex++; renderAll(); }
    else stopPlay();
  }, speedMs());
});

document.getElementById('btnReset').addEventListener('click', resetSteps);

document.getElementById('btnClear').addEventListener('click', () => {
  stopPlay(); initGrid('road'); steps = []; stepIndex = -1; renderAll();
});

document.getElementById('presetPicker').addEventListener('change', e => {
  loadPreset(Number(e.target.value));
});

// ---- paint mode buttons ----
function setActivePaintBtn(id) {
  document.querySelectorAll('[data-terrain], #btnFrom, #btnTo').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

document.querySelectorAll('[data-terrain]').forEach(btn => {
  btn.addEventListener('click', () => {
    setActivePaintBtn(btn.id);
    paintMode = btn.dataset.terrain;
  });
});

document.getElementById('btnFrom').addEventListener('click', () => {
  setActivePaintBtn('btnFrom'); paintMode = 'source';
});

document.getElementById('btnTo').addEventListener('click', () => {
  setActivePaintBtn('btnTo'); paintMode = 'dest';
});

// ---- canvas interaction ----
function cellFromEvent(e) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    r: Math.floor((e.clientY - rect.top)  * scaleY / CELL),
    c: Math.floor((e.clientX - rect.left) * scaleX / CELL),
  };
}

function handlePaint(e) {
  const { r, c } = cellFromEvent(e);
  if (!inBounds(r, c)) return;

  if (paintMode === 'source') {
    src = { r, c };
    setActivePaintBtn('paintRoad'); paintMode = 'road';
  } else if (paintMode === 'dest') {
    tgt = { r, c };
    setActivePaintBtn('paintRoad'); paintMode = 'road';
  } else {
    grid[r][c] = paintMode;
  }
  // invalidate previous run
  steps = []; stepIndex = -1;
  renderAll();
}

canvas.addEventListener('mousedown', e => { stopPlay(); painting = true; handlePaint(e); });
canvas.addEventListener('mousemove', e => { if (painting) handlePaint(e); });
canvas.addEventListener('mouseup',   () => { painting = false; });
canvas.addEventListener('mouseleave',() => { painting = false; });

// ---- theme ----
window.addEventListener('themechange', renderAll);

// ---- boot ----
loadPreset(0);
