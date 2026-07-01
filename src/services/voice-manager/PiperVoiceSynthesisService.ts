import type {
  PiperVoiceDescriptor,
  VoiceConversationOptions,
  VoiceCloneEngineStatus,
} from "./VoiceConversationTypes";

const ENGINE_BASE_URL = "http://127.0.0.1:17843";

export class PiperVoiceSynthesisService {
  private activeAudio: HTMLAudioElement | null = null;
  private activeUrl: string | null = null;

  async listVoices(): Promise<readonly PiperVoiceDescriptor[]> {
    const response = await fetch(`${ENGINE_BASE_URL}/piper/voices`, {
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) throw new Error(`Unable to list Piper voices (${response.status}).`);
    return response.json() as Promise<PiperVoiceDescriptor[]>;
  }

  async installVoice(voiceId: string): Promise<readonly PiperVoiceDescriptor[]> {
    const response = await fetch(`${ENGINE_BASE_URL}/piper/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voiceId }),
    });
    if (!response.ok) throw new Error(await readEngineError(response));
    return this.listVoices();
  }

  async speak(
    text: string,
    voiceId: string,
    options: VoiceConversationOptions,
    onLevel?: (level: number) => void,
  ): Promise<void> {
    this.cancel();
    const response = await fetch(`${ENGINE_BASE_URL}/piper/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voiceId,
        text,
        speed: options.rate,
      }),
    });
    if (!response.ok) throw new Error(await readEngineError(response));
    await this.playResponse(response, options.rate, onLevel);
  }

  cancel(): void {
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.src = "";
      this.activeAudio = null;
    }
    if (this.activeUrl) {
      URL.revokeObjectURL(this.activeUrl);
      this.activeUrl = null;
    }
  }

  private async playResponse(
    response: Response,
    playbackRate: number,
    onLevel?: (level: number) => void,
  ): Promise<void> {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = Math.max(0.75, Math.min(1.35, playbackRate));
    this.activeAudio = audio;
    this.activeUrl = url;

    let meterTimer: number | null = null;
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        if (meterTimer !== null) window.clearInterval(meterTimer);
        onLevel?.(0);
        if (this.activeUrl === url) {
          URL.revokeObjectURL(url);
          this.activeUrl = null;
        }
        if (this.activeAudio === audio) this.activeAudio = null;
      };
      audio.onplay = () => {
        meterTimer = window.setInterval(() => {
          onLevel?.(0.3 + Math.abs(Math.sin(performance.now() / 95)) * 0.65);
        }, 60);
      };
      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error("The generated Piper audio could not be played."));
      };
      void audio.play().catch(error => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}

export async function readLocalVoiceEngineHealth(): Promise<VoiceCloneEngineStatus> {
  const response = await fetch(`${ENGINE_BASE_URL}/health`, {
    method: "GET",
    signal: AbortSignal.timeout(1_500),
  });
  if (!response.ok) throw new Error(`Local voice engine health check failed (${response.status}).`);
  return response.json() as Promise<VoiceCloneEngineStatus>;
}

async function readEngineError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: string };
    return payload.detail ?? `Local voice engine failed (${response.status}).`;
  } catch {
    return (await response.text()) || `Local voice engine failed (${response.status}).`;
  }
}
