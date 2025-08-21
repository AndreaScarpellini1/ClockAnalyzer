# Pendulum Tick Analyzer — GUI & Code Structure

A lightweight, browser-based tool to detect mechanical “tick” sounds from a microphone, estimate **seconds-counting frequency (Hz)**, and compute **Anticipation/Retard (min/day)** over a configurable time window.

---

## Quick start

### Easiest (Windows)
1. Double-click **`run_server.bat`** in the project folder.
2. Your browser opens at `http://localhost:8000/index.html`.
   - The script launches a minimal Python web server on port 8000 and opens the app page automatically.

### Cross-platform (any OS)
```bash
# From the project folder:
python -m http.server 8000
# then open http://localhost:8000/index.html
```

> **Why a server?** ES modules and the AudioWorklet must be loaded from the **same origin** over **http(s)** (not `file://`). The app will warn you if it’s not served from a secure/localhost origin.

### Browser permissions
- When the page loads, click **Start** and allow **Microphone** access.
- For best results, **disable OS audio enhancements** (AGC/Noise Suppression/Echo Cancellation) on your input device.

---

## What you see in the GUI

- **Click type** selector:
  - *Pendulum — 2 clicks per cycle* (left+right)
  - *Single-click clock — 1 click per cycle*  
  Used to convert “click-Hz” into **seconds-counting Hz**.

- **High-pass / Low-pass** filter cutoffs (live-tweakable) to isolate the tick band. Defaults: HP=800 Hz, LP=5000 Hz.

- **Rate window (s)** slider: choose **5 / 10 / 20 / 30 s** for the moving window used in the **min/day** calculation (chip displays the current choice).

- **Frequency distribution (Hz)** histogram (seconds-counting). **Avg** and **SD** shown beneath.

- **Anticipation / Retard (min/day)** big numeric tile, computed over the selected window.

- **Tick intervals** plot: time (s) vs Δt(s) showing raw inter-click intervals over the session.

The HTML arranges these controls and canvases; styles define the dark theme, grid layout, slider marks, and chips.

---

## Repository layout

```
index.html          # App shell and DOM elements for controls & charts
styles.css          # Dark UI theme, layout grid, slider marks
app.js              # UI logic, stats, charts, and AudioEngine wiring
audio-engine.js     # Microphone pipeline + AudioWorklet/ScriptProcessor
tick-processor.js   # Worklet: signal envelope + peak (tick) detection
run_server.bat      # Windows helper: localhost web server launcher
LICENSE             # MIT License
README.md           # This file
```

- **`index.html`**: Declares the controls (click-type selector, HP/LP inputs, window slider, Start/Stop) and canvases for the histogram and interval plot; boots the app with a module script.  
- **`styles.css`**: UI tokens, compact card layout, grid for “histogram + rate” tiles, and slider tick marks.  
- **`app.js`**: Orchestrates state, draws charts, computes statistics, and wires UI events to the audio backend.  
- **`audio-engine.js`**: Owns the Web Audio graph, requests mic access, builds HP/LP filters, attaches the Worklet (or ScriptProcessor fallback), and calls back `onTick(tSeconds)` for each detected tick.  
- **`tick-processor.js`**: Runs in the **AudioWorkletGlobalScope**; performs envelope following and peak detection with an adaptive threshold and a refractory “cooldown,” posting precise tick timestamps to the main thread.

---

## How it works (end-to-end)

### Signal path (Web Audio graph)

```
Microphone
   │  getUserMedia (raw: no EC/NS/AGC)
   ▼
High-pass (Biquad) ─► Low-pass (Biquad)
   │                         │
   └──────────► (Worklet or ScriptProcessor) ─► Silent Gain ─► Destination
                                   │
                                   └── postMessage(tick time)
```

- The **AudioEngine** requests the mic **without** echo cancellation, noise suppression, or auto-gain to preserve ticks. It then builds: `mic → HP → LP → (Worklet|fallback) → silent gain → destination`. The Worklet is preferred; a **ScriptProcessor** mirror exists for older engines.

- The Worklet fetch/module-loads `tick-processor.js` from the same origin; if this fails, a warning is logged and the fallback takes over automatically.

### Tick detection (Worklet)

Inside `tick-processor.js`:
- Rectify and **exponential envelope** (`env = max(|x|, env*decay)`).
- **Adaptive threshold** (`th = base + 0.5*env`).
- Detect a **peak** when the envelope turns downward and was above threshold; then post the absolute **AudioContext time** for the tick.  
- **Cooldown** (~150 ms) prevents double counts.

The ScriptProcessor fallback mimics the same envelope/threshold/cooldown logic in the main thread.

### From ticks → stats & charts (main thread)

`app.js` maintains:
- `tickTimes` (absolute seconds) and `intervals` (Δt between clicks). A 200 ms debounce avoids spurious duplicates before stats.
- **Frequency (seconds-counting)**:  
  1) Convert click intervals to click-Hz,  
  2) Divide by **k = clicks per cycle** from the *Click type* selector (2 for pendulums, 1 for single-click clocks).  
  These **seconds-counting Hz** feed both the histogram and the global Avg/SD.
- **Rate window** (5/10/20/30 s): Using only the **last N seconds** of ticks, compute the average **seconds-counting Hz** and convert to **min/day** relative to a **1.000 Hz** target:
  
  \[
  \text{min/day} = 1440 \times \left(\frac{f_\text{win}}{1.0\ \text{Hz}} - 1\right)
  \]
  
  The UI labels this as **anticipation** (positive) or **retard** (negative) and shows the window length used.
- **Charts**:  
  - **Histogram** of seconds-counting Hz with dynamic binning and axes.  
  - **Intervals** line+points: time (s) since first tick vs Δt(s) for each interval, with axes and ticks.

---

## Usage tips

- **Filters**: Start with **HP=800 Hz**, **LP=5000 Hz**; adjust to bracket the tick spectrum and suppress low, broadband noise. HP/LP changes take effect live.
- **Click type**:  
  - *Pendulum*: choose **2** (two clicks per full cycle).  
  - *Single-click clock*: choose **1**.  
  All stats (histogram & min/day) are computed in **seconds-counting** terms using this selection.
- **Window**: Shorter (5 s) reacts faster; longer (30 s) is steadier. The big rate value shows which window is used.
- **Environment**: Get the mic close, keep the room quiet, and avoid AGC/Noise Suppression on your input device to prevent tick smearing.

---

## Troubleshooting

- **“Needs HTTPS/localhost” warning**: Serve the folder with a local server (see *Quick start*). AudioWorklet and mic permissions won’t work from `file://`.
- **Worklet fails to load**: Ensure `tick-processor.js` is reachable at the same origin. The engine will fall back to ScriptProcessor automatically (with a console warning).
- **No ticks detected**: Bring the mic closer, widen the LP cutoff, raise HP a bit to cut rumble, and confirm OS enhancements are off.
- **Counts look doubled/halved**: Verify the **Click type** (1 vs 2). This directly rescales to seconds-counting frequency.
- **Very fast escapements**: There’s a 150 ms refractory in detection plus a 200 ms UI debounce—suitable for clocks and pendulums; extremely high-rate sources may require tuning (see *Extending / tuning*).

---

## Extending / tuning

- **Detection sensitivity**: Adjust `th`, `decay`, and `cool` in `tick-processor.js` for different acoustics.
- **Window presets**: Edit `WINDOW_OPTIONS = [5, 10, 20, 30]` in `app.js` to add/change durations.
- **Custom metrics**: Hook into `onTick(t)` in `app.js` to log ticks, export CSV, or compute additional watchmaking metrics (beat error, amplitude, etc.).
- **Filter defaults**: Change the initial values bound to the HP/LP inputs in `index.html` or set programmatically after `engine.start()`.

---

## Tech notes

- **No build step**: Plain ES modules; no bundler required. Just serve the folder.
- **Browser support**: Modern Chromium/Firefox/Safari. If AudioWorklet isn’t available, the ScriptProcessor fallback keeps things working at the expense of some latency/CPU.
- **Sample rate**: The engine doesn’t force a sample rate; iOS prefers the system default.

---

## License

Released under the **MIT License** (see `LICENSE`).
