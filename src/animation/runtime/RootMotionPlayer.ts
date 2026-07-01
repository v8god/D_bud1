import type { CharacterService } from "../../characters/services/CharacterService";
import type { CharacterRootTransform } from "../../characters/types/CharacterManifest";
import type { RootMotionEasing, RootMotionKeyframe } from "../types/AnimationTypes";

const IDENTITY: CharacterRootTransform = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
};

interface TranslationConstraints {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

interface MaterializedKeyframe {
  readonly at: number;
  readonly transform: CharacterRootTransform;
  readonly easing: RootMotionEasing;
}

export class RootMotionPlayer {
  private frameId: number | null = null;

  constructor(private readonly characterService: CharacterService) {}

  async play(
    keyframes: readonly RootMotionKeyframe[],
    durationMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    this.cancelFrame();
    const frames = materializeKeyframes(keyframes);
    const constraints = this.readTranslationConstraints();
    if (frames.length < 2 || durationMs <= 0) {
      this.characterService.setRootTransform(IDENTITY);
      return;
    }

    await new Promise<void>(resolve => {
      const startedAt = performance.now();

      const finish = () => {
        this.cancelFrame();
        this.characterService.setRootTransform(IDENTITY);
        resolve();
      };

      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        finish();
      };

      signal.addEventListener("abort", onAbort, { once: true });

      const tick = (now: number) => {
        if (signal.aborted) return;
        const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
        this.characterService.setRootTransform(
          clampTranslation(interpolateFrames(frames, progress), constraints),
        );

        if (progress >= 1) {
          signal.removeEventListener("abort", onAbort);
          finish();
          return;
        }

        this.frameId = requestAnimationFrame(tick);
      };

      this.frameId = requestAnimationFrame(tick);
    });
  }

  reset(): void {
    this.cancelFrame();
    this.characterService.setRootTransform(IDENTITY);
  }


  private readTranslationConstraints(): TranslationConstraints | null {
    const bounds = this.characterService.getInteractionBounds();
    const viewport = this.characterService.getViewportSize();
    if (!bounds || !viewport) return null;

    const padding = 8;
    return {
      minX: -(bounds.x - padding),
      maxX: viewport.width - (bounds.x + bounds.width) - padding,
      minY: -(bounds.y - padding),
      maxY: viewport.height - (bounds.y + bounds.height) - padding,
    };
  }

  private cancelFrame(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }
}

function materializeKeyframes(
  keyframes: readonly RootMotionKeyframe[],
): readonly MaterializedKeyframe[] {
  const sorted = [...keyframes].sort((left, right) => left.at - right.at);
  let previous = IDENTITY;

  return sorted.map(frame => {
    previous = { ...previous, ...frame.transform };
    return {
      at: Math.max(0, Math.min(1, frame.at)),
      transform: previous,
      easing: frame.easing ?? "linear",
    };
  });
}

function interpolateFrames(
  frames: readonly MaterializedKeyframe[],
  progress: number,
): CharacterRootTransform {
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (!first || !last) return IDENTITY;
  if (progress <= first.at) return first.transform;
  if (progress >= last.at) return last.transform;

  for (let index = 1; index < frames.length; index += 1) {
    const right = frames[index];
    const left = frames[index - 1];
    if (!left || !right || progress > right.at) continue;

    const span = Math.max(0.0001, right.at - left.at);
    const localProgress = applyEasing((progress - left.at) / span, right.easing);
    return {
      offsetX: lerp(left.transform.offsetX, right.transform.offsetX, localProgress),
      offsetY: lerp(left.transform.offsetY, right.transform.offsetY, localProgress),
      scale: lerp(left.transform.scale, right.transform.scale, localProgress),
      rotation: lerp(left.transform.rotation, right.transform.rotation, localProgress),
    };
  }

  return last.transform;
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function applyEasing(value: number, easing: RootMotionEasing): number {
  const clamped = Math.max(0, Math.min(1, value));
  switch (easing) {
    case "ease-in":
      return clamped * clamped;
    case "ease-out":
      return 1 - (1 - clamped) * (1 - clamped);
    case "ease-in-out":
      return clamped < 0.5
        ? 2 * clamped * clamped
        : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
    case "back-out": {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(clamped - 1, 3) + c1 * Math.pow(clamped - 1, 2);
    }
    case "linear":
    default:
      return clamped;
  }
}

function clampTranslation(
  transform: CharacterRootTransform,
  constraints: TranslationConstraints | null,
): CharacterRootTransform {
  if (!constraints) return transform;
  return {
    ...transform,
    offsetX: Math.max(constraints.minX, Math.min(constraints.maxX, transform.offsetX)),
    offsetY: Math.max(constraints.minY, Math.min(constraints.maxY, transform.offsetY)),
  };
}
