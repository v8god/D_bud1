import { TypedEventBus, type EventSubscription } from "../../app/events/TypedEventBus";
import type { CharacterService } from "../../characters/services/CharacterService";
import { getAnimationProfile } from "../config/animationProfiles";
import type {
  AnimationSchedulerEvents,
  BuddyAnimationEventMap,
  CharacterAnimationRequest,
  IdleStage,
} from "../types/AnimationTypes";
import { CharacterAnimationScheduler } from "./CharacterAnimationScheduler";

interface EngineOutputEvents {
  "engine:event": {
    readonly type: keyof BuddyAnimationEventMap;
    readonly timestamp: number;
  };
}

export class DesktopBuddyAnimationEngine {
  private readonly inputs = new TypedEventBus<BuddyAnimationEventMap>();
  private readonly outputs = new TypedEventBus<EngineOutputEvents>();
  private readonly scheduler: CharacterAnimationScheduler;
  private sequence = 0;
  private started = false;

  constructor(private readonly characterService: CharacterService) {
    this.scheduler = new CharacterAnimationScheduler(characterService);
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.inputs.on("character:state-requested", payload => {
      this.enqueueState(
        payload.stateId,
        payload.source ?? "manual",
        payload.priority,
      );
    });
    this.inputs.on("character:clicked", () => {
      this.enqueueState("curious", "character-click", 92);
    });
    this.inputs.on("character:celebrate", payload => {
      this.enqueueState("celebrate", payload.source ?? "celebration", 80);
    });
    this.inputs.on("character:drag-started", () => {
      this.enqueueState("dragged", "drag", 88);
    });
    this.inputs.on("character:drag-ended", payload => {
      this.scheduler.cancelCurrent("drag ended");
      if (payload.gravityEnabled) {
        this.enqueueState("thrown", "drag-end-flight", 100);
        this.enqueueState("dropped", "drag-end-impact", 99, true);
      } else {
        this.enqueueState("idle_neutral", "drag-end", 90);
      }
    });
    this.inputs.on("user:idle-stage-changed", payload => {
      this.handleIdleStage(payload.stage, payload.previousStage);
    });
    this.inputs.on("notification:received", () => {
      this.enqueueState("notification", "notification", 78);
    });
    this.inputs.on("agent:task-started", () => {
      this.enqueueState("ai_waiting", "agent-task", 45);
    });
    this.inputs.on("agent:task-completed", payload => {
      this.scheduler.cancelCurrent("agent task completed");
      this.enqueueState(payload.succeeded === false ? "sad" : "ai_completed", "agent-task", 85);
    });
    this.inputs.on("system:low-battery", () => {
      this.enqueueState("low_battery", "system-battery", 95);
    });
    this.inputs.on("user:typing-started", () => {
      const snapshot = this.scheduler.getSnapshot();
      const typingAlreadyCurrent = snapshot.current?.source === "system-keyboard";
      const typingAlreadyQueued = snapshot.queued.some(
        request => request.source === "system-keyboard",
      );
      if (!typingAlreadyCurrent && !typingAlreadyQueued) {
        this.enqueueState("typing", "system-keyboard", 40);
      }
    });
    this.inputs.on("user:typing-stopped", () => {
      const wasTyping = this.scheduler.getSnapshot().current?.source === "system-keyboard";
      this.scheduler.cancelSource("system-keyboard", "keyboard became inactive");
      if (wasTyping) {
        this.enqueueState("idle_neutral", "system-keyboard-end", 41);
      }
    });
    this.inputs.on("voice:listening-started", () => {
      this.characterService.setSpeaking(false);
      this.scheduler.cancelSource("voice-conversation", "voice listening started");
      this.enqueueState("focused", "voice-conversation", 62);
    });
    this.inputs.on("voice:thinking-started", () => {
      this.characterService.setSpeaking(false);
      this.scheduler.cancelSource("voice-conversation", "voice thinking started");
      this.enqueueState("ai_waiting", "voice-conversation", 66);
    });
    this.inputs.on("voice:speaking-started", payload => {
      this.scheduler.cancelSource("voice-conversation", "voice speaking started");
      this.enqueueState(voiceEmotionState(payload.emotion), "voice-conversation", 70);
      this.characterService.setSpeaking(true, payload.amplitude ?? 0.72);
    });
    this.inputs.on("voice:conversation-stopped", () => {
      this.characterService.setSpeaking(false);
      const wasVoiceAnimation = this.scheduler.getSnapshot().current?.source === "voice-conversation";
      this.scheduler.cancelSource("voice-conversation", "voice conversation stopped");
      if (wasVoiceAnimation) {
        this.enqueueState("idle_neutral", "voice-conversation-end", 71);
      }
    });
    this.inputs.on("voice:conversation-error", () => {
      this.characterService.setSpeaking(false);
      this.scheduler.cancelSource("voice-conversation", "voice conversation error");
      this.enqueueState("surprised", "voice-conversation-error", 76);
    });
  }

  emit<TKey extends keyof BuddyAnimationEventMap>(
    eventName: TKey,
    payload: BuddyAnimationEventMap[TKey],
  ): void {
    if (!this.started) this.start();
    this.outputs.emit("engine:event", { type: eventName, timestamp: Date.now() });
    this.inputs.emit(eventName, payload);
  }

  onScheduler<TKey extends keyof AnimationSchedulerEvents>(
    eventName: TKey,
    handler: (payload: AnimationSchedulerEvents[TKey]) => void,
  ): EventSubscription {
    return this.scheduler.on(eventName, handler);
  }

  onEvent(handler: (payload: EngineOutputEvents["engine:event"]) => void): EventSubscription {
    return this.outputs.on("engine:event", handler);
  }

  getSchedulerSnapshot() {
    return this.scheduler.getSnapshot();
  }

  dispose(): void {
    this.characterService.setSpeaking(false);
    this.scheduler.dispose();
    this.inputs.clear();
    this.outputs.clear();
    this.started = false;
  }

  private enqueueState(
    stateId: string,
    source: string,
    priorityOverride?: number,
    forceQueue = false,
  ): void {
    const profile = getAnimationProfile(stateId);
    const request: CharacterAnimationRequest = {
      id: `${source}:${stateId}:${++this.sequence}`,
      source,
      stateId,
      priority: priorityOverride ?? profile.priority,
      durationMs: profile.durationMs,
      interruption: profile.interruption,
      replaceKey: source,
      returnState: profile.returnState,
      rootMotion: profile.rootMotion,
    };
    this.scheduler.request(request, forceQueue);
  }

  private handleIdleStage(stage: IdleStage, previousStage: IdleStage): void {
    if (stage === "sleep") {
      this.enqueueState("sleep", "system-idle", 30);
      return;
    }

    if (stage === "sleepy") {
      this.enqueueState("sleepy", "system-idle", 25);
      return;
    }

    if (stage === "active" && previousStage !== "active") {
      this.scheduler.cancelCurrent("user became active");
      this.enqueueState("wake_up", "system-idle", 90);
    }
  }
}

function voiceEmotionState(emotion?: string): string {
  switch (emotion) {
    case "happy": return "happy";
    case "loving": return "soft_smile";
    case "curious": return "curious";
    case "confused": return "thinking";
    case "sad": return "sad";
    case "sleepy": return "sleepy";
    case "surprised": return "surprised";
    case "focused": return "focused";
    case "proud": return "proud";
    default: return "soft_smile";
  }
}
