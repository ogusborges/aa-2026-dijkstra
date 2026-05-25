"use strict";

/* ============================================================
   Uberlândia Navigator — GPS routing via Dijkstra
   Real landmarks in Uberlândia, Minas Gerais, Brazil.
   ============================================================ */

const PIN_R = 22;
const C = () => window.CTHEME?.c ?? {};

/* ---- Map data ---- */
const NODES = [
  { id:1, label:"UFU",              icon:"🎓", x:175, y:435 },
  { id:2, label:"Cintreq",          icon:"⚙️",  x:130, y:285 },
  { id:3, label:"Camaru",           icon:"🍖", x:165, y:105 },
  { id:4, label:"Sesc Centro",      icon:"🎭", x:385, y:195 },
  { id:5, label:"Terminal Central", icon:"🚌", x:425, y:330 },
  { id:6, label:"Center Shopping",  icon:"🛍️", x:645, y:115 },
  { id:7, label:"Ubl. Shopping",    icon:"🏬", x:745, y:295 },
  { id:8, label:"Webberfit",        icon:"💪", x:685, y:450 },
];

/* weights = driving minutes; ≤5 = highway, 6–10 = main, >10 = slow */
const EDGES = [
  { from:3, to:2, weight: 9, name:"Av. Monsenhor Eduardo"          },
  { from:3, to:4, weight:13, name:"Av. Getúlio Vargas"             },
  { from:2, to:1, weight:10, name:"Av. Nicomedes Alves dos Santos" },
  { from:2, to:5, weight:12, name:"Av. Belo Horizonte"             },
  { from:1, to:5, weight: 8, name:"Av. João Naves de Ávila"        },
  { from:1, to:8, weight:11, name:"Av. Anselmo Alves dos Santos"   },
  { from:4, to:5, weight: 5, name:"Av. Rondon Pacheco"             },
  { from:4, to:6, weight: 8, name:"Av. Segismundo Pereira"         },
  { from:5, to:7, weight: 7, name:"Av. Rondon Pacheco Leste"       },
  { from:5, to:6, weight:15, name:"Av. João Pinheiro"              },
  { from:6, to:7, weight: 3, name:"Anel Viário",                    icon:"🛣️" },
  { from:7, to:8, weight: 9, name:"Av. dos Metalúrgicos"           },
];

/*
 Route insights (presets designed to show counter-intuitive results):
 1. UFU→CentSh  — ring-road east (18 min) beats going straight north (23 min)
 2. Camaru→Webberfit — back roads via Cintreq+UFU (30 min) beat the downtown loop (34 min)
 3. Terminal→Webberfit — east via UbShop (16 min) beats south via UFU (19 min)
 4. Camaru→UFU  — shortcut via Cintreq (19 min) beats the main-road circuit (26 min)
*/
const PRESETS = [
  { label:"UFU → Center Shopping", from:1, to:6,
    altRoute:{ label:"Via downtown (UFU › Terminal › Center Shopping)", cost:23 } },
  { label:"Camaru → Webberfit",    from:3, to:8,
    altRoute:{ label:"Via centro (Camaru › Sesc › Terminal › Ubl.Sh. › Webberfit)", cost:34 } },
  { label:"Terminal → Webberfit",  from:5, to:8,
    altRoute:{ label:"Via UFU (Terminal › UFU › Webberfit)", cost:19 } },
  { label:"Camaru → UFU",          from:3, to:1,
    altRoute:{ label:"Via centro (Camaru › Sesc › Terminal › UFU)", cost:26 } },
];

/* background zone fills */
const DISTRICTS = [
  { label:"Centro",      x:316, y:148, w:192, h:222, fill:"rgba(30,58,95,0.30)",  lightFill:"rgba(25,118,210,0.09)",  r:14 },
  { label:"Campus UFU",  x: 70, y:348, w:175, h:145, fill:"rgba(20,83,45,0.30)",  lightFill:"rgba(46,125,50,0.12)",   r:12 },
  { label:"Zona Norte",  x:545, y: 52, w:260, h:188, fill:"rgba(45,50,70,0.28)",  lightFill:"rgba(69,90,100,0.09)",   r:12 },
  { label:"Leste",       x:650, y:225, w:152, h:150, fill:"rgba(30,58,95,0.22)",  lightFill:"rgba(25,118,210,0.07)",  r:10 },
  { label:"Zona Sul",    x:588, y:400, w:158, h:110, fill:"rgba(90,20,20,0.20)",  lightFill:"rgba(211,47,47,0.08)",   r:10 },
  { label:"Gastronomia", x: 74, y: 52, w:152, h:115, fill:"rgba(80,40,10,0.28)",  lightFill:"rgba(230,81,0,0.09)",    r:10 },
];

/* decorative building blocks */
const BLOCKS = [
  [348,252,36,24],[394,272,28,32],[440,244,34,22],
  [566,118,48,34],[614,156,26,24],[656,170,30,22],
  [666,236,30,28],[696,256,26,30],
  [612,408,38,28],[656,386,30,25],
  [188,302,34,26],[232,318,26,22],[208,266,30,20],
  [274,390,28,22],[304,408,32,24],
];

/* ---- State ---- */
let sourceId = PRESETS[0].from;
let targetId  = PRESETS[0].to;
let fromMode  = false;
let toMode    = false;
let currentPresetIdx = 0;
let steps = [], stepIndex = -1, timer = null;

/* ---- DOM ---- */
const canvas   = document.getElementById("graph");
const ctx      = canvas.getContext("2d");
const LOGICAL_W = 900;
const LOGICAL_H = 560;

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
const queueEl  = document.getElementById("queue");
const tableBody = document.querySelector("#distTable tbody");
const narrationEl  = document.getElementById("narration");
const resultEl     = document.getElementById("result");
const stepCounterEl = document.getElementById("stepCounter");
const routeCardEl  = document.getElementById("routeCard");
const pseudoItems  = Array.from(document.querySelectorAll("#pseudocode li"));
const addrFrom = document.getElementById("addr-from");
const addrTo   = document.getElementById("addr-to");

/* ---- Helpers ---- */
const roadType = w => w <= 5 ? "highway" : w <= 10 ? "main" : "slow";
const fmt      = d  => Number.isFinite(d) ? d : "∞";
const fmtMin   = d  => Number.isFinite(d) ? d + " min" : "∞";
const getNode  = id => NODES.find(n => n.id === id);
const getEdge  = (a,b) => EDGES.find(e => (e.from===a&&e.to===b)||(e.from===b&&e.to===a));

function toCanvas(evt) {
  const r = canvas.getBoundingClientRect();
  return { x:(evt.clientX-r.left)*(LOGICAL_W/r.width),
           y:(evt.clientY-r.top)*(LOGICAL_H/r.height) };
}
function pinAt(x, y) {
  for (let i = NODES.length-1; i >= 0; i--) {
    const n = NODES[i];
    if (Math.hypot(n.x-x, n.y-y) <= PIN_R+8) return n;
  }
  return null;
}
function buildAdjacency() {
  const adj = new Map();
  NODES.forEach(n => adj.set(n.id, new Map()));
  for (const e of EDGES) {
    adj.get(e.from)?.set(e.to, e.weight);
    adj.get(e.to)?.set(e.from, e.weight);
  }
  return adj;
}
function frontierList(dist, visitedArr) {
  const vis = new Set(visitedArr);
  return NODES
    .filter(n => !vis.has(n.id) && Number.isFinite(dist[n.id]))
    .map(n => ({ id:n.id, label:n.label, dist:dist[n.id] }))
    .sort((a,b) => a.dist - b.dist || a.label.localeCompare(b.label));
}
function snap(extra) {
  return Object.assign({
    pseudoLine:null, current:null, highlightEdge:null,
    pathNodes:null,  pathEdges:null, description:"", result:null,
  }, extra, {
    distances:{ ...extra._dist },
    previous: { ...extra._prev },
    visited:  [...extra._visited],
    queue:    frontierList(extra._dist, extra._visited),
  });
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w,y, x+w,y+h, r);
  ctx.arcTo(x+w,y+h, x,y+h, r);
  ctx.arcTo(x,y+h, x,y, r);
  ctx.arcTo(x,y, x+w,y, r);
  ctx.closePath();
}
function invalidateRun() {
  stopPlayback(); steps=[]; stepIndex=-1;
  resultEl.textContent=""; resultEl.className="result";
  routeCardEl.style.display="none";
  renderPanels(); draw();
}

/* ---- Min-heap ---- */
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a=this.a; a.push(item); let i=a.length-1;
    while(i>0){const p=(i-1)>>1;if(a[p].dist<=a[i].dist)break;[a[p],a[i]]=[a[i],a[p]];i=p;}
  }
  pop() {
    const a=this.a; if(!a.length) return null;
    const top=a[0]; const last=a.pop();
    if(a.length){a[0]=last;let i=0,n=a.length;
      for(;;){const l=2*i+1,r=2*i+2;let s=i;
        if(l<n&&a[l].dist<a[s].dist)s=l;if(r<n&&a[r].dist<a[s].dist)s=r;
        if(s===i)break;[a[s],a[i]]=[a[i],a[s]];i=s;}}
    return top;
  }
}

/* ---- Dijkstra step-recorder ---- */
function runDijkstra() {
  if (!sourceId) { narrationEl.textContent = "Click 'From' then a landmark to set a start."; return; }
  const adj = buildAdjacency();
  const dist={}, prev={};
  NODES.forEach(n => { dist[n.id]=Infinity; prev[n.id]=null; });
  dist[sourceId]=0;
  const visited=[], vis=new Set();
  const heap = new MinHeap();
  heap.push({ id:sourceId, dist:0 });
  const rec=[];
  const srcN = getNode(sourceId);
  const tgtN = targetId ? getNode(targetId) : null;

  rec.push(snap({ pseudoLine:1, _dist:dist, _prev:prev, _visited:visited,
    description:`GPS activated. Starting at ${srcN.icon} ${srcN.label}. `+
                `All other distances = ∞. ${srcN.label} = 0 min.` }));

  let reachedTarget = false;
  while (heap.size > 0) {
    const top = heap.pop();
    if (vis.has(top.id) || top.dist > dist[top.id]) continue;
    const u=top.id; const uN=getNode(u);
    visited.push(u); vis.add(u);

    rec.push(snap({ pseudoLine:3, current:u, _dist:dist, _prev:prev, _visited:visited,
      description:`GPS: Evaluating ${uN.icon} ${uN.label} — `+
                  `closest unconfirmed at ${fmt(dist[u])} min. Scanning roads…` }));

    if (tgtN && u===targetId) { reachedTarget=true; break; }

    const nbrs = [...(adj.get(u)||new Map()).entries()]
      .sort((p,q) => getNode(p[0]).label.localeCompare(getNode(q[0]).label));

    for (const [v, w] of nbrs) {
      const vN=getNode(v); const edge=getEdge(u,v); const rn=edge?.name||"road";
      if (vis.has(v)) {
        rec.push(snap({ pseudoLine:5, current:u, highlightEdge:{from:u,to:v},
          _dist:dist, _prev:prev, _visited:visited,
          description:`${vN.icon} ${vN.label} already confirmed — skipping ${rn}.` }));
        continue;
      }
      const alt=dist[u]+w, before=fmt(dist[v]);
      if (alt < dist[v]) {
        dist[v]=alt; prev[v]=u; heap.push({id:v,dist:alt});
        rec.push(snap({ pseudoLine:8, current:u, highlightEdge:{from:u,to:v},
          _dist:dist, _prev:prev, _visited:visited,
          description:`Faster route! ${uN.icon}→${vN.icon} via ${rn}: `+
                      `${fmt(dist[u])}+${w}=${alt} min (was ${before}). Updated!` }));
      } else {
        rec.push(snap({ pseudoLine:7, current:u, highlightEdge:{from:u,to:v},
          _dist:dist, _prev:prev, _visited:visited,
          description:`${rn} to ${vN.icon} ${vN.label}: ${fmt(dist[u])}+${w}=${alt} min `+
                      `— not faster than ${fmt(dist[v])} min.` }));
      }
    }
  }

  let final;
  if (tgtN) {
    if (reachedTarget && Number.isFinite(dist[targetId])) {
      const pathNodes=[]; let cur=targetId;
      while(cur!=null){pathNodes.unshift(cur);cur=prev[cur];}
      const pathEdges=[];
      for(let i=0;i+1<pathNodes.length;i++) pathEdges.push({from:pathNodes[i],to:pathNodes[i+1]});
      const labels=pathNodes.map(id=>getNode(id).label).join(" › ");
      final=snap({ pseudoLine:10, _dist:dist, _prev:prev, _visited:visited, pathNodes, pathEdges,
        description:`Route confirmed: ${labels} — ${dist[targetId]} min.`,
        result:{ text:`Arrived at ${tgtN.icon} ${tgtN.label} in ${dist[targetId]} min`, ok:true } });
    } else {
      final=snap({ pseudoLine:10, _dist:dist, _prev:prev, _visited:visited,
        description:`Queue exhausted. ${tgtN.icon} ${tgtN.label} is unreachable from ${srcN.label}.`,
        result:{ text:`No route to ${tgtN.label}`, ok:false } });
    }
  } else {
    final=snap({ pseudoLine:10, _dist:dist, _prev:prev, _visited:visited,
      description:`Done. All reachable distances from ${srcN.icon} ${srcN.label} computed.`,
      result:{ text:`Single-source distances from ${srcN.label} complete.`, ok:true } });
  }
  rec.push(final);
  steps=rec; stepIndex=0;
  stopPlayback(); renderAll();
}

/* ---- Playback ---- */
function stepForward() {
  if (!steps.length) { runDijkstra(); return; }
  if (stepIndex < steps.length-1) { stepIndex++; renderAll(); } else stopPlayback();
}
function stepBack() {
  if (steps.length && stepIndex>0) { stepIndex--; renderAll(); }
}
function togglePlay() {
  if (timer) { stopPlayback(); return; }
  if (!steps.length) runDijkstra();
  if (stepIndex >= steps.length-1) stepIndex=0;
  const ms = 1100 - (+document.getElementById("speed").value)*95;
  document.getElementById("btnPlay").textContent="⏸ Pause";
  timer=setInterval(()=>{ if(stepIndex>=steps.length-1){stopPlayback();return;} stepIndex++;renderAll(); },ms);
}
function stopPlayback() {
  if(timer){clearInterval(timer);timer=null;}
  const b=document.getElementById("btnPlay"); if(b) b.textContent="⏯ Play";
}
function resetRun() {
  stopPlayback(); steps=[]; stepIndex=-1;
  resultEl.textContent=""; resultEl.className="result";
  routeCardEl.style.display="none";
  renderAll();
}

/* ---- Draw ---- */
const STATE_FILL = {
  idle:"#475569",unvisited:"#475569",frontier:"#2563eb",
  current:"#f59e0b",visited:"#16a34a",path:"#fbbf24",
};
const curStep  = () => stepIndex>=0 ? steps[stepIndex] : null;
function nodeState(id, step) {
  if (!step) return "idle";
  if (step.pathNodes?.includes(id)) return "path";
  if (step.current===id) return "current";
  if (step.visited.includes(id)) return "visited";
  if (Number.isFinite(step.distances[id])) return "frontier";
  return "unvisited";
}
function draw() {
  resizeCanvasToDisplaySize();
  ctx.save();
  ctx.scale(canvas.width / LOGICAL_W, canvas.height / LOGICAL_H);
  ctx.clearRect(0,0,LOGICAL_W,LOGICAL_H);
  drawBackground();
  const step=curStep();
  drawRoads(step);
  drawLandmarks(step);
  ctx.restore();
}

function drawBackground() {
  ctx.fillStyle=C().mapBg; ctx.fillRect(0,0,LOGICAL_W,LOGICAL_H);
  ctx.save();
  ctx.strokeStyle=C().grid; ctx.lineWidth=1;
  for(let x=0;x<LOGICAL_W;x+=65){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,LOGICAL_H);ctx.stroke();}
  for(let y=0;y<LOGICAL_H;y+=65){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(LOGICAL_W,y);ctx.stroke();}
  ctx.restore();
  ctx.save();
  const isLight=window.CTHEME?.isLight();
  for (const d of DISTRICTS) {
    ctx.fillStyle=isLight?d.lightFill:d.fill; roundRect(d.x,d.y,d.w,d.h,d.r); ctx.fill();
    ctx.strokeStyle=C().districtBdr; ctx.lineWidth=1;
    roundRect(d.x,d.y,d.w,d.h,d.r); ctx.stroke();
    ctx.fillStyle=C().districtLabel;
    ctx.font="bold 9.5px Segoe UI,sans-serif";
    ctx.textAlign="left"; ctx.textBaseline="top";
    ctx.fillText(d.label.toUpperCase(),d.x+7,d.y+5);
  }
  ctx.restore();
  ctx.save();
  ctx.fillStyle=C().blockFill; ctx.strokeStyle=C().blockBdr; ctx.lineWidth=0.5;
  for(const [bx,by,bw,bh] of BLOCKS){ roundRect(bx,by,bw,bh,3); ctx.fill(); roundRect(bx,by,bw,bh,3); ctx.stroke(); }
  ctx.restore();
}

function drawRoads(step) {
  for (const e of EDGES) {
    const a=getNode(e.from), b=getNode(e.to); if(!a||!b) continue;
    const hot=!!(step?.highlightEdge&&((step.highlightEdge.from===e.from&&step.highlightEdge.to===e.to)||(step.highlightEdge.from===e.to&&step.highlightEdge.to===e.from)));
    const onPath=!!(step?.pathEdges?.some(pe=>(pe.from===e.from&&pe.to===e.to)||(pe.from===e.to&&pe.to===e.from)));
    drawSegment(a,b,e,hot,onPath);
  }
}

function drawSegment(a, b, edge, hot, onPath) {
  const type=roadType(edge.weight);
  ctx.save(); ctx.lineCap="round";
  let roadColor, roadWidth;
  if(onPath){roadColor="#fbbf24";roadWidth=10;}
  else if(hot){roadColor="#f59e0b";roadWidth=type==="highway"?9:type==="main"?6:4;}
  else{roadColor=type==="highway"?C().roadHW:type==="main"?C().roadMain:C().roadSlow;
       roadWidth=type==="highway"?8:type==="main"?4:2;}
  if(type==="slow"&&!onPath&&!hot) ctx.setLineDash([10,7]);
  ctx.lineWidth=roadWidth; ctx.strokeStyle=roadColor;
  ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  ctx.setLineDash([]);
  if(type==="highway"&&!onPath&&!hot){
    ctx.strokeStyle=C().hwStripe; ctx.lineWidth=1.5; ctx.setLineDash([16,12]);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); ctx.setLineDash([]);
  }
  const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
  if(!onPath&&!hot&&stepIndex<0){
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
    const rx=mx+(-dy/len)*14, ry=my+(dx/len)*14;
    ctx.font="italic 9.5px Segoe UI,sans-serif";
    ctx.fillStyle=C().roadName;
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(edge.name,rx,ry);
  }
  const label=edge.weight+" min";
  ctx.font="bold 11px Consolas,monospace";
  const tw=ctx.measureText(label).width;
  ctx.fillStyle=C().pillBg; roundRect(mx-tw/2-5,my-10,tw+10,20,5); ctx.fill();
  ctx.strokeStyle=onPath?"#fbbf24":hot?"#f59e0b":C().pillBdr; ctx.lineWidth=1;
  roundRect(mx-tw/2-5,my-10,tw+10,20,5); ctx.stroke();
  ctx.fillStyle=onPath?"#fbbf24":hot?"#f59e0b":C().pillTxt;
  ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(label,mx,my);
  if (edge.icon) {
    ctx.fillStyle=C().pillBg;
    ctx.beginPath(); ctx.arc(mx,my-22,12,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=onPath?"#fbbf24":hot?"#f59e0b":C().pillBdr;
    ctx.lineWidth=1; ctx.stroke();
    ctx.font="15px serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillStyle="#ffffff";
    ctx.fillText(edge.icon,mx,my-22);
  }
  ctx.restore();
}

function drawLandmarks(step) {
  for (const n of NODES) drawPin(n, nodeState(n.id, step), step);
}

function drawPin(n, state, step) {
  const cx=n.x, cy=n.y, r=PIN_R;
  const fill=STATE_FILL[state]||STATE_FILL.idle;
  ctx.save();
  ctx.shadowColor="rgba(0,0,0,0.5)"; ctx.shadowBlur=10; ctx.shadowOffsetY=4;
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.fillStyle=fill; ctx.fill();
  ctx.strokeStyle=C().pinStroke; ctx.lineWidth=2.5; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx-6,cy+r-2); ctx.lineTo(cx+6,cy+r-2); ctx.lineTo(cx,cy+r+9);
  ctx.closePath(); ctx.fillStyle=fill; ctx.fill();
  ctx.strokeStyle=C().pinStroke; ctx.lineWidth=1.5; ctx.stroke();
  ctx.shadowColor="transparent"; ctx.shadowBlur=0; ctx.shadowOffsetY=0;
  if(n.id===sourceId){ctx.beginPath();ctx.arc(cx,cy,r+5,0,Math.PI*2);ctx.strokeStyle="#10b981";ctx.lineWidth=3;ctx.stroke();}
  if(n.id===targetId){ctx.beginPath();ctx.arc(cx,cy,r+5,0,Math.PI*2);ctx.strokeStyle="#ef4444";ctx.lineWidth=3;ctx.stroke();}
  if(fromMode||toMode){
    ctx.beginPath();ctx.arc(cx,cy,r+3,0,Math.PI*2);
    ctx.strokeStyle="rgba(56,189,248,0.45)";ctx.lineWidth=2;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);
  }
  ctx.font="18px serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillStyle="#ffffff";
  ctx.fillText(n.icon,cx,cy);
  if(step){
    const d=step.distances[n.id];
    const txt=Number.isFinite(d)?d+"m":"∞";
    ctx.font="bold 11px Consolas,monospace";
    const tw=ctx.measureText(txt).width, bx=cx, by=cy-r-12;
    ctx.fillStyle=C().badgeBg; roundRect(bx-tw/2-4,by-8,tw+8,16,4); ctx.fill();
    ctx.strokeStyle=C().badgeBdr; ctx.lineWidth=1; roundRect(bx-tw/2-4,by-8,tw+8,16,4); ctx.stroke();
    ctx.fillStyle=Number.isFinite(d)?C().badgeTxtFin:C().badgeTxtInf; ctx.fillText(txt,bx,by);
  }
  const lw=ctx.measureText(n.label).width, labelY=cy+r+13;
  ctx.font="bold 11px Segoe UI,sans-serif";
  ctx.fillStyle=C().labelBg; roundRect(cx-lw/2-4,labelY-1,lw+8,13,3); ctx.fill();
  ctx.fillStyle=state==="path"?"#fbbf24":C().labelTxt;
  ctx.textAlign="center"; ctx.textBaseline="top"; ctx.fillText(n.label,cx,labelY);
  ctx.restore();
}

/* ---- Panels ---- */
function renderAll() { draw(); renderPanels(); }

function renderPanels() {
  const step=curStep();
  pseudoItems.forEach(li=>li.classList.remove("active"));
  if(step?.pseudoLine!=null){const li=pseudoItems.find(x=>+x.dataset.line===step.pseudoLine);if(li)li.classList.add("active");}
  if(step){
    queueEl.innerHTML=step.queue.length===0
      ?'<span class="empty">empty</span>'
      :step.queue.map((q,i)=>`<span class="qitem${i===0?" head":""}">${getNode(q.id).icon} ${q.label}: ${fmtMin(q.dist)}</span>`).join("");
  } else { queueEl.innerHTML='<span class="empty">—</span>'; }
  const ordered=[...NODES].sort((a,b)=>a.label.localeCompare(b.label));
  tableBody.innerHTML=ordered.map(n=>{
    const d=step?fmtMin(step.distances[n.id]):"—";
    const pn=step&&step.previous[n.id]!=null?getNode(step.previous[n.id]).label:"—";
    let cls="",badge="—";
    if(step){const st=nodeState(n.id,step);
      if(st==="current"){cls="r-current";badge="checking";}
      else if(st==="path"){cls="r-path";badge="on route";}
      else if(st==="visited"){cls="r-visited";badge="confirmed";}
      else if(st==="frontier"){badge="queued";}}
    return `<tr class="${cls}"><td>${n.icon} ${n.label}</td><td>${d}</td><td>${pn}</td><td><span class="badge">${badge}</span></td></tr>`;
  }).join("");
  if(step){
    narrationEl.textContent=step.description;
    stepCounterEl.textContent=`${stepIndex+1} / ${steps.length}`;
    if(step.result){resultEl.textContent=step.result.text;resultEl.className="result "+(step.result.ok?"ok":"fail");}
    else{resultEl.textContent="";resultEl.className="result";}
    if(step.pathNodes){routeCardEl.innerHTML=buildRouteCard(step);routeCardEl.style.display="block";}
    else{routeCardEl.style.display="none";}
  } else {
    narrationEl.innerHTML='Select a scenario above, then press <b>Find Route</b>.';
    stepCounterEl.textContent=""; resultEl.textContent=""; resultEl.className="result";
    routeCardEl.style.display="none";
  }
}

function buildRouteCard(step) {
  const ids=step.pathNodes;
  const from=getNode(ids[0]), to=getNode(ids[ids.length-1]);
  let html=`<div class="rc-header">${from.icon} ${from.label} &rarr; ${to.icon} ${to.label}</div>`;
  for(let i=0;i<ids.length;i++){
    const n=getNode(ids[i]);
    html+=`<div class="rc-step" style="display:flex;justify-content:space-between"><span>${n.icon} <b>${n.label}</b></span><span style="color:var(--muted)">${step.distances[n.id]} min</span></div>`;
    if(i<ids.length-1){
      const e=getEdge(ids[i],ids[i+1]);
      const tl=e.weight<=5?"&#x1F6E3; Highway":e.weight<=10?"Main road":"&#x1F6B6; Slow road";
      html+=`<div class="rc-seg">&#8595; ${e.name} (${e.weight} min) &middot; ${tl}</div>`;
    }
  }
  const total=step.distances[ids[ids.length-1]];
  html+=`<div class="rc-total">&#9654; Total: ${total} min</div>`;
  const preset=PRESETS.find(p=>p.from===ids[0]&&p.to===ids[ids.length-1]);
  if(preset?.altRoute){
    const saved=preset.altRoute.cost-total;
    html+=`<div class="rc-alt">Alternative: ${preset.altRoute.label} = ${preset.altRoute.cost} min</div>`;
    if(saved>0) html+=`<div class="rc-save">&#10003; Dijkstra saves ${saved} min vs. alternative</div>`;
  }
  return html;
}

function updateAddressBar() {
  const f=sourceId?getNode(sourceId):null, t=targetId?getNode(targetId):null;
  addrFrom.innerHTML=f?`&#128204; ${f.icon} ${f.label}`:"&#128204; —";
  addrTo.innerHTML  =t?`&#127937; ${t.icon} ${t.label}`:"&#127937; —";
}

function loadPreset(idx) {
  currentPresetIdx=idx;
  const p=PRESETS[idx]; sourceId=p.from; targetId=p.to;
  updateAddressBar(); invalidateRun();
}

/* ---- Interaction ---- */
canvas.addEventListener("mousedown", evt => {
  if(!fromMode&&!toMode) return;
  const p=toCanvas(evt), n=pinAt(p.x,p.y);
  if(!n){ fromMode=toMode=false;
    document.getElementById("btnFrom").classList.remove("active");
    document.getElementById("btnTo").classList.remove("active");
    canvas.style.cursor="default"; draw(); return; }
  if(fromMode){ sourceId=n.id; if(targetId===n.id)targetId=null; fromMode=false; document.getElementById("btnFrom").classList.remove("active"); }
  else        { targetId=n.id; if(sourceId===n.id)sourceId=null;  toMode=false;  document.getElementById("btnTo").classList.remove("active"); }
  canvas.style.cursor="default";
  const pi=PRESETS.findIndex(p=>p.from===sourceId&&p.to===targetId);
  if(pi>=0){currentPresetIdx=pi;document.getElementById("scenarioPicker").value=pi;}
  updateAddressBar(); invalidateRun();
});
document.getElementById("scenarioPicker").addEventListener("change",e=>loadPreset(+e.target.value));
document.getElementById("btnFrom").addEventListener("click",()=>{
  fromMode=!fromMode; toMode=false;
  document.getElementById("btnFrom").classList.toggle("active",fromMode);
  document.getElementById("btnTo").classList.remove("active");
  canvas.style.cursor=fromMode?"crosshair":"default";
});
document.getElementById("btnTo").addEventListener("click",()=>{
  toMode=!toMode; fromMode=false;
  document.getElementById("btnTo").classList.toggle("active",toMode);
  document.getElementById("btnFrom").classList.remove("active");
  canvas.style.cursor=toMode?"crosshair":"default";
});
document.getElementById("btnRun").addEventListener("click",runDijkstra);
document.getElementById("btnStep").addEventListener("click",stepForward);
document.getElementById("btnBack").addEventListener("click",stepBack);
document.getElementById("btnPlay").addEventListener("click",togglePlay);
document.getElementById("btnReset").addEventListener("click",resetRun);
window.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    fromMode=toMode=false;
    document.getElementById("btnFrom").classList.remove("active");
    document.getElementById("btnTo").classList.remove("active");
    canvas.style.cursor="default"; draw();
  }
});

/* ---- Init ---- */
loadPreset(0);
renderAll();

window.addEventListener("themechange", renderAll);
