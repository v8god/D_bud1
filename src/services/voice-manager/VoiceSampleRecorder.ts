export class VoiceSampleRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  async start(): Promise<void> {
    this.stopTracks();
    if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
      throw new Error("Voice-sample recording is unavailable in this WebView runtime.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        channelCount: 1,
      },
      video: false,
    });

    const preferredMimeType = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ].find(type => MediaRecorder.isTypeSupported(type));

    this.stream = stream;
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, preferredMimeType ? { mimeType: preferredMimeType } : undefined);
    this.recorder.ondataavailable = event => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(250);
  }

  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state !== "recording") {
      return Promise.reject(new Error("No voice sample is currently recording."));
    }

    return new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error("The voice sample recorder failed."));
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" });
        this.recorder = null;
        this.chunks = [];
        this.stopTracks();
        resolve(blob);
      };
      recorder.stop();
    });
  }

  cancel(): void {
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.recorder = null;
    this.chunks = [];
    this.stopTracks();
  }

  private stopTracks(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }
}
