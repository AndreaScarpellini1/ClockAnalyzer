// Frontend: UI + stats + charts (seconds-counting mode)
import { AudioEngine } from './audio-engine.js';

// DOM refs
const startBtn     = document.getElementById('startBtn');
const stopBtn      = document.getElementById('stopBtn');
const clickTypeEl  = document.getElementById('clickType');
const avgHzEl      = document.getElementById('avgHz');
const stdHzEl      = document.getElementById('stdHz');
const rateMinEl    = document.getElementById('rateMinDay');
const histCv       = document.getElementById('hist');
const intervalsCv  = document.getElementById('intervals');
const hpEl         = document.getElementById('hp');
const lpEl         = document.getElementById('lp');
const hctx         = histCv.getContext('2d');
const ictx         = intervalsCv.getContext('2d');

// NEW: window length control (5,10,20,30 s)
const WINDOW_OPTIONS = [5, 10, 20, 30];
const winSlider = document.getElementById('winSlider');
const winLabel  = document.getElementById('winLabel');
function getWindowSeconds(){
  const idx = Math.min(WINDOW_OPTIONS.length-1, Math.max(0, parseInt(winSlider.value || '0', 10)));
  return WINDOW_OPTIONS[idx];
}
winSlider.addEventListener('input', ()=>{
  winLabel.textContent = getWindowSeconds() + ' s';
  updateStats();
});
winLabel.textContent = getWindowSeconds() + ' s'; // initial

// State
let tickTimes = []; // absolute seconds
let intervals = []; // seconds between consecutive clicks
const MAX_TICKS = 10000;

// Utils
function mean(arr){ if(!arr.length) return NaN; return arr.reduce((a,b)=>a+b,0)/arr.length; }
function stddev(arr){ if(arr.length<2) return 0; const m=mean(arr); return Math.sqrt(arr.reduce((s,x)=>s+(x-m)*(x-m),0)/(arr.length-1)); }

// ===== Session capture + export =====
const SESSION_VERSION = '1.0.0';
let capture = null; // {app,version,startedAt,endedAt,params,raw:{ticks:Array<{t:number,confidence?:number}>}}

function startCapture() {
  capture = {
    app: "Pendulum Tick Analyzer",
    version: SESSION_VERSION,
    startedAt: new Date().toISOString(),
    endedAt: null,
    params: {},
    raw: { ticks: [] }
  };
}

function buildProcessed(captureObj, clicksPerCycle) {
  const ticks = captureObj.raw.ticks.map(e => e.t).sort((a,b)=>a-b);
  const intervalsSec = [];
  for (let i=1;i<ticks.length;i++) intervalsSec.push(ticks[i]-ticks[i-1]);
  const clickHz = intervalsSec.map(dt => dt>0 ? 1/dt : NaN);
  const k = clicksPerCycle || 1;
  const secondsCountingHz = clickHz.map(f=> f / k);
  const meanHz = mean(secondsCountingHz.filter(Number.isFinite));
  const sdHz   = stddev(secondsCountingHz.filter(Number.isFinite));
  const minPerDayFromMean = Number.isFinite(meanHz) ? 1440 * (meanHz - 1.0) : NaN;

  return {
    app: captureObj.app,
    version: captureObj.version,
    startedAt: captureObj.startedAt,
    endedAt: captureObj.endedAt,
    params: captureObj.params,
    counts: { ticks: ticks.length, intervals: intervalsSec.length },
    intervalsSec,
    clickHz,
    secondsCountingHz,
    summary: {
      meanSecondsCountingHz: meanHz,
      stdSecondsCountingHz: sdHz,
      minPerDay_fromMeanHz: minPerDayFromMean
    }
  };
}

function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function timestampTag() {
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
// ====================================

// Histogram (Hz) — seconds-counting
function drawHistogram(freqs){
  const w = histCv.clientWidth, h = histCv.clientHeight;
  if (histCv.width !== w) histCv.width = w;
  if (histCv.height !== h) histCv.height = h;

  hctx.clearRect(0,0,w,h);
  hctx.fillStyle = 'rgba(17,24,39,0.8)';
  hctx.fillRect(0,0,w,h);

  // axes
  hctx.strokeStyle = 'rgba(255,255,255,0.25)';
  hctx.lineWidth = 1;
  hctx.beginPath();
  hctx.moveTo(40, 10);
  hctx.lineTo(40, h-30);
  hctx.lineTo(w-10, h-30);
  hctx.stroke();

  // bins
  const valid = freqs.filter(Number.isFinite);
  if (!valid.length) return;
  const lo = Math.min(...valid), hi = Math.max(...valid);
  const span = Math.max(1e-6, hi - lo);
  const bins = 24;
  const counts = new Array(bins).fill(0);
  for (const f of valid) {
    let bi = Math.floor((f - lo) / span * bins);
    if (bi < 0) bi = 0; if (bi >= bins) bi = bins-1;
    counts[bi]++;
  }
  const maxCount = Math.max(...counts, 1);

  // y labels (counts)
  hctx.fillStyle = 'rgba(229,231,235,0.8)';
  hctx.font = '12px system-ui';
  for (let i=0;i<=4;i++){
    const y = (h-30) - (i/4)*(h-40);
    const val = Math.round((i/4)*maxCount);
    hctx.fillText(String(val), 8, y+4);
  }

  // bars
  const plotW = w - 55, plotH = h - 50;
  const barW = plotW / bins;
  for (let i=0;i<bins;i++){
    const c = counts[i];
    const barH = (c / maxCount) * plotH;
    const x = 45 + i*barW + 2;
    const y = h - 30 - barH;
    hctx.fillStyle = 'rgba(34, 211, 238, 0.7)';
    hctx.fillRect(x, y, Math.max(1, barW - 4), barH);
  }

  // x labels (Hz)
  hctx.fillStyle = 'rgba(229,231,235,0.8)';
  hctx.font = '12px system-ui';
  const ticks = 5;
  for(let i=0;i<=ticks;i++){
    const f = lo + (i/ticks)*(hi-lo);
    const x = 45 + (i/ticks)*plotW;
    hctx.fillText(f.toFixed(3)+' Hz', x-18, h-12);
  }
}

// Intervals plot (time s vs Δt s) — shows raw click intervals
function drawIntervals(){
  const w = intervalsCv.clientWidth, h = intervalsCv.clientHeight;
  if (intervalsCv.width !== w) intervalsCv.width = w;
  if (intervalsCv.height !== h) intervalsCv.height = h;

  ictx.clearRect(0,0,w,h);
  ictx.fillStyle = 'rgba(17,24,39,0.8)';
  ictx.fillRect(0,0,w,h);

  if (tickTimes.length < 2) return;

  const t0 = tickTimes[0];
  const xs = tickTimes.slice(1).map((t,i)=> (t - t0));
  const ys = tickTimes.slice(1).map((t,i)=> (t - tickTimes[i]));

  const minX = 0;
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  ictx.strokeStyle = 'rgba(255,255,255,0.25)';
  ictx.beginPath();
  ictx.moveTo(40, 10);
  ictx.lineTo(40, h-30);
  ictx.lineTo(w-10, h-30);
  ictx.stroke();

  const plotW = w - 55, plotH = h - 50;

  function xmap(x){ return 45 + (x - minX) / Math.max(1e-9,(maxX-minX)) * plotW; }
  function ymap(y){ return (h - 30) - (y - minY) / Math.max(1e-9,(maxY-minY)) * plotH; }

  // draw points and a thin polyline
  ictx.strokeStyle = 'rgba(59,130,246,0.6)';
  ictx.lineWidth = 1;
  ictx.beginPath();
  for (let i=0;i<xs.length;i++){
    const X = xmap(xs[i]), Y = ymap(ys[i]);
    if (i===0) ictx.moveTo(X,Y); else ictx.lineTo(X,Y);
  }
  ictx.stroke();

  ictx.fillStyle = 'rgba(96,165,250,0.8)';
  for (let i=0;i<xs.length;i++){
    ictx.beginPath();
    ictx.arc(xmap(xs[i]), ymap(ys[i]), 2.5, 0, Math.PI*2);
    ictx.fill();
  }

  // axes labels
  ictx.fillStyle = 'rgba(229,231,235,0.8)';
  ictx.font = '12px system-ui';
  ictx.fillText('time (s)', w - 80, h - 8);
  ictx.save();
  ictx.translate(12, 28);
  ictx.rotate(-Math.PI/2);
  ictx.fillText('Δt (s)', 0, 0);
  ictx.restore();
}

let lastFreqs = []; // for redraws

function updateStats(){
  // Need a few ticks before showing stats
  if (tickTimes.length < 6) {
    avgHzEl.textContent  = 'Avg: — Hz';
    stdHzEl.textContent  = 'SD: — Hz';
    rateMinEl.textContent = '—';
    lastFreqs = [];
    drawHistogram(lastFreqs);
    ictx && ictx.clearRect(0,0,intervalsCv.width, intervalsCv.height);
    return;
  }

  // Raw click intervals (s) and click-based Hz
  intervals = tickTimes.slice(1).map((t,i)=> (t - tickTimes[i]));
  const freqsClick = intervals.map(dt => dt>0 ? 1/dt : NaN).filter(x=>isFinite(x));

  // Convert to SECONDS-COUNTING frequency using clickType (k = clicks per cycle)
  const k = parseInt(clickTypeEl.value || '2', 10);  // 2 for pendulum, 1 for single-click
  const freqsSec = freqsClick.map(f => f / k);

  // Histogram + global stats in seconds-counting Hz
  lastFreqs = freqsSec;
  const avgAll = mean(freqsSec);
  const sdAll  = stddev(freqsSec);
  avgHzEl.textContent = 'Avg: ' + (isFinite(avgAll) ? avgAll.toFixed(3) : '—') + ' Hz';
  stdHzEl.textContent = 'SD: '  + (isFinite(sdAll) ? sdAll.toFixed(3) : '—') + ' Hz';

  // Windowed average over the LAST N SECONDS (seconds-counting)
  const windowSec = getWindowSeconds();
  const tMax = tickTimes[tickTimes.length-1];
  const cutT = tMax - windowSec;
  const idx0 = tickTimes.findIndex(t => t >= cutT);
  const sub = idx0 <= 0 ? freqsSec : freqsSec.slice(idx0-1);
  const fwin = mean(sub);

  const minPerDay = isFinite(fwin) ? 1440 * (fwin - 1.0) : NaN;
  rateMinEl.textContent = isFinite(minPerDay) ? (minPerDay>0?'+':'') + minPerDay.toFixed(1) + ' min/day' : '—';

  // plots
  drawHistogram(freqsSec);
  drawIntervals();
}

// ---- onTick: now accepts a number *or* an object {t, confidence} ----
function onTick(evt){
  const t = (typeof evt === 'number') ? evt : evt?.t;
  const confidence = (typeof evt === 'number') ? undefined : evt?.confidence;

  // record raw tick
  if (capture && Number.isFinite(t)) {
    capture.raw.ticks.push({ t, ...(confidence != null ? { confidence } : {}) });
  }

  const last = tickTimes.length ? tickTimes[tickTimes.length-1] : -1e9;
  if (t - last > 0.2) { // debounce >200 ms
    tickTimes.push(t);
    if (tickTimes.length > MAX_TICKS) tickTimes = tickTimes.slice(-MAX_TICKS);
    updateStats();
  }
}

// Backend
const engine = new AudioEngine({ onTick });

// UI wiring
startBtn.addEventListener('click', async ()=>{
  startBtn.disabled = true; stopBtn.disabled = false;
  startCapture();
  if (!window.isSecureContext && location.hostname !== 'localhost') {
    alert('Tip: serve over HTTPS or http://localhost for full functionality.');
  }
  try {
    await engine.start({ hpHz: parseFloat(hpEl.value || '800'),
                         lpHz: parseFloat(lpEl.value || '5000') });
  } catch (err) {
    console.error(err);
    alert('Audio start failed: ' + (err?.message || err));
    startBtn.disabled = false; stopBtn.disabled = true;
  }
});

stopBtn.addEventListener('click', async ()=>{
  try { await engine.stop(); } catch(e) { }
  startBtn.disabled = false; stopBtn.disabled = true;

  // Export session JSONs if we have a capture
  if (capture && capture.raw.ticks.length > 0) {
    capture.endedAt = new Date().toISOString();
    const clicksPerCycle = parseInt((clickTypeEl.value || '1'), 10);
    capture.params = {
      clicksPerCycle,
      hpHz: parseFloat(hpEl.value || '800'),
      lpHz: parseFloat(lpEl.value || '5000'),
      windowSec: getWindowSeconds(),
      ui: {
        avgHz: avgHzEl?.textContent || null,
        stdHz: stdHzEl?.textContent || null,
        minPerDay: rateMinEl?.textContent || null
      }
    };
    const processed = buildProcessed(capture, clicksPerCycle);
    const tag = timestampTag();
    downloadJSON(`session_raw_${tag}.json`, capture);
    downloadJSON(`session_processed_${tag}.json`, processed);
  }

  // Reset for next run
  tickTimes = []; intervals = []; updateStats();
  capture = null;
});

// Live filter changes
hpEl.addEventListener('input', ()=> engine.setHP(parseFloat(hpEl.value)));
lpEl.addEventListener('input', ()=> engine.setLP(parseFloat(lpEl.value)));
hpEl.addEventListener('change',()=> engine.setHP(parseFloat(hpEl.value)));
lpEl.addEventListener('change',()=> engine.setLP(parseFloat(lpEl.value)));

// React to click type changes immediately in stats
clickTypeEl.addEventListener('change', updateStats);

// Resize redraws
new ResizeObserver(()=>{ drawHistogram(lastFreqs); drawIntervals(); }).observe(histCv);
new ResizeObserver(()=>{ drawHistogram(lastFreqs); drawIntervals(); }).observe(intervalsCv);
