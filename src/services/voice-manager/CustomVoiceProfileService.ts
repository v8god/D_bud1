import { invoke } from "@tauri-apps/api/core";
import { LocalVoiceEngineProcessService } from "./LocalVoiceEngineProcessService";
import { readLocalVoiceEngineHealth } from "./PiperVoiceSynthesisService";
import type {
  CustomVoiceProfile,
  VoiceCloneEngineStatus,
  VoiceGenderHint,
} from "./VoiceConversationTypes";

export interface SaveCustomVoiceProfileInput {
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly genderHint: VoiceGenderHint;
  readonly durationSeconds: number;
  readonly wavBase64: string;
}

const UNAVAILABLE_ENGINE: VoiceCloneEngineStatus = {
  available: false,
  engineId: "desktop-buddy-local-voice",
  label: "Desktop Buddy local voice engine",
  modelLoaded: false,
  detail: "The local voice engine is not running.",
  piperAvailable: false,
  gttsAvailable: false,
  xttsEnabled: false,
  engineMode: "lightweight",
  piperLoadedVoices: 0,
};

export class CustomVoiceProfileService {
  private readonly process = new LocalVoiceEngineProcessService();

  async list(): Promise<readonly CustomVoiceProfile[]> {
    try {
      return await invoke<CustomVoiceProfile[]>("list_custom_voice_profiles");
    } catch {
      return [];
    }
  }

  async save(input: SaveCustomVoiceProfileInput): Promise<CustomVoiceProfile> {
    return invoke<CustomVoiceProfile>("save_custom_voice_profile", { input });
  }

  async updateProcessing(
    id: string,
    processingState: CustomVoiceProfile["processingState"],
    engineId: string | null,
    processingError: string | null,
  ): Promise<CustomVoiceProfile> {
    return invoke<CustomVoiceProfile>("update_custom_voice_profile_processing", {
      input: { id, processingState, engineId, processingError },
    });
  }

  async remove(id: string): Promise<void> {
    await invoke("delete_custom_voice_profile", { id });
  }

  async ensureEngineRunning(): Promise<VoiceCloneEngineStatus> {
    const current = await this.getEngineStatus();
    if (current.available) return current;
    await this.process.ensureRunning();

    const deadline = Date.now() + 15_000;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      await delay(300);
      try {
        const health = await readLocalVoiceEngineHealth();
        if (health.available) return health;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `The local voice engine did not become ready. ${lastError instanceof Error ? lastError.message : "Check the engine log from Settings."}`,
    );
  }


  async startLightweightEngine(): Promise<VoiceCloneEngineStatus> {
    return this.ensureEngineRunning();
  }

  async enableXtts(): Promise<VoiceCloneEngineStatus> {
    await this.ensureEngineRunning();
    const response = await fetch("http://127.0.0.1:17843/xtts/enable", { method: "POST" });
    if (!response.ok) throw new Error(await readEngineError(response));
    return this.getEngineStatus();
  }

  async disableXtts(): Promise<VoiceCloneEngineStatus> {
    const current = await this.getEngineStatus();
    if (!current.available) return current;
    const response = await fetch("http://127.0.0.1:17843/xtts/disable", { method: "POST" });
    if (!response.ok) throw new Error(await readEngineError(response));
    return this.getEngineStatus();
  }

  async stopEngine(): Promise<VoiceCloneEngineStatus> {
    await this.process.stop();
    return UNAVAILABLE_ENGINE;
  }

  async getEngineStatus(options: { readonly probeWhenStopped?: boolean } = {}): Promise<VoiceCloneEngineStatus> {
    if (options.probeWhenStopped === false) {
      try {
        const processStatus = await this.process.status();
        if (!processStatus.running) return UNAVAILABLE_ENGINE;
      } catch {
        return UNAVAILABLE_ENGINE;
      }
    }

    try {
      return await readLocalVoiceEngineHealth();
    } catch {
      return UNAVAILABLE_ENGINE;
    }
  }

  async processWithLocalEngine(profile: CustomVoiceProfile): Promise<CustomVoiceProfile> {
    const engine = await this.getEngineStatus();
    if (!engine.available || !engine.xttsEnabled) {
      throw new Error("XTTS is off. Press Start XTTS (heavy) before Prepare once.");
    }
    await this.updateProcessing(profile.id, "processing", engine.engineId, null);
    try {
      const response = await fetch("http://127.0.0.1:17843/profiles/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          referencePath: profile.referencePath,
          language: toEngineLanguage(profile.language),
        }),
      });
      if (!response.ok) throw new Error(await readEngineError(response));
      return this.updateProcessing(profile.id, "ready", engine.engineId, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.updateProcessing(profile.id, "error", engine.engineId, message);
      throw new Error(message);
    }
  }
}

export function toEngineLanguage(language: string): string {
  const normalized = language.toLocaleLowerCase();
  if (normalized.startsWith("en")) return "en";
  if (normalized.startsWith("hi")) return "hi";
  if (normalized.startsWith("es")) return "es";
  if (normalized.startsWith("fr")) return "fr";
  if (normalized.startsWith("de")) return "de";
  if (normalized.startsWith("it")) return "it";
  if (normalized.startsWith("pt")) return "pt";
  if (normalized.startsWith("pl")) return "pl";
  if (normalized.startsWith("tr")) return "tr";
  if (normalized.startsWith("ru")) return "ru";
  if (normalized.startsWith("nl")) return "nl";
  if (normalized.startsWith("cs")) return "cs";
  if (normalized.startsWith("ar")) return "ar";
  if (normalized.startsWith("zh")) return "zh-cn";
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("ko")) return "ko";
  return "en";
}

async function readEngineError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: string };
    return payload.detail ?? `Voice engine rejected the profile (${response.status}).`;
  } catch {
    return (await response.text()) || `Voice engine rejected the profile (${response.status}).`;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}
