import type { VoiceConversationOptions } from "./VoiceConversationTypes";

interface VoicePackManifest {
  readonly id: string;
  readonly name: string;
  readonly language?: string;
  readonly clips: Readonly<Record<string, string>>;
}

const PACK_ROOT = "/assets/voice-packs/custom";

export class PreGeneratedVoicePackSynthesisService {
  private activeAudio: HTMLAudioElement | null = null;
  private manifest: VoicePackManifest | null = null;

  async hasClip(clipId: string): Promise<boolean> {
    const manifest = await this.loadManifest();
    return typeof manifest.clips[clipId] === "string";
  }

  async speak(
    clipId: string,
    options: VoiceConversationOptions,
    onLevel?: (level: number) => void,
  ): Promise<void> {
    this.cancel();
    const manifest = await this.loadManifest();
    const fileName = manifest.clips[clipId];
    if (!fileName) throw new Error(`The custom voice pack has no clip named “${clipId}”.`);
    if (fileName.includes("..") || fileName.startsWith("/") || fileName.startsWith("\\")) {
      throw new Error(`Unsafe voice-pack file path for “${clipId}”.`);
    }

    const audio = new Audio(`${PACK_ROOT}/${fileName.split("/").map(encodeURIComponent).join("/")}`);
    audio.playbackRate = Math.max(0.85, Math.min(1.2, options.rate));
    this.activeAudio = audio;

    let meterTimer: number | null = null;
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        if (meterTimer !== null) window.clearInterval(meterTimer);
        onLevel?.(0);
        if (this.activeAudio === audio) this.activeAudio = null;
      };
      audio.onplay = () => {
        meterTimer = window.setInterval(() => {
          onLevel?.(0.32 + Math.abs(Math.sin(performance.now() / 92)) * 0.62);
        }, 60);
      };
      audio.onended = () => { cleanup(); resolve(); };
      audio.onerror = () => { cleanup(); reject(new Error(`Unable to play voice-pack clip “${clipId}”.`)); };
      void audio.play().catch(error => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  cancel(): void {
    if (!this.activeAudio) return;
    this.activeAudio.pause();
    this.activeAudio.src = "";
    this.activeAudio = null;
  }

  private async loadManifest(): Promise<VoicePackManifest> {
    if (this.manifest) return this.manifest;
    const response = await fetch(`${PACK_ROOT}/manifest.json`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Custom voice-pack manifest was not found. See public/assets/voice-packs/custom/README.md.");
    }
    const manifest = await response.json() as VoicePackManifest;
    if (!manifest || typeof manifest.clips !== "object") {
      throw new Error("Custom voice-pack manifest is invalid.");
    }
    this.manifest = manifest;
    return manifest;
  }
}
