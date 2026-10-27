// ADR 0020: pitch shift for the voice effects. Served by the bundle origin (script-src 'self').
// Two read taps sweep a short delay line at a rate set by the ratio; sin² windows half a period
// apart sum to one, so the crossfade keeps the level. Latency stays under one window (30 ms).

const WINDOW_SECONDS = 0.03;

class PitchShift extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const ratio = options?.processorOptions?.ratio;
    this.ratio = Number.isFinite(ratio) && ratio >= 0.5 && ratio <= 2 ? ratio : 1;
    this.window = Math.max(64, Math.round(sampleRate * WINDOW_SECONDS));
    this.buffer = new Float32Array(this.window * 2 + 2);
    this.write = 0;
    this.phase = 0;
  }

  read(delay) {
    const size = this.buffer.length;
    const position = this.write - delay;
    const base = Math.floor(position);
    const fraction = position - base;
    const first = this.buffer[((base % size) + size) % size];
    const second = this.buffer[(((base + 1) % size) + size) % size];
    return first + (second - first) * fraction;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const out = output[0];
    const step = (1 - this.ratio) / this.window;
    for (let index = 0; index < out.length; index++) {
      this.buffer[this.write % this.buffer.length] = input ? input[index] : 0;
      const first = this.phase;
      const second = (this.phase + 0.5) % 1;
      const a = Math.sin(Math.PI * first);
      const b = Math.sin(Math.PI * second);
      out[index] = this.read(first * this.window + 1) * a * a + this.read(second * this.window + 1) * b * b;
      this.phase = (((this.phase + step) % 1) + 1) % 1;
      this.write = (this.write + 1) % (this.buffer.length * 1024);
    }
    for (let channel = 1; channel < output.length; channel++) output[channel].set(out);
    return true;
  }
}

registerProcessor("openmeet-pitch-shift", PitchShift);
