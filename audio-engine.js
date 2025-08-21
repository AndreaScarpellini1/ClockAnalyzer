// audio-engine.js
// -----------------------------------------------------------------------------
// This module owns *all* low-level audio: microphone access, filter nodes,
// AudioWorklet (preferred) or ScriptProcessor fallback (for older engines).
// It exposes a tiny API the UI can use:
//   const engine = new AudioEngine({ onTick: (tSeconds) => { ... } });
//   await engine.start({ hpHz, lpHz });
//   engine.setHP(hz); engine.setLP(hz);
//   await engine.stop();
//
// Notes:
// - Must be served over http(s)/localhost (secure context) for getUserMedia + worklet.
// - Worklet file tick-processor.js must be same-origin.
// -----------------------------------------------------------------------------

export class AudioEngine {
  constructor({ onTick } = {}) {
    this.onTick = typeof onTick === 'function' ? onTick : () => {};
    // Node handles
    this.ac = null; this.stream = null; this.mic = null;
    this.hp = null; this.lp = null; this.silent = null;
    this.workletNode = null; this.scriptNode = null;
  }

  // Convenience: safely disconnect + null a node
  #disc(nm) { try { if (this[nm]) this[nm].disconnect(); } catch {} this[nm] = null; }

  async start({ hpHz = 800, lpHz = 5000 } = {}) {
    // Request microphone (no EC/NS/AGC so we see raw ticks)
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false }
    });

    // Create audio context (don’t force sampleRate; iOS Safari prefers system default)
    this.ac = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ac.state === 'suspended') await this.ac.resume();

    // Build the graph front-end: mic -> HP -> LP -> (worklet | fallback) -> silent -> destination
    this.mic = this.ac.createMediaStreamSource(this.stream);

    this.hp = this.ac.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = hpHz;

    this.lp = this.ac.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = lpHz;

    // A muted gain to keep the graph "alive" without audible output
    this.silent = this.ac.createGain();
    this.silent.gain.value = 0;

    // Try AudioWorklet first
    let usingWorklet = false;
    if ('audioWorklet' in this.ac) {
      try {
        // Fetch first to surface 404/MIME/CSP issues clearly
        const probe = await fetch('./tick-processor.js', { cache: 'no-store' });
        if (!probe.ok) throw new Error(`tick-processor.js fetch failed (HTTP ${probe.status})`);
        await this.ac.audioWorklet.addModule('./tick-processor.js');

        this.workletNode = new AudioWorkletNode(this.ac, 'tick-processor');
        this.workletNode.port.onmessage = (e)=>{
          const data = e?.data;
          if (data && typeof data.t === 'number') this.onTick(data);
        };
        usingWorklet = true;
      } catch (err) {
        console.warn('[AudioEngine] Worklet unavailable, falling back:', err);
      }
    }

    if (usingWorklet) {
      this.mic.connect(this.hp); this.hp.connect(this.lp); this.lp.connect(this.workletNode);
      this.workletNode.connect(this.silent); this.silent.connect(this.ac.destination);
    } else {
      // ---- Fallback: ScriptProcessorNode (deprecated but widely supported) ----
      // One output channel is required; we write silence to it.
      const bufferSize = 1024;
      this.scriptNode = this.ac.createScriptProcessor(bufferSize, 1, 1);

      // Mirror the tick detector from tick-processor.js (simple env follower + peak detect)
      let env=0, prev=0, th0=0.02, decay=0.997, cool=0;
      this.scriptNode.onaudioprocess = (ev)=>{
        // input channel 0
        const input = ev.inputBuffer.getChannelData(0);
        // output channel 0 (stay silent)
        const out = ev.outputBuffer.getChannelData(0);
        out.fill(0);

        if (!input) return;
        const sr = ev.inputBuffer.sampleRate || this.ac.sampleRate;
        const t0 = (ev.playbackTime != null) ? ev.playbackTime : this.ac.currentTime;

        for (let i = 0; i < input.length; i++) {
          const x = Math.abs(input[i]);
          env = Math.max(x, env * decay);
          const y = env;
          const th = th0 + 0.5 * env;
          if (cool > 0) cool--;
          if (prev > y && prev > th && cool === 0) {
            this.onTick(t0 + i / sr);
            cool = Math.floor(sr * 0.15); // 150 ms refractory
          }
          prev = y;
        }
      };

      this.mic.connect(this.hp); this.hp.connect(this.lp); this.lp.connect(this.scriptNode);
      this.scriptNode.connect(this.silent); this.silent.connect(this.ac.destination);
    }
  }

  // Update filter cutoffs live (UI calls these)
  setHP(hz) { if (this.hp) this.hp.frequency.value = +hz || 0; }
  setLP(hz) { if (this.lp) this.lp.frequency.value = +hz || 0; }

  async stop() {
    // Disconnect nodes
    this.#disc('workletNode');
    this.#disc('scriptNode');
    this.#disc('lp');
    this.#disc('hp');
    this.#disc('mic');
    this.#disc('silent');

    // Close context
    if (this.ac) { try { await this.ac.close(); } catch {} this.ac = null; }

    // Stop mic tracks
    if (this.stream) {
      try { this.stream.getTracks().forEach(t => t.stop()); } catch {}
      this.stream = null;
    }
  }
}
