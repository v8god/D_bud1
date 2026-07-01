import type { VoiceConversationOptions } from "./VoiceConversationTypes";

const ENGINE_BASE_URL = "http://127.0.0.1:17843";

export class GTtsSynthesisService {
  private activeAudio: HTMLAudioElement | null = null;
  private activeUrl: string | null = null;

  async speak(
    text: string,
    options: VoiceConversationOptions,
    onLevel?: (level: number) => void,
  ): Promise<void> {
    this.cancel();
    const response = await fetch(`${ENGINE_BASE_URL}/gtts/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language: toGTtsLanguage(options.language),
        tld: options.gttsTld,
        slow: options.rate < 0.9,
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
    audio.playbackRate = Math.max(0.8, Math.min(1.25, playbackRate));
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
          onLevel?.(0.3 + Math.abs(Math.sin(performance.now() / 100)) * 0.62);
        }, 60);
      };
      audio.onended = () => { cleanup(); resolve(); };
      audio.onerror = () => { cleanup(); reject(new Error("The gTTS audio could not be played.")); };
      void audio.play().catch(error => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}

function toGTtsLanguage(language: string): string {
  const normalized = language.toLowerCase();
  if (normalized.startsWith("hi")) return "hi";
  if (normalized.startsWith("en")) return "en";
  return normalized.split("-")[0] || "en";
}

async function readEngineError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: string };
    return payload.detail ?? `gTTS synthesis failed (${response.status}).`;
  } catch {
    return (await response.text()) || `gTTS synthesis failed (${response.status}).`;
  }
}
