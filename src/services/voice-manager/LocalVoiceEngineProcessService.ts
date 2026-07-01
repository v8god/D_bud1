import { invoke } from "@tauri-apps/api/core";

export interface LocalVoiceEngineProcessStatus {
  readonly running: boolean;
  readonly ownedByApp: boolean;
  readonly pid: number | null;
  readonly logPath: string | null;
  readonly detail: string;
}

export class LocalVoiceEngineProcessService {
  async ensureRunning(): Promise<LocalVoiceEngineProcessStatus> {
    const initial = await this.status();
    if (initial.running) return initial;
    const started = await invoke<LocalVoiceEngineProcessStatus>("start_local_voice_engine");
    if (!started.running) throw new Error(started.detail);
    return started;
  }

  async status(): Promise<LocalVoiceEngineProcessStatus> {
    return invoke<LocalVoiceEngineProcessStatus>("get_local_voice_engine_process_status");
  }

  async stop(): Promise<void> {
    await invoke("stop_local_voice_engine");
  }
}
