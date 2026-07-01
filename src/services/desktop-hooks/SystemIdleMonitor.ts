import { invoke } from "@tauri-apps/api/core";
import type { IdleStage } from "../../animation/types/AnimationTypes";

export interface SystemIdleMonitorOptions {
  readonly sleepyAfterMs?: number;
  readonly sleepAfterMs?: number;
  readonly pollEveryMs?: number;
}

export interface IdleStageChange {
  readonly stage: IdleStage;
  readonly previousStage: IdleStage;
  readonly idleMs: number;
}

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

export class SystemIdleMonitor {
  private readonly sleepyAfterMs: number;
  private readonly sleepAfterMs: number;
  private readonly pollEveryMs: number;
  private timerId: number | null = null;
  private stage: IdleStage = "active";
  private browserLastActivityAt = Date.now();
  private callback: ((change: IdleStageChange) => void) | null = null;

  constructor(options: SystemIdleMonitorOptions = {}) {
    this.sleepyAfterMs = options.sleepyAfterMs ?? 2 * 60_000;
    this.sleepAfterMs = options.sleepAfterMs ?? 5 * 60_000;
    this.pollEveryMs = options.pollEveryMs ?? 5_000;
  }

  start(callback: (change: IdleStageChange) => void): void {
    if (this.timerId !== null) return;
    this.callback = callback;
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, this.recordBrowserActivity, { passive: true });
    }
    void this.poll();
    this.timerId = window.setInterval(() => void this.poll(), this.pollEveryMs);
  }

  stop(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    for (const eventName of ACTIVITY_EVENTS) {
      window.removeEventListener(eventName, this.recordBrowserActivity);
    }
    this.callback = null;
    this.stage = "active";
  }

  private readonly recordBrowserActivity = (): void => {
    this.browserLastActivityAt = Date.now();
  };

  private async poll(): Promise<void> {
    const idleMs = await this.readIdleMs();
    const nextStage = idleMs >= this.sleepAfterMs
      ? "sleep"
      : idleMs >= this.sleepyAfterMs
        ? "sleepy"
        : "active";

    if (nextStage === this.stage) return;
    const previousStage = this.stage;
    this.stage = nextStage;
    this.callback?.({ stage: nextStage, previousStage, idleMs });
  }

  private async readIdleMs(): Promise<number> {
    if (isTauriRuntime()) {
      try {
        return await invoke<number>("get_system_idle_ms");
      } catch (caught) {
        console.warn("Native system-idle check failed; using browser activity fallback.", caught);
      }
    }
    return Date.now() - this.browserLastActivityAt;
  }
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
