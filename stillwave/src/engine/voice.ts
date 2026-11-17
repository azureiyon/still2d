// Microphone loudness as a 0..1 signal, for lip movement.
export class Voice {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private floor = 0.01;

  get active() {
    return !!this.analyser;
  }

  async start() {
    if (this.analyser) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buf = new Float32Array(this.analyser.fftSize);
    src.connect(this.analyser);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
  }

  /** Current loudness, with a slowly adapting noise floor removed. */
  level(): number {
    if (!this.analyser || !this.buf) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    this.floor += (Math.min(rms, 0.05) - this.floor) * (rms < this.floor ? 0.2 : 0.002);
    return Math.min(1, Math.max(0, (rms - this.floor * 1.6) * 9));
  }
}
