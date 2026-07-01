import type { CustomVoiceProfile, VoiceConversationOptions } from "./VoiceConversationTypes";
import { toEngineLanguage } from "./CustomVoiceProfileService";

export class LocalVoiceCloneSynthesisService {
  private activeAudio: HTMLAudioElement | null = null;
  private activeUrl: string | null = null;

  async speak(
    text: string,
    profile: CustomVoiceProfile,
    options: VoiceConversationOptions,
    onLevel?: (level: number) => void,
  ): Promise<void> {
    this.cancel();
    if (profile.processingState !== "ready") {
      throw new Error("This custom voice has not been prepared by XTTS yet.");
    }

    const response = await fetch("http://127.0.0.1:17843/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        text,
        language: toEngineLanguage(options.language),
        speed: options.rate,
      }),
    });

    if (!response.ok) {
      throw new Error(await readEngineError(response));
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = Math.max(0.75, Math.min(1.35, options.rate));
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
          onLevel?.(0.28 + Math.abs(Math.sin(performance.now() / 105)) * 0.68);
        }, 60);
      };
      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error("The generated custom-voice audio could not be played."));
      };
      void audio.play().catch(error => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
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
}

async function readEngineError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: string };
    return payload.detail ?? `Custom voice synthesis failed (${response.status}).`;
  } catch {
    return (await response.text()) || `Custom voice synthesis failed (${response.status}).`;
  }
}
