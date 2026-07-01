import type { CharacterRootTransform } from "../../characters/types/CharacterManifest";

export type AnimationInterruptionPolicy = "always" | "higher-or-equal" | "never";

export type RootMotionEasing =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "back-out";

export interface RootMotionKeyframe {
  readonly at: number;
  readonly transform: Partial<CharacterRootTransform>;
  readonly easing?: RootMotionEasing;
}

export interface CharacterAnimationRequest {
  readonly id: string;
  readonly source: string;
  readonly stateId: string;
  readonly priority: number;
  readonly durationMs: number | null;
  readonly interruption: AnimationInterruptionPolicy;
  readonly replaceKey?: string;
  readonly returnState?: string;
  readonly rootMotion?: readonly RootMotionKeyframe[];
}

export interface AnimationSchedulerSnapshot {
  readonly current: CharacterAnimationRequest | null;
  readonly queued: readonly CharacterAnimationRequest[];
}

export interface AnimationSchedulerEvents {
  "animation:queued": { readonly request: CharacterAnimationRequest };
  "animation:started": { readonly request: CharacterAnimationRequest };
  "animation:completed": { readonly request: CharacterAnimationRequest };
  "animation:interrupted": {
    readonly request: CharacterAnimationRequest;
    readonly reason: string;
  };
  "animation:error": {
    readonly request: CharacterAnimationRequest;
    readonly message: string;
  };
  "animation:snapshot": { readonly snapshot: AnimationSchedulerSnapshot };
}

export type IdleStage = "active" | "sleepy" | "sleep";

export interface BuddyAnimationEventMap {
  "character:state-requested": {
    readonly stateId: string;
    readonly source?: string;
    readonly priority?: number;
  };
  "character:clicked": Record<string, never>;
  "character:celebrate": { readonly source?: string };
  "character:drag-started": Record<string, never>;
  "character:drag-ended": { readonly gravityEnabled?: boolean };
  "user:idle-stage-changed": {
    readonly stage: IdleStage;
    readonly previousStage: IdleStage;
    readonly idleMs: number;
  };
  "notification:received": { readonly label?: string };
  "agent:task-started": { readonly providerLabel?: string };
  "agent:task-completed": {
    readonly providerLabel?: string;
    readonly succeeded?: boolean;
  };
  "system:low-battery": { readonly percentage?: number };
  "user:typing-started": Record<string, never>;
  "user:typing-stopped": Record<string, never>;
  "voice:listening-started": Record<string, never>;
  "voice:thinking-started": Record<string, never>;
  "voice:speaking-started": { readonly amplitude?: number; readonly emotion?: string };
  "voice:conversation-stopped": Record<string, never>;
  "voice:conversation-error": { readonly message?: string };
}
