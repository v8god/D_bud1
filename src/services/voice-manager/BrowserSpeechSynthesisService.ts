import { chooseBestSystemVoice, inferVoiceGenderHint } from "./VoiceCatalog";
import type {
  VoiceConversationOptions,
  VoiceDescriptor,
  VoiceResponseEmotion,
} from "./VoiceConversationTypes";

export class BrowserSpeechSynthesisService {
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private levelTimer: number | null = null;

  get available(): boolean {
    return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  }

  async listVoices(): Promise<readonly VoiceDescriptor[]> {
    return (await this.loadVoices()).map(voice => ({
      voiceURI: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      localService: voice.localService,
      default: voice.default,
      genderHint: inferVoiceGenderHint(voice.name),
    })).sort((left, right) => {
      if (left.default !== right.default) return left.default ? -1 : 1;
      if (left.localService !== right.localService) return left.localService ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  }

  async speak(
    text: string,
    options: VoiceConversationOptions,
    emotion: VoiceResponseEmotion = "neutral",
    onLevel?: (level: number) => void,
  ): Promise<void> {
    if (!this.available) {
      throw new Error("Text-to-speech is unavailable in this WebView runtime.");
    }

    this.cancel();
    const rawVoices = await this.loadVoices();
    const descriptors = rawVoices.map(voice => ({
      voiceURI: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      localService: voice.localService,
      default: voice.default,
      genderHint: inferVoiceGenderHint(voice.name),
    } satisfies VoiceDescriptor));
    const selectedDescriptor = chooseBestSystemVoice(
      descriptors,
      options.language,
      options.preferredGender,
      options.voiceURI,
    );
    const selectedVoice = selectedDescriptor
      ? rawVoices.find(voice => voice.voiceURI === selectedDescriptor.voiceURI) ?? null
      : null;

    if (!selectedVoice) {
      throw new Error(
        `No ${options.preferredGender === "feminine" ? "female" : "male"} system voice is installed for this language. Install another Windows speech voice or choose Piper.`,
      );
    }

    const utterance = new SpeechSynthesisUtterance(humanizeText(text));
    utterance.lang = selectedVoice.lang || options.language;
    utterance.voice = selectedVoice;
    const style = styleForEmotion(emotion);
    utterance.rate = clamp(options.rate * style.rate, 0.5, 1.8);
    utterance.pitch = clamp(options.pitch * style.pitch, 0.5, 1.6);
    utterance.volume = style.volume;

    this.activeUtterance = utterance;
    return new Promise<void>((resolve, reject) => {
      utterance.onstart = () => {
        this.levelTimer = window.setInterval(() => {
          const pulse = 0.32 + Math.abs(Math.sin(performance.now() / 105)) * 0.62;
          onLevel?.(pulse);
        }, 60);
      };
      utterance.onend = () => {
        this.clearLevelTimer();
        onLevel?.(0);
        if (this.activeUtterance === utterance) this.activeUtterance = null;
        resolve();
      };
      utterance.onerror = event => {
        this.clearLevelTimer();
        onLevel?.(0);
        if (this.activeUtterance === utterance) this.activeUtterance = null;
        if (event.error === "canceled" || event.error === "interrupted") {
          resolve();
          return;
        }
        reject(new Error(`Text-to-speech failed (${event.error}).`));
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  cancel(): void {
    this.clearLevelTimer();
    if (!this.available) return;
    window.speechSynthesis.cancel();
    this.activeUtterance = null;
  }

  private async loadVoices(): Promise<SpeechSynthesisVoice[]> {
    if (!this.available) return [];
    const immediate = window.speechSynthesis.getVoices();
    if (immediate.length > 0) return immediate;

    return new Promise<SpeechSynthesisVoice[]>(resolve => {
      const timeoutId = window.setTimeout(() => {
        window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
        resolve(window.speechSynthesis.getVoices());
      }, 1_500);
      const onVoicesChanged = () => {
        window.clearTimeout(timeoutId);
        window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
        resolve(window.speechSynthesis.getVoices());
      };
      window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    });
  }

  private clearLevelTimer(): void {
    if (this.levelTimer !== null) {
      window.clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
  }
}

function styleForEmotion(emotion: VoiceResponseEmotion): {
  readonly rate: number;
  readonly pitch: number;
  readonly volume: number;
} {
  switch (emotion) {
    case "happy": return { rate: 1.06, pitch: 1.05, volume: 1 };
    case "loving": return { rate: 0.92, pitch: 1.04, volume: 0.92 };
    case "curious": return { rate: 0.98, pitch: 1.08, volume: 0.96 };
    case "confused": return { rate: 0.91, pitch: 1.02, volume: 0.94 };
    case "sad": return { rate: 0.82, pitch: 0.92, volume: 0.84 };
    case "sleepy": return { rate: 0.76, pitch: 0.9, volume: 0.78 };
    case "surprised": return { rate: 1.08, pitch: 1.12, volume: 1 };
    case "focused": return { rate: 0.95, pitch: 0.98, volume: 0.96 };
    case "proud": return { rate: 0.96, pitch: 1.03, volume: 1 };
    case "neutral": return { rate: 1, pitch: 1, volume: 1 };
  }
}

function humanizeText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/([.!?])\s+/g, "$1  ")
    .trim();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
