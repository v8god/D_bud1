export class MicrophoneLevelMonitor {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frameId: number | null = null;
  private sampleBuffer: Uint8Array<ArrayBuffer> | null = null;

  async start(onLevel: (level: number) => void): Promise<void> {
    this.stop();

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is unavailable in this WebView runtime.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });

    const AudioContextConstructor = window.AudioContext;
    const audioContext = new AudioContextConstructor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    this.stream = stream;
    this.audioContext = audioContext;
    this.analyser = analyser;
    this.sampleBuffer = new Uint8Array(analyser.fftSize);

    const update = () => {
      if (!this.analyser || !this.sampleBuffer) return;
      this.analyser.getByteTimeDomainData(this.sampleBuffer);
      let squareSum = 0;
      for (const sample of this.sampleBuffer) {
        const normalized = (sample - 128) / 128;
        squareSum += normalized * normalized;
      }
      const rms = Math.sqrt(squareSum / this.sampleBuffer.length);
      onLevel(Math.min(1, rms * 5.5));
      this.frameId = window.requestAnimationFrame(update);
    };

    update();
  }

  stop(): void {
    if (this.frameId !== null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.analyser = null;
    this.sampleBuffer = null;
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
  }
}
