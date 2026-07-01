import type { CharacterAnimationRequest, RootMotionKeyframe } from "./AnimationTypes";

export interface AnimationProfile {
  readonly stateId: string;
  readonly priority: number;
  readonly durationMs: number | null;
  readonly interruption: CharacterAnimationRequest["interruption"];
  readonly returnState?: string;
  readonly rootMotion?: readonly RootMotionKeyframe[];
}
