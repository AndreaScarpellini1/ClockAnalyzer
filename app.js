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

// Histogram (Hz) — seconds-counting
function drawHistogram(freqs){
  const w = histCv.clientWidth, h = histCv.clientHeight;
  if (histCv.width !== w) histCv.width = w;
  if (histCv.height !== h) histCv.height = h;
  hctx.clearRect(0,0,w,h);
  if (!freqs || freqs.length < 5) return;

  const minF = Math.min(...freqs), maxF = Math.max(...freqs);
  const pad = (maxF - minF) * 0.05 || 0.01;
  const lo = minF - pad, hi = maxF + pad;

  const bins = Math.min(40, Math.max(15, Math.floor(Math.sqrt(freqs.length))));
  const counts = new Array(bins).fill(0);
  const step = (hi - lo) / bins;
  for (const f of freqs){
    const idx = Math.min(bins-1, Math.max(0, Math.floor((f - lo) / step)));
    counts[idx]++;
  }
  const maxCount = Math.max(...counts) || 1;

  // axes
  hctx.strokeStyle = 'rgba(255,255,255,0.15)';
  hctx.lineWidth = 1;
  hctx.beginPath();
  hctx.moveTo(40.5, 10.5); hctx.lineTo(40.5, h-30.5);
  hctx.lineTo(w-10.5, h-30.5);
  hctx.stroke();

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
  if (intervals.length < 2) return;

  const t0 = tickTimes[0];
  const xs = intervals.map((_,i)=> (tickTimes[i+1] - t0));
  const ys = intervals; // seconds

  const xMin = 0, xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.1 || 0.05;

  const left=46, bottom=28, top=10, right=10;
  const plotW = w - left - right;
  const plotH = h - top - bottom;

  // Axes
  ictx.strokeStyle = 'rgba(255,255,255,0.15)';
  ictx.lineWidth = 1;
  ictx.beginPath();
  ictx.moveTo(left+0.5, top+0.5); ictx.lineTo(left+0.5, h-bottom+0.5);
  ictx.lineTo(w-right+0.5, h-bottom+0.5);
  ictx.stroke();

  // Labels
  ictx.fillStyle = 'rgba(229,231,235,0.85)';
  ictx.font = '12px system-ui';
  ictx.fillText('time (s)', w - 80, h - 6);
  ictx.save(); ictx.translate(12, h/2); ictx.rotate(-Math.PI/2);
  ictx.fillText('Δt (s)', 0, 0); ictx.restore();

  // Scales
  const xTicks = 5;
  for (let i=0;i<=xTicks;i++){
    const t = xMin + (i/xTicks)*(xMax - xMin);
    const x = left + (xMax - xMin ? (t - xMin)/(xMax - xMin) * plotW : 0);
    ictx.fillText(t.toFixed(1), x-10, h-bottom+18);
  }
  const yTicks = 4;
  const y0 = yMin - yPad, y1 = yMax + yPad;
  for (let i=0;i<=yTicks;i++){
    const v = y0 + (i/yTicks)*(y1 - y0);
    const y = h - bottom - (y1 - y0 ? (v - y0)/(y1 - y0) * plotH : 0);
    ictx.fillText(v.toFixed(3), 6, y+4);
  }

  // Polyline + points
  ictx.beginPath();
  for (let i=0;i<xs.length;i++){
    const x = left + (xMax - xMin ? (xs[i]-xMin)/(xMax-xMin) * plotW : 0);
    const y = h - bottom - (y1 - y0 ? (ys[i]-y0)/(y1 - y0) * plotH : 0);
    if (i===0) ictx.moveTo(x,y); else ictx.lineTo(x,y);
  }
  ictx.strokeStyle = 'rgba(34, 211, 238, 0.9)'; ictx.lineWidth = 1.5; ictx.stroke();

  ictx.fillStyle = 'rgba(34, 211, 238, 0.9)';
  for (let i=0;i<xs.length;i++){
    const x = left + (xMax - xMin ? (xs[i]-xMin)/(xMax-xMin) * plotW : 0);
    const y = h - bottom - (y1 - y0 ? (ys[i]-y0)/(y1 - y0) * plotH : 0);
    ictx.beginPath(); ictx.arc(x,y,2,0,Math.PI*2); ictx.fill();
  }
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
  const lastT = tickTimes[tickTimes.length - 1];
  const winSec = getWindowSeconds();
  const tStart = lastT - winSec;
  let i0 = tickTimes.length - 1;
  while (i0 > 0 && tickTimes[i0 - 1] >= tStart) i0--;
  const i1 = tickTimes.length - 1;

  let avgHzWinSec = NaN;
  if (i1 - i0 >= 1) {
    const duration = tickTimes[i1] - tickTimes[i0];
    if (duration > 0) {
      const nIntervals = (i1 - i0);        // number of click intervals in window
      const avgHzClick = nIntervals / duration; // clicks per second
      avgHzWinSec = avgHzClick / k;        // convert to seconds-counting Hz
    }
  }

  // Convert to min/day vs 1 Hz (seconds-counting target)
  const fTarget = 1.0;
  const minPerDay = (isFinite(avgHzWinSec))
    ? 1440 * (avgHzWinSec / fTarget - 1)
    : NaN;

  if (isFinite(minPerDay)) {
    const label = minPerDay >= 0 ? 'anticipation' : 'retard';
    rateMinEl.textContent = `${minPerDay>=0?'+':''}${minPerDay.toFixed(2)} min/day (${label}, ${winSec}s window)`;
  } else {
    rateMinEl.textContent = '—';
  }

  // Draw
  drawHistogram(freqsSec);
  drawIntervals();
}

// Tick callback from backend
function onTick(t){
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
  tickTimes = []; intervals = []; updateStats();
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
