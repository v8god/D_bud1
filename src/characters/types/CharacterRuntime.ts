import type { VoiceActivityVisualState } from "../../services/voice-manager/VoiceConversationTypes";
import type {
  CharacterCatalog,
  CharacterManifest,
  CharacterMountOptions,
  CharacterRootTransform,
  CharacterRuntimeCapabilities,
  MotionDescriptor,
} from "./CharacterManifest";

export type CharacterRuntimeStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unloading"
  | "error";

export interface CharacterInteractionBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CharacterRuntimeSnapshot {
  readonly characterId: string | null;
  readonly status: CharacterRuntimeStatus;
  readonly activeState: string | null;
  readonly activeExpression: string | null;
  readonly activeMotion: MotionDescriptor | null;
  readonly error: string | null;
}

/**
 * Engine-neutral character contract. UI, AI, memory, and desktop hooks must
 * depend on this interface rather than importing Live2D directly.
 */
export interface CharacterRuntime {
  readonly engine: CharacterManifest["engine"];

  mount(
    canvas: HTMLCanvasElement,
    manifest: CharacterManifest,
    options: CharacterMountOptions,
  ): Promise<void>;

  unload(): Promise<void>;
  playState(stateId: string): Promise<void>;
  setExpression(expressionId: string): Promise<void>;
  playMotion(group: string, index: number): Promise<void>;
  setLookTarget(x: number, y: number): void;
  setSpeaking(active: boolean, amplitude?: number): void;
  setVoiceActivity(state: VoiceActivityVisualState): void;
  setRootTransform(transform: Partial<CharacterRootTransform>): void;
  resize(width: number, height: number): void;
  getInteractionBounds(): CharacterInteractionBounds | null;

  getCatalog(): CharacterCatalog;
  getCapabilities(): CharacterRuntimeCapabilities;
  getSnapshot(): CharacterRuntimeSnapshot;
}
