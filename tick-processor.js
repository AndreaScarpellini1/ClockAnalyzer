// tick-processor.js
// -----------------------------------------------------------------------------
// This is executed inside the AudioWorkletGlobalScope (audio rendering thread),
// not on the main JS thread. It receives audio buffers, follows the envelope,
// detects "tick" peaks, and posts back the exact timestamp of each detected tick.
// -----------------------------------------------------------------------------

class TickProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Simple envelope/peak detector state
    this.env = 0;          // smoothed absolute value
    this.prev = 0;         // previous envelope sample
    this.th = 0.02;        // base threshold
    this.decay = 0.997;    // envelope decay factor per sample
    this.cool = 0;         // refractory samples to avoid double counts
  }

  process(inputs) {
    // We only care about the first channel of the first input
    const input = inputs?.[0]?.[0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      // Rectify then follow envelope with exponential decay
      const x = Math.abs(input[i]);
      this.env = Math.max(x, this.env * this.decay);
      const y = this.env;

      // Adaptive threshold rises with the envelope
      const th = this.th + 0.5 * this.env;

      // Cooldown counter (in samples)
      if (this.cool > 0) this.cool--;

      // Peak detect: envelope just turned downward and was above threshold
      if (this.prev > y && this.prev > th && this.cool === 0) {
        // Convert sample index to absolute AudioContext time
        this.port.postMessage({ t: currentTime + i / sampleRate });
        // Refractory ≈150 ms at current sampleRate
        this.cool = Math.floor(sampleRate * 0.15);
      }

      this.prev = y;
    }

    return true; // keep processor alive
  }
}

// Register this processor under the given name
registerProcessor('tick-processor', TickProcessor);
