// app.js
// -----------------------------------------------------------------------------
// Frontend only: wires the UI to the AudioEngine, keeps tick history,
// computes statistics, and renders the tiny sparkline.
// -----------------------------------------------------------------------------

import { AudioEngine } from './audio-engine.js';

// ====== DOM refs ======
const startBtn   = document.getElementById('startBtn');
const stopBtn    = document.getElementById('stopBtn');
const periodOut  = document.getElementById('periodOut');
const rateOut    = document.getElementById('rateOut');
const beatOut    = document.getElementById('beatOut');
const spark      = document.getElementById('spark');
const hpEl       = document.getElementById('hp');
const lpEl       = document.getElementById('lp');
const targetEl   = document.getElementById('targetPeriod');
const ctx2d      = spark.getContext('2d');

// ====== App state ======
let tickTimes = [];   // seconds (AudioContext time of each detected tick)
let intervals = [];   // ms (differences of tickTimes)
const MAX_TICKS = 1200;

// ====== Helpers ======
function median(arr){
  if(!arr.length) return NaN;
  const a = [...arr].sort((x,y)=>x-y);
  const mid = Math.floor(a.length/2);
  return a.length%2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
}

// Draw simple sparkline of most recent intervals
function drawSpark(){
  const w = spark.clientWidth, h = spark.clientHeight;
  if (spark.width  !== w) spark.width  = w;
  if (spark.height !== h) spark.height = h;
  ctx2d.clearRect(0,0,w,h);

  if (intervals.length < 2) return;
  const recent = intervals.slice(-200);
  const max = Math.max(...recent);
  const min = Math.min(...recent);
  const pad = 8;

  ctx2d.beginPath();
  recent.forEach((v,i)=>{
    const x = pad + (i / (recent.length - 1)) * (w - 2*pad);
    const y = h - pad - ((v - min) / (max - min + 1e-6)) * (h - 2*pad);
    if (i === 0) ctx2d.moveTo(x,y); else ctx2d.lineTo(x,y);
  });
  ctx2d.strokeStyle = '#22d3ee';
  ctx2d.lineWidth = 2;
  ctx2d.stroke();
}

// Recompute stats whenever tickTimes or target changes
function updateStats(){
  if (tickTimes.length < 6) {
    periodOut.textContent = '—';
    rateOut.textContent   = '—';
    beatOut.textContent   = '—';
    return;
  }
  intervals = tickTimes.slice(1).map((t,i)=> (t - tickTimes[i]) * 1000);
  const medMs = median(intervals);

  const target = parseFloat(targetEl.value || '1'); // seconds / tick
  const rateSecPerDay = ((medMs/1000 - target) / target) * 86400;

  // Beat error: difference between alternating intervals (tick vs tock)
  const even = intervals.filter((_,i)=> i%2===0);
  const odd  = intervals.filter((_,i)=> i%2===1);
  const be = Math.abs(median(even) - median(odd)); // ms

  periodOut.textContent = `${medMs.toFixed(2)} ms`;
  const cls = rateSecPerDay > 0 ? 'bad' : 'good';
  rateOut.innerHTML = `<span class="${cls}">${rateSecPerDay>=0?'+':''}${rateSecPerDay.toFixed(1)} s/day</span>`;
  beatOut.textContent = isFinite(be) ? `${be.toFixed(1)} ms` : '—';

  drawSpark();
}

// When the backend detects a tick, we update our history & stats
function onTick(t){
  const last = tickTimes.length ? tickTimes[tickTimes.length-1] : -1e9;
  if (t - last > 0.2) { // simple debounce (>200 ms)
    tickTimes.push(t);
    if (tickTimes.length > MAX_TICKS) tickTimes = tickTimes.slice(-MAX_TICKS);
    updateStats();
  }
}

// ====== Backend instance ======
const engine = new AudioEngine({ onTick });

// ====== UI Wiring ======

// Start: request mic, spin up audio engine
startBtn.addEventListener('click', async ()=>{
  startBtn.disabled = true; stopBtn.disabled = false;

  // FYI: on file:// many browsers block worklets; use http(s)/localhost for best results.
  if (!window.isSecureContext && location.hostname !== 'localhost') {
    alert('Tip: serve this over HTTPS or http://localhost for full functionality.');
  }

  try {
    await engine.start({ hpHz: parseFloat(hpEl.value || '800'),
                         lpHz: parseFloat(lpEl.value || '5000') });
  } catch (err) {
    console.error(err);
    alert('Audio setup failed: ' + (err?.message || err));
    startBtn.disabled = false; stopBtn.disabled = true;
  }
});

// Stop: tear everything down
stopBtn.addEventListener('click', async ()=>{
  stopBtn.disabled = true; startBtn.disabled = false;
  try { await engine.stop(); } catch {}
  // (Keep history/plot; if you want to clear: uncomment below)
  // tickTimes = []; intervals = []; updateStats();
});

// Live-update filters: send new cutoffs to the backend
hpEl.addEventListener('input', ()=> engine.setHP(parseFloat(hpEl.value)));
lpEl.addEventListener('input', ()=> engine.setLP(parseFloat(lpEl.value)));
hpEl.addEventListener('change',()=> engine.setHP(parseFloat(hpEl.value)));
lpEl.addEventListener('change',()=> engine.setLP(parseFloat(lpEl.value)));

// Changing target period only affects stats
targetEl.addEventListener('input', updateStats);

// Resize-aware sparkline
new ResizeObserver(drawSpark).observe(spark);
