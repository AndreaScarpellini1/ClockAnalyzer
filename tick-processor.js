// tick-processor.js (AudioWorkletGlobalScope)
class TickProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return []; }

  constructor() {
    super();
    // ====== Tunables (start here) ======
    this.COOLDOWN_MS   = 130;   // prevents double counts
    this.ECHOGATE_MS   = 20;    // kills early reflections
    this.TAU_ENV_MS    = 8;     // fast envelope smoother
    this.TAU_NOISE_MS  = 600;   // slow noise-floor tracker
    this.HYST_DB       = 6;     // th_on - th_off gap
    this.MIN_SNR_DB    = 6;     // floor for acceptance
    this.PERIOD_M      = 7;     // robust median over last M
    this.PRED_TOL_PCT  = 0.28;  // ±28% gating band
    // ===================================

    this.fs = sampleRate;
    this.a_env  = Math.exp(-1 / (this.TAU_ENV_MS  * 0.001 * this.fs));
    this.a_noise= Math.exp(-1 / (this.TAU_NOISE_MS* 0.001 * this.fs));
    this.hystLin = Math.pow(10, this.HYST_DB / 20);
    this.minSnr  = Math.pow(10, this.MIN_SNR_DB / 20);

    this.prev1 = 0; this.prev2 = 0;
    this.env = 0; this.noise = 1e-9;

    this.inBurst = false;
    this.burstPeak = 0;
    this.burstPeakTime = 0;

    this.lastAccepted = -1e9;
    this.lastPosted   = -1e9;
    this.periods = [];   // rolling intervals for median
  }

  median(arr) {
    if (!arr.length) return NaN;
    const a = arr.slice().sort((x, y) => x - y);
    const mid = a.length >> 1;
    return (a.length % 2) ? a[mid] : 0.5 * (a[mid - 1] + a[mid]);
  }

  process(inputs) {
    const ch = inputs[0];
    if (!ch || !ch[0]) return true;
    const x = ch[0];
    const now0 = currentTime; // start time of this block (seconds)
    const fs = this.fs;

    for (let i = 0; i < x.length; i++) {
      const s0 = x[i];                // current
      const s1 = this.prev1;          // prev
      const s2 = this.prev2;          // prevprev

      // --- TKEO-like instantaneous energy (streaming form) ---
      let e = s1 * s1 - s2 * s0;
      if (e < 0) e = 0;

      // --- Envelope + noise floor (IIR smoothers) ---
      this.env   = this.env + (1 - this.a_env)   * (e - this.env);
      this.noise = this.noise + (1 - this.a_noise) * (this.env - this.noise);
      const th_on  = Math.max(this.noise * this.minSnr, 1e-8);
      const th_off = th_on / this.hystLin;

      const t = now0 + i / fs;

      // --- Burst state machine with hysteresis ---
      if (!this.inBurst) {
        if (this.env > th_on) {
          this.inBurst = true;
          this.burstPeak = this.env;
          this.burstPeakTime = t;
        }
      } else {
        // track peak within the burst
        if (this.env > this.burstPeak) {
          this.burstPeak = this.env;
          this.burstPeakTime = t;
        }
        // burst ends when we fall below th_off
        if (this.env < th_off) {
          const candidateTime = this.burstPeakTime;
          this.inBurst = false;

          // --- Echo gate / cooldown ---
          const dtEcho = (candidateTime - this.lastPosted) * 1000;
          const dtCool = (candidateTime - this.lastAccepted) * 1000;
          if (dtEcho < this.ECHOGATE_MS) continue;
          if (dtCool < this.COOLDOWN_MS) continue;

          // --- Periodicity gate ---
          let okPeriod = true;
          if (this.periods.length > 2) {
            const Texp = this.median(this.periods);
            const tol = this.PRED_TOL_PCT * Texp;
            const since = (candidateTime - this.lastAccepted);
            // accept if candidate is near multiples of Texp (first-order)
            // Here we only check the 1× multiple:
            const err = Math.abs(since - Texp);
            okPeriod = (err <= tol) || (since > 2.5 * Texp); // allow re-lock
          }

          if (!okPeriod) continue;

          // --- Accept tick ---
          const last = this.lastAccepted;
          this.lastAccepted = candidateTime;
          this.lastPosted   = candidateTime;
          if (Number.isFinite(last)) {
            const T = candidateTime - last;
            // keep a short rolling window
            this.periods.push(T);
            if (this.periods.length > this.PERIOD_M) this.periods.shift();
          }

          // optional confidence (0..1): SNR × proximity
          const snr = this.burstPeak / Math.max(this.noise, 1e-9);
          let conf = Math.min(1, Math.log10(1 + snr) / 2); // mild compression
          if (this.periods.length > 2) {
            const Texp = this.median(this.periods);
            const since = (candidateTime - last);
            const prox = 1 - Math.min(1, Math.abs(since - Texp) / (this.PRED_TOL_PCT * Texp + 1e-9));
            conf = 0.6 * conf + 0.4 * prox;
          }

          this.port.postMessage({ t: candidateTime, confidence: conf });
        }
      }

      // shift samples for next iteration
      this.prev2 = s1;
      this.prev1 = s0;
    }
    return true;
  }
}

registerProcessor('tick-processor', TickProcessor);
