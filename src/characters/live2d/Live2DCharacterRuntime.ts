import * as PIXI from "pixi.js";
import { Application } from "pixi.js";
import * as live2DNamespace from "pixi-live2d-display-advanced/cubism4";
import type {
  CharacterCatalog,
  CharacterManifest,
  CharacterMountOptions,
  CharacterRootTransform,
  CharacterRuntimeCapabilities,
  MotionDescriptor,
} from "../types/CharacterManifest";
import type {
  CharacterInteractionBounds,
  CharacterRuntime,
  CharacterRuntimeSnapshot,
  CharacterRuntimeStatus,
} from "../types/CharacterRuntime";
import { installCubism6RenderOrderBridge } from "./cubism6RenderOrderBridge";
import { Live2DPropLayer } from "./Live2DPropLayer";
import type { VoiceActivityVisualState } from "../../services/voice-manager/VoiceConversationTypes";
import type {
  CharacterDirector,
  CharacterDirectorState,
  Live2DModelSettings,
} from "./live2dAssetSchemas";

const live2D = live2DNamespace as unknown as typeof import("pixi-live2d-display-advanced");
const Live2DModel = live2D.Live2DModel;
live2D.config.sound = false;

type Live2DInstance = InstanceType<typeof Live2DModel> & {
  position: { set(x: number, y: number): void; x: number; y: number };
  scale: { set(value: number): void; x: number; y: number };
  anchor: { set(x: number, y: number): void };
  rotation: number;
  getBounds(skipUpdate?: boolean): PIXI.Rectangle;
  textures: PIXI.Texture[];
  internalModel: InstanceType<typeof Live2DModel>["internalModel"] & {
    focusController?: {
      focus(x: number, y: number, instant?: boolean): void;
    };
  };
};

const DEFAULT_TRANSFORM: CharacterRootTransform = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
};

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load '${path}' (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function basenameWithoutMotionExtension(path: string): string {
  const filename = path.split("/").pop() ?? path;
  return filename.replace(/\.motion3\.json$/i, "");
}

export class Live2DCharacterRuntime implements CharacterRuntime {
  readonly engine = "live2d-cubism" as const;

  private app: Application | null = null;
  private model: Live2DInstance | null = null;
  private manifest: CharacterManifest | null = null;
  private director: CharacterDirector | null = null;
  private status: CharacterRuntimeStatus = "idle";
  private activeState: string | null = null;
  private activeExpression: string | null = null;
  private activeMotion: MotionDescriptor | null = null;
  private error: string | null = null;
  private catalog: CharacterCatalog = { states: [], expressions: [], motions: [] };
  private rootTransform: CharacterRootTransform = DEFAULT_TRANSFORM;
  private fitScale = 1;
  private baseX = 0;
  private baseY = 0;
  private speaking = false;
  private speakingAmplitude = 0;
  private propLayer: Live2DPropLayer | null = null;

  async mount(
    canvas: HTMLCanvasElement,
    manifest: CharacterManifest,
    options: CharacterMountOptions,
  ): Promise<void> {
    if (this.status !== "idle") {
      await this.unload();
    }

    this.status = "loading";
    this.error = null;
    this.manifest = manifest;

    try {
      const [modelSettings, director] = await Promise.all([
        fetchJson<Live2DModelSettings>(manifest.modelPath),
        manifest.directorPath
          ? fetchJson<CharacterDirector>(manifest.directorPath)
          : Promise.resolve<CharacterDirector | null>(null),
      ]);

      this.director = director;
      this.catalog = this.buildCatalog(modelSettings, director);

      const app = new Application({
        view: canvas,
        width: options.width,
        height: options.height,
        backgroundAlpha: options.backgroundAlpha ?? 0,
        antialias: true,
        resolution: options.resolution ?? 1,
        autoDensity: true,
        autoStart: false,
      });
      this.app = app;
      (window as unknown as { PIXI?: typeof PIXI }).PIXI = PIXI;

      const loadedModel = await Live2DModel.from(manifest.modelPath, {
        autoHitTest: false,
        autoFocus: false,
        autoUpdate: true,
        ticker: app.ticker,
      });

      installCubism6RenderOrderBridge(loadedModel);

      // The textures are loaded but are not uploaded to WebGL until the first
      // render. Disable mipmap generation before that upload. This avoids the
      // GL_INVALID_OPERATION errors previously emitted by WebView2.
      for (const texture of loadedModel.textures) {
        texture.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
        texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
      }

      const webglRenderer = app.renderer as PIXI.Renderer;
      const maxTextureSize = webglRenderer.gl.getParameter(
        webglRenderer.gl.MAX_TEXTURE_SIZE,
      ) as number;
      console.info(
        `Desktop Buddy Live2D textures: 2048px atlases; GPU limit: ${maxTextureSize}px; mipmaps disabled.`,
      );
      if (maxTextureSize < 2048) {
        throw new Error(
          `This graphics device supports textures only up to ${maxTextureSize}px.`,
        );
      }

      const model = loadedModel as unknown as Live2DInstance;
      this.model = model;
      app.stage.addChild(loadedModel as unknown as PIXI.DisplayObject);
      model.anchor.set(0.5, 0.5);
      this.propLayer = new Live2DPropLayer(app, () => this.model?.getBounds(false) ?? null);

      this.fitScale =
        Math.min(
          app.screen.width / loadedModel.internalModel.originalWidth,
          app.screen.height / loadedModel.internalModel.originalHeight,
        ) * (options.fitScale ?? 0.9);
      this.baseX = app.screen.width / 2;
      this.baseY = app.screen.height / 2;
      this.applyRootTransform();

      app.ticker.add(this.applySpeakingFrame, undefined, PIXI.UPDATE_PRIORITY.LOW);
      app.start();
      this.status = "ready";

      const defaultState = manifest.defaultState ?? director?.settings?.defaultIdle;
      if (defaultState && director?.states[defaultState]) {
        await this.playState(defaultState);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      this.error = message;
      this.status = "error";
      await this.disposeRenderer();
      throw new Error(message);
    }
  }

  async unload(): Promise<void> {
    this.status = "unloading";
    try {
      await this.disposeRenderer();
    } finally {
      this.manifest = null;
      this.director = null;
      this.catalog = { states: [], expressions: [], motions: [] };
      this.activeState = null;
      this.activeExpression = null;
      this.activeMotion = null;
      this.error = null;
      this.speaking = false;
      this.speakingAmplitude = 0;
      this.rootTransform = DEFAULT_TRANSFORM;
      this.status = "idle";
    }
  }

  async playState(stateId: string): Promise<void> {
    this.assertReady();
    const state = this.director?.states[stateId];
    if (!state) {
      throw new Error(`State '${stateId}' is not defined by this character`);
    }

    this.propLayer?.setProps(state.props ?? []);

    if (state.expression) {
      await this.setExpression(state.expression);
    }

    const motion = this.resolveStateMotion(state);
    if (motion) {
      await this.playMotion(motion.group, motion.index);
    }
    this.activeState = stateId;
  }

  async setExpression(expressionId: string): Promise<void> {
    this.assertReady();
    if (!this.catalog.expressions.includes(expressionId)) {
      throw new Error(`Expression '${expressionId}' is not available`);
    }
    this.model?.expression(expressionId);
    this.activeExpression = expressionId;
  }

  async playMotion(group: string, index: number): Promise<void> {
    this.assertReady();
    const descriptor = this.catalog.motions.find(
      motion => motion.group === group && motion.index === index,
    );
    if (!descriptor) {
      throw new Error(`Motion '${group}[${index}]' is not available`);
    }
    this.model?.motion(group, index);
    this.activeMotion = descriptor;
  }

  setLookTarget(x: number, y: number): void {
    if (this.status !== "ready" || !this.model) return;
    const clampedX = Math.max(-1, Math.min(1, x));
    const clampedY = Math.max(-1, Math.min(1, y));

    // Live2DModel.focus() expects PIXI world-space coordinates. Phase 4.1
    // incorrectly passed already-normalized values, placing the target only a
    // pixel or two from the model centre. Feed the normalized target directly
    // into the runtime focus controller instead. The global tracker already
    // smooths the values, so instant application is stable and visibly tracks.
    this.model.internalModel.focusController?.focus(clampedX, clampedY, true);
  }

  setSpeaking(active: boolean, amplitude = 0.55): void {
    this.speaking = active;
    this.speakingAmplitude = Math.max(0, Math.min(1, amplitude));
    if (!active) {
      this.setParameterValue("ParamMouthOpenY", 0);
    }
  }

  setVoiceActivity(state: VoiceActivityVisualState): void {
    this.propLayer?.setVoiceActivity(state);
  }

  setRootTransform(transform: Partial<CharacterRootTransform>): void {
    this.rootTransform = { ...this.rootTransform, ...transform };
    this.applyRootTransform();
  }

  resize(width: number, height: number): void {
    if (!this.app) return;
    this.app.renderer.resize(width, height);
    this.baseX = width / 2;
    this.baseY = height / 2;
    this.applyRootTransform();
  }

  getInteractionBounds(): CharacterInteractionBounds | null {
    if (!this.model || !this.app) return null;

    const raw = this.model.getBounds(false);
    const padding = 16;
    const left = Math.max(0, raw.x - padding);
    const top = Math.max(0, raw.y - padding);
    const right = Math.min(this.app.screen.width, raw.x + raw.width + padding);
    const bottom = Math.min(this.app.screen.height, raw.y + raw.height + padding);

    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  getCatalog(): CharacterCatalog {
    return this.catalog;
  }

  getCapabilities(): CharacterRuntimeCapabilities {
    return {
      expressions: true,
      motions: true,
      states: this.catalog.states.length > 0,
      lookTarget: true,
      lipSync: true,
      rootTransform: true,
      hotSwap: true,
    };
  }

  getSnapshot(): CharacterRuntimeSnapshot {
    return {
      characterId: this.manifest?.id ?? null,
      status: this.status,
      activeState: this.activeState,
      activeExpression: this.activeExpression,
      activeMotion: this.activeMotion,
      error: this.error,
    };
  }

  private buildCatalog(
    modelSettings: Live2DModelSettings,
    director: CharacterDirector | null,
  ): CharacterCatalog {
    const expressions =
      modelSettings.FileReferences.Expressions?.map(reference => reference.Name) ?? [];
    const motions: MotionDescriptor[] = [];

    for (const [group, references] of Object.entries(
      modelSettings.FileReferences.Motions ?? {},
    )) {
      references.forEach((reference, index) => {
        motions.push({
          group,
          index,
          name: basenameWithoutMotionExtension(reference.File),
          file: reference.File,
        });
      });
    }

    return {
      states: Object.keys(director?.states ?? {}),
      expressions,
      motions,
    };
  }

  private resolveStateMotion(state: CharacterDirectorState): MotionDescriptor | null {
    if (state.motionFile) {
      const exact = this.catalog.motions.find(motion => motion.file === state.motionFile);
      if (exact) return exact;
    }
    if (state.motion) {
      const byName = this.catalog.motions.find(motion => motion.name === state.motion);
      if (byName) return byName;
    }
    return null;
  }

  private applyRootTransform(): void {
    if (!this.model) return;
    this.model.position.set(
      this.baseX + this.rootTransform.offsetX,
      this.baseY + this.rootTransform.offsetY,
    );
    this.model.scale.set(this.fitScale * this.rootTransform.scale);
    this.model.rotation = this.rootTransform.rotation;
  }

  private readonly applySpeakingFrame = (): void => {
    if (!this.speaking) return;
    const pulse = 0.25 + Math.abs(Math.sin(performance.now() / 90)) * 0.75;
    this.setParameterValue("ParamMouthOpenY", this.speakingAmplitude * pulse);
  };

  private setParameterValue(parameterId: string, value: number): void {
    const coreModel = (this.model as unknown as {
      internalModel?: {
        coreModel?: { setParameterValueById?: (id: string, nextValue: number) => void };
      };
    } | null)?.internalModel?.coreModel;
    coreModel?.setParameterValueById?.(parameterId, value);
  }

  private assertReady(): void {
    if (this.status !== "ready" || !this.model) {
      throw new Error("Character runtime is not ready");
    }
  }

  private async disposeRenderer(): Promise<void> {
    this.propLayer?.destroy();
    this.propLayer = null;
    if (this.app) {
      this.app.ticker.remove(this.applySpeakingFrame);
      this.app.stop();
      this.app.destroy(false, { children: true });
    }
    this.model = null;
    this.app = null;
  }
}
