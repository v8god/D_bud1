import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../app/window/DesktopWindowService";

interface NativeKeyboardActivitySnapshot {
  readonly sequence: number;
  readonly backendRevision: string;
  readonly detectorMode: string;
}

export interface GlobalKeyboardActivityMonitorOptions {
  readonly triggerKeyCount?: number;
  readonly stopAfterMs?: number;
  readonly nativePollIntervalMs?: number;
}

interface TypingTriggerProfile {
  readonly keyCount: number;
  readonly windowMs: number;
  readonly label: "sensitive" | "balanced" | "deliberate";
}

export interface KeyboardDetectorStatus {
  readonly running: boolean;
  readonly typing: boolean;
  readonly profileLabel: TypingTriggerProfile["label"];
  readonly threshold: number;
  readonly windowMs: number;
  readonly burstCount: number;
  readonly nativeSequence: number | null;
  readonly backendRevision: string | null;
  readonly detectorMode: string | null;
}

const SNAPSHOT_COMMAND = "get_keyboard_activity_snapshot_v2";
const DEFAULT_STOP_AFTER_MS = 1_000;

/**
 * Global keyboard activity detector.
 *
 * Important invariants:
 * - The native poller has one lifecycle: start/stop only.
 * - Trigger profile changes never recreate the poller.
 * - A profile change discards the unfinished burst and ends an active typing
 *   reaction cleanly, so no partial six-key state can poison later modes.
 * - Native sequence remains monotonic and is never rewritten by the frontend.
 */
export class GlobalKeyboardActivityMonitor {
  private triggerProfile: TypingTriggerProfile;
  private readonly stopAfterMs: number;
  private readonly nativePollIntervalMs: number;

  private burstCount = 0;
  private burstStartedAt: number | null = null;
  private lastPulseAt: number | null = null;
  private lastNativeSequence: number | null = null;

  private nativePollTimerId: number | null = null;
  private stopTimerId: number | null = null;
  private nativePollBusy = false;
  private generation = 0;
  private running = false;
  private typing = false;

  private onStart: (() => void) | null = null;
  private onStop: (() => void) | null = null;
  private readonly statusListeners = new Set<(status: KeyboardDetectorStatus) => void>();

  private backendRevision: string | null = null;
  private detectorMode: string | null = null;
  private reportedBackendRevision: string | null = null;
  private reportedNativeFailure = false;

  constructor(options: GlobalKeyboardActivityMonitorOptions = {}) {
    this.triggerProfile = profileForKeyCount(options.triggerKeyCount ?? 4);
    this.stopAfterMs = options.stopAfterMs ?? DEFAULT_STOP_AFTER_MS;
    this.nativePollIntervalMs = options.nativePollIntervalMs ?? 60;
  }

  subscribe(listener: (status: KeyboardDetectorStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): KeyboardDetectorStatus {
    return {
      running: this.running,
      typing: this.typing,
      profileLabel: this.triggerProfile.label,
      threshold: this.triggerProfile.keyCount,
      windowMs: this.triggerProfile.windowMs,
      burstCount: this.burstCount,
      nativeSequence: this.lastNativeSequence,
      backendRevision: this.backendRevision,
      detectorMode: this.detectorMode,
    };
  }

  /**
   * Apply a mode change without restarting native polling.
   *
   * We intentionally clear the unfinished burst. If typing is already active,
   * it is stopped once, immediately and cleanly. The next keystrokes are then
   * evaluated only under the newly selected profile.
   */
  setTriggerKeyCount(count: number): void {
    const nextProfile = profileForKeyCount(count);
    if (
      nextProfile.keyCount === this.triggerProfile.keyCount &&
      nextProfile.windowMs === this.triggerProfile.windowMs
    ) {
      return;
    }

    this.triggerProfile = nextProfile;
    this.finishTypingIfNeeded();
    this.resetBurst();

    console.info(
      `Desktop Buddy typing trigger: ${nextProfile.label} ` +
        `(${nextProfile.keyCount} keys / ${nextProfile.windowMs}ms).`,
    );
    this.emitStatus();
  }

  start(onStart: () => void, onStop: () => void): void {
    this.onStart = onStart;
    this.onStop = onStop;

    if (this.running) {
      this.emitStatus();
      return;
    }

    this.running = true;
    this.reportedNativeFailure = false;
    this.resetBurst();
    this.clearStopTimer();
    this.typing = false;
    this.emitStatus();

    if (!isTauriRuntime()) {
      window.addEventListener("keydown", this.handleBrowserKeyDown);
      return;
    }

    const generation = ++this.generation;
    const poll = () => {
      if (!this.running || generation !== this.generation || this.nativePollBusy) return;
      this.nativePollBusy = true;

      void invoke<NativeKeyboardActivitySnapshot>(SNAPSHOT_COMMAND)
        .then(snapshot => {
          if (!this.running || generation !== this.generation) return;
          this.reportBackend(snapshot);
          this.consumeNativeSequence(snapshot.sequence);
        })
        .catch(caught => {
          if (!this.running || generation !== this.generation || this.reportedNativeFailure) return;
          this.reportedNativeFailure = true;
          console.error(
            "Desktop Buddy keyboard detector is unavailable. " +
              "Confirm the Phase 5.4 Rust file is installed and rebuild src-tauri.",
            caught,
          );
        })
        .finally(() => {
          if (generation === this.generation) this.nativePollBusy = false;
        });
    };

    poll();
    this.nativePollTimerId = window.setInterval(poll, this.nativePollIntervalMs);
  }

  stop(): void {
    if (!this.running && !this.onStart && !this.onStop) return;

    this.running = false;
    ++this.generation;

    if (this.nativePollTimerId !== null) {
      window.clearInterval(this.nativePollTimerId);
      this.nativePollTimerId = null;
    }

    this.clearStopTimer();
    window.removeEventListener("keydown", this.handleBrowserKeyDown);

    this.nativePollBusy = false;
    this.lastNativeSequence = null;
    this.finishTypingIfNeeded();
    this.resetBurst();
    this.onStart = null;
    this.onStop = null;
    this.emitStatus();
  }

  private readonly handleBrowserKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.key.length === 1 || ["Backspace", "Delete", "Enter", "Tab"].includes(event.key)) {
      this.consumePulseBatch(1, performance.now());
    }
  };

  private consumeNativeSequence(sequence: number): void {
    if (!Number.isFinite(sequence) || sequence < 0) return;

    if (this.lastNativeSequence === null) {
      this.lastNativeSequence = sequence;
      this.emitStatus();
      return;
    }

    // A backend restart or counter reset must not create a giant false delta.
    if (sequence < this.lastNativeSequence) {
      this.lastNativeSequence = sequence;
      this.finishTypingIfNeeded();
      this.resetBurst();
      this.emitStatus();
      return;
    }

    const delta = Math.min(64, sequence - this.lastNativeSequence);
    this.lastNativeSequence = sequence;
    if (delta <= 0) return;

    this.consumePulseBatch(delta, performance.now());
  }

  private consumePulseBatch(count: number, now: number): void {
    const profile = this.triggerProfile;

    if (
      this.burstStartedAt === null ||
      this.lastPulseAt === null ||
      now - this.burstStartedAt > profile.windowMs ||
      now - this.lastPulseAt > profile.windowMs
    ) {
      this.burstStartedAt = now;
      this.burstCount = 0;
    }

    this.lastPulseAt = now;
    this.burstCount = Math.min(128, this.burstCount + count);

    if (!this.typing && this.burstCount >= profile.keyCount) {
      this.typing = true;
      this.onStart?.();
    }

    if (this.typing) this.scheduleTypingStop();
    this.emitStatus();
  }

  private scheduleTypingStop(): void {
    this.clearStopTimer();
    this.stopTimerId = window.setTimeout(() => {
      this.stopTimerId = null;
      this.finishTypingIfNeeded();
      this.resetBurst();
      this.emitStatus();
    }, this.stopAfterMs);
  }

  private finishTypingIfNeeded(): void {
    this.clearStopTimer();
    if (!this.typing) return;
    this.typing = false;
    this.onStop?.();
  }

  private resetBurst(): void {
    this.burstCount = 0;
    this.burstStartedAt = null;
    this.lastPulseAt = null;
  }

  private clearStopTimer(): void {
    if (this.stopTimerId === null) return;
    window.clearTimeout(this.stopTimerId);
    this.stopTimerId = null;
  }

  private reportBackend(snapshot: NativeKeyboardActivitySnapshot): void {
    this.backendRevision = snapshot.backendRevision;
    this.detectorMode = snapshot.detectorMode;

    if (snapshot.backendRevision === this.reportedBackendRevision) return;
    this.reportedBackendRevision = snapshot.backendRevision;

    if (snapshot.backendRevision === "phase-5.4-keyboard-v3") {
      console.info(
        `Desktop Buddy keyboard detector ready: ${snapshot.backendRevision} ` +
          `(${snapshot.detectorMode}).`,
      );
    } else {
      console.warn(
        `Desktop Buddy keyboard backend is ${snapshot.backendRevision}; ` +
          "Phase 5.4 expects phase-5.4-keyboard-v3.",
      );
    }
  }

  private emitStatus(): void {
    const snapshot = this.getStatus();
    for (const listener of this.statusListeners) listener(snapshot);
  }
}

function profileForKeyCount(value: number): TypingTriggerProfile {
  const count = clampTriggerCount(value);

  if (count <= 2) {
    return { keyCount: 2, windowMs: 1_800, label: "sensitive" };
  }

  if (count >= 6) {
    return { keyCount: 6, windowMs: 3_500, label: "deliberate" };
  }

  return { keyCount: 4, windowMs: 2_200, label: "balanced" };
}

function clampTriggerCount(value: number): number {
  if (!Number.isFinite(value)) return 4;
  return Math.min(8, Math.max(2, Math.round(value)));
}
