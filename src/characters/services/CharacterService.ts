import { TypedEventBus, type EventSubscription } from "../../app/events/TypedEventBus";
import { Live2DCharacterRuntime } from "../live2d/Live2DCharacterRuntime";
import type { CharacterEvents } from "../types/CharacterEvents";
import type {
  CharacterCatalog,
  CharacterManifest,
  CharacterMountOptions,
  CharacterRootTransform,
} from "../types/CharacterManifest";
import type {
  CharacterInteractionBounds,
  CharacterRuntime,
  CharacterRuntimeSnapshot,
} from "../types/CharacterRuntime";
import { CharacterRegistry } from "../registry/CharacterRegistry";
import type { VoiceActivityVisualState } from "../../services/voice-manager/VoiceConversationTypes";

export class CharacterService {
  private readonly events = new TypedEventBus<CharacterEvents>();
  private runtime: CharacterRuntime | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private mountOptions: CharacterMountOptions | null = null;
  private activeManifest: CharacterManifest | null = null;
  private operationSerial = 0;

  constructor(private readonly registry: CharacterRegistry) {}

  on<TKey extends keyof CharacterEvents>(
    eventName: TKey,
    handler: (payload: CharacterEvents[TKey]) => void,
  ): EventSubscription {
    return this.events.on(eventName, handler);
  }

  listCharacters(): readonly CharacterManifest[] {
    return this.registry.list();
  }

  getActiveManifest(): CharacterManifest | null {
    return this.activeManifest;
  }

  getCatalog(): CharacterCatalog {
    return this.runtime?.getCatalog() ?? { states: [], expressions: [], motions: [] };
  }

  getSnapshot(): CharacterRuntimeSnapshot {
    return (
      this.runtime?.getSnapshot() ?? {
        characterId: null,
        status: "idle",
        activeState: null,
        activeExpression: null,
        activeMotion: null,
        error: null,
      }
    );
  }

  async attach(
    canvas: HTMLCanvasElement,
    options: CharacterMountOptions,
    initialCharacterId: string,
  ): Promise<void> {
    this.canvas = canvas;
    this.mountOptions = options;
    await this.switchCharacter(initialCharacterId);
  }

  async switchCharacter(characterId: string): Promise<void> {
    if (!this.canvas || !this.mountOptions) {
      throw new Error("CharacterService must be attached to a canvas before switching");
    }

    const serial = ++this.operationSerial;
    const manifest = this.registry.get(characterId);
    const previousCharacterId = this.activeManifest?.id ?? null;
    this.events.emit("character:loading", { manifest });

    try {
      if (this.runtime) {
        await this.runtime.unload();
      }
      if (serial !== this.operationSerial) return;

      const runtime = this.createRuntime(manifest);
      this.runtime = runtime;
      this.activeManifest = manifest;
      await runtime.mount(this.canvas, manifest, this.mountOptions);
      if (serial !== this.operationSerial) {
        await runtime.unload();
        return;
      }

      this.events.emit("character:ready", {
        manifest,
        catalog: runtime.getCatalog(),
        snapshot: runtime.getSnapshot(),
      });
      this.events.emit("character:switched", {
        previousCharacterId,
        currentCharacterId: manifest.id,
      });
    } catch (caught) {
      this.emitError("switchCharacter", caught);
      throw caught;
    }
  }

  async playState(stateId: string): Promise<void> {
    const runtime = this.requireRuntime();
    try {
      await runtime.playState(stateId);
      this.events.emit("character:state-changed", {
        stateId,
        snapshot: runtime.getSnapshot(),
      });
    } catch (caught) {
      this.emitError("playState", caught);
      throw caught;
    }
  }

  async setExpression(expressionId: string): Promise<void> {
    const runtime = this.requireRuntime();
    try {
      await runtime.setExpression(expressionId);
      this.events.emit("character:expression-changed", {
        expressionId,
        snapshot: runtime.getSnapshot(),
      });
    } catch (caught) {
      this.emitError("setExpression", caught);
      throw caught;
    }
  }

  async playMotion(group: string, index: number): Promise<void> {
    const runtime = this.requireRuntime();
    try {
      await runtime.playMotion(group, index);
      this.events.emit("character:motion-started", {
        group,
        index,
        snapshot: runtime.getSnapshot(),
      });
    } catch (caught) {
      this.emitError("playMotion", caught);
      throw caught;
    }
  }

  setLookTarget(x: number, y: number): void {
    this.runtime?.setLookTarget(x, y);
  }

  setSpeaking(active: boolean, amplitude?: number): void {
    this.runtime?.setSpeaking(active, amplitude);
  }

  setVoiceActivity(state: VoiceActivityVisualState): void {
    this.runtime?.setVoiceActivity(state);
  }

  setRootTransform(transform: Partial<CharacterRootTransform>): void {
    this.runtime?.setRootTransform(transform);
  }

  resize(width: number, height: number): void {
    this.runtime?.resize(width, height);
  }

  getInteractionBounds(): CharacterInteractionBounds | null {
    return this.runtime?.getInteractionBounds() ?? null;
  }

  getViewportSize(): { readonly width: number; readonly height: number } | null {
    if (!this.mountOptions) return null;
    return { width: this.mountOptions.width, height: this.mountOptions.height };
  }

  async dispose(): Promise<void> {
    ++this.operationSerial;
    const characterId = this.activeManifest?.id ?? null;
    if (this.runtime) {
      await this.runtime.unload();
    }
    this.runtime = null;
    this.activeManifest = null;
    this.canvas = null;
    this.mountOptions = null;
    this.events.emit("character:unloaded", { characterId });
    this.events.clear();
  }

  private createRuntime(manifest: CharacterManifest): CharacterRuntime {
    switch (manifest.engine) {
      case "live2d-cubism":
        return new Live2DCharacterRuntime();
      default: {
        const exhaustiveCheck: never = manifest.engine;
        throw new Error(`Unsupported character engine '${exhaustiveCheck}'`);
      }
    }
  }

  private requireRuntime(): CharacterRuntime {
    if (!this.runtime || this.runtime.getSnapshot().status !== "ready") {
      throw new Error("No character is ready");
    }
    return this.runtime;
  }

  private emitError(operation: string, caught: unknown): void {
    const message = caught instanceof Error ? caught.message : String(caught);
    this.events.emit("character:error", {
      operation,
      message,
      characterId: this.activeManifest?.id ?? null,
    });
  }
}
