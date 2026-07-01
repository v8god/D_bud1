import { TypedEventBus, type EventSubscription } from "../../app/events/TypedEventBus";
import type { CharacterService } from "../../characters/services/CharacterService";
import { RootMotionPlayer } from "./RootMotionPlayer";
import type {
  AnimationSchedulerEvents,
  AnimationSchedulerSnapshot,
  CharacterAnimationRequest,
} from "../types/AnimationTypes";

export class CharacterAnimationScheduler {
  private readonly events = new TypedEventBus<AnimationSchedulerEvents>();
  private readonly rootMotion: RootMotionPlayer;
  private readonly queue: CharacterAnimationRequest[] = [];
  private current: CharacterAnimationRequest | null = null;
  private currentController: AbortController | null = null;
  private running = false;
  private disposed = false;

  constructor(private readonly characterService: CharacterService) {
    this.rootMotion = new RootMotionPlayer(characterService);
  }

  on<TKey extends keyof AnimationSchedulerEvents>(
    eventName: TKey,
    handler: (payload: AnimationSchedulerEvents[TKey]) => void,
  ): EventSubscription {
    return this.events.on(eventName, handler);
  }

  getSnapshot(): AnimationSchedulerSnapshot {
    return { current: this.current, queued: [...this.queue] };
  }

  request(request: CharacterAnimationRequest, forceQueue = false): void {
    if (this.disposed) return;

    if (request.replaceKey) {
      for (let index = this.queue.length - 1; index >= 0; index -= 1) {
        if (this.queue[index]?.replaceKey === request.replaceKey) {
          this.queue.splice(index, 1);
        }
      }
    }

    if (!forceQueue && this.current && shouldInterrupt(this.current, request)) {
      this.queue.unshift(request);
      this.currentController?.abort(`interrupted by ${request.id}`);
    } else {
      this.queue.push(request);
      this.queue.sort((left, right) => right.priority - left.priority);
    }

    this.events.emit("animation:queued", { request });
    this.emitSnapshot();
    void this.pump();
  }

  cancelCurrent(reason = "cancelled"): void {
    this.currentController?.abort(reason);
  }

  cancelSource(source: string, reason = "source cancelled"): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]?.source === source) {
        this.queue.splice(index, 1);
      }
    }

    if (this.current?.source === source) {
      this.currentController?.abort(reason);
    }
    this.emitSnapshot();
  }

  clear(reason = "cleared"): void {
    this.queue.splice(0, this.queue.length);
    this.currentController?.abort(reason);
    this.rootMotion.reset();
    this.emitSnapshot();
  }

  dispose(): void {
    this.disposed = true;
    this.clear("disposed");
    this.events.clear();
  }

  private async pump(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;

    try {
      while (!this.disposed && this.queue.length > 0) {
        const request = this.queue.shift();
        if (!request) continue;
        await this.runRequest(request);
      }
    } finally {
      this.running = false;
      this.emitSnapshot();
    }
  }

  private async runRequest(request: CharacterAnimationRequest): Promise<void> {
    const controller = new AbortController();
    this.current = request;
    this.currentController = controller;
    this.events.emit("animation:started", { request });
    this.emitSnapshot();

    try {
      await this.characterService.playState(request.stateId);

      const rootMotionPromise = request.rootMotion && request.durationMs !== null
        ? this.rootMotion.play(request.rootMotion, request.durationMs, controller.signal)
        : Promise.resolve();

      if (request.durationMs === null) {
        await waitForAbort(controller.signal);
      } else {
        await Promise.all([
          delay(request.durationMs, controller.signal),
          rootMotionPromise,
        ]);
      }

      if (controller.signal.aborted) {
        this.events.emit("animation:interrupted", {
          request,
          reason: String(controller.signal.reason ?? "interrupted"),
        });
        return;
      }

      this.events.emit("animation:completed", { request });

      if (request.returnState && this.queue.length === 0) {
        await this.characterService.playState(request.returnState);
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        this.events.emit("animation:interrupted", {
          request,
          reason: String(controller.signal.reason ?? "interrupted"),
        });
      } else {
        this.events.emit("animation:error", {
          request,
          message: caught instanceof Error ? caught.message : String(caught),
        });
      }
    } finally {
      this.rootMotion.reset();
      if (this.current?.id === request.id) {
        this.current = null;
        this.currentController = null;
      }
      this.emitSnapshot();
    }
  }

  private emitSnapshot(): void {
    this.events.emit("animation:snapshot", { snapshot: this.getSnapshot() });
  }
}

function shouldInterrupt(
  current: CharacterAnimationRequest,
  incoming: CharacterAnimationRequest,
): boolean {
  if (current.interruption === "never") return false;
  if (incoming.interruption === "always") return true;
  return incoming.priority >= current.priority;
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>(resolve => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function delay(durationMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>(resolve => {
    const timeoutId = window.setTimeout(resolve, durationMs);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeoutId);
        resolve();
      },
      { once: true },
    );
  });
}
