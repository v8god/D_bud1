import * as PIXI from "pixi.js";
import type { Application } from "pixi.js";
import type { VoiceActivityVisualState } from "../../services/voice-manager/VoiceConversationTypes";

interface TypingParticle {
  readonly graphic: PIXI.Graphics;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly maxLifeMs: number;
  lifeMs: number;
}

const KEYBOARD_WIDTH = 250;
const KEYBOARD_HEIGHT = 74;
const KEYBOARD_VERTICAL_RATIO = 0.5;
const LAYOUT_REFRESH_MS = 100;
const TYPE_BEAT_MS = 150;
const VOICE_INDICATOR_WIDTH = 138;
const VOICE_INDICATOR_HEIGHT = 34;

/**
 * Live2D-only visual prop layer. It is deliberately isolated from React and
 * from the animation scheduler, so props can later be shared by other
 * character runtimes through a neutral prop service.
 */
export class Live2DPropLayer {
  private readonly keyboard = new PIXI.Container();
  private readonly particleLayer = new PIXI.Container();
  private readonly leftKeys: PIXI.Graphics[] = [];
  private readonly rightKeys: PIXI.Graphics[] = [];
  private readonly particles: TypingParticle[] = [];
  private readonly voiceIndicator = new PIXI.Container();
  private readonly voiceIndicatorBackground = new PIXI.Graphics();
  private readonly voiceIndicatorDot = new PIXI.Graphics();
  private readonly voiceBars: PIXI.Graphics[] = [];
  private voiceActivity: VoiceActivityVisualState = { mode: "hidden", level: 0, continuous: false };
  private activeProps = new Set<string>();
  private layoutCountdownMs = 0;
  private typeCountdownMs = 0;
  private typeLeft = true;
  private disposed = false;

  constructor(
    private readonly app: Application,
    private readonly getModelBounds: () => PIXI.Rectangle | null,
  ) {
    this.keyboard.eventMode = "none";
    this.particleLayer.eventMode = "none";

    this.buildKeyboard();
    this.buildVoiceIndicator();

    // The user-facing prop must be in front of the Live2D model. The previous
    // implementation deliberately inserted it behind the model, which made it
    // look as though the keyboard was hidden inside or behind the character.
    this.app.stage.addChild(this.keyboard);
    this.app.stage.addChild(this.particleLayer);
    this.app.stage.addChild(this.voiceIndicator);

    this.keyboard.visible = false;
    this.particleLayer.visible = false;
    this.voiceIndicator.visible = false;
    this.app.ticker.add(this.update, undefined, PIXI.UPDATE_PRIORITY.LOW);
  }

  setProps(propIds: readonly string[]): void {
    this.activeProps = new Set(propIds);
    const showKeyboard = this.activeProps.has("keyboard");
    this.keyboard.visible = showKeyboard;
    this.particleLayer.visible = showKeyboard && this.activeProps.has("typing_particles");
    this.typeCountdownMs = 0;
    this.layoutCountdownMs = 0;

    if (!showKeyboard) {
      this.clearParticles();
      this.resetKeyBrightness();
    } else {
      this.layoutKeyboard();
    }
  }

  setVoiceActivity(state: VoiceActivityVisualState): void {
    this.voiceActivity = {
      mode: state.mode,
      level: clamp(state.level, 0, 1),
      continuous: state.continuous,
    };
    this.voiceIndicator.visible = state.mode !== "hidden";
    if (this.voiceIndicator.visible) {
      this.paintVoiceIndicator();
      this.layoutVoiceIndicator();
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.app.ticker.remove(this.update);
    this.clearParticles();
    this.keyboard.destroy({ children: true });
    this.particleLayer.destroy({ children: true });
    this.voiceIndicator.destroy({ children: true });
  }

  private buildVoiceIndicator(): void {
    this.voiceIndicator.eventMode = "none";
    this.voiceIndicatorBackground.beginFill(0x07111f, 0.9);
    this.voiceIndicatorBackground.lineStyle(1.5, 0xffffff, 0.24);
    this.voiceIndicatorBackground.drawRoundedRect(0, 0, VOICE_INDICATOR_WIDTH, VOICE_INDICATOR_HEIGHT, 16);
    this.voiceIndicatorBackground.endFill();
    this.voiceIndicator.addChild(this.voiceIndicatorBackground);

    this.voiceIndicatorDot.beginFill(0x38bdf8, 1);
    this.voiceIndicatorDot.drawCircle(17, VOICE_INDICATOR_HEIGHT / 2, 5);
    this.voiceIndicatorDot.endFill();
    this.voiceIndicator.addChild(this.voiceIndicatorDot);

    for (let index = 0; index < 8; index += 1) {
      const bar = new PIXI.Graphics();
      bar.beginFill(0x38bdf8, 0.95);
      bar.drawRoundedRect(0, -8, 7, 16, 3);
      bar.endFill();
      bar.position.set(34 + index * 11, VOICE_INDICATOR_HEIGHT / 2);
      this.voiceBars.push(bar);
      this.voiceIndicator.addChild(bar);
    }
  }

  private buildKeyboard(): void {
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x000000, 0.28);
    shadow.drawRoundedRect(7, 8, KEYBOARD_WIDTH, KEYBOARD_HEIGHT, 14);
    shadow.endFill();
    this.keyboard.addChild(shadow);

    const caseGraphic = new PIXI.Graphics();
    caseGraphic.lineStyle(2, 0xa8b7ca, 0.8);
    caseGraphic.beginFill(0x1b2430, 0.96);
    caseGraphic.drawRoundedRect(0, 0, KEYBOARD_WIDTH, KEYBOARD_HEIGHT, 14);
    caseGraphic.endFill();
    this.keyboard.addChild(caseGraphic);

    const glow = new PIXI.Graphics();
    glow.beginFill(0x7dd3fc, 0.12);
    glow.drawRoundedRect(8, 7, KEYBOARD_WIDTH - 16, KEYBOARD_HEIGHT - 14, 9);
    glow.endFill();
    this.keyboard.addChild(glow);

    const rows = [
      { count: 12, y: 12, startX: 13, keyWidth: 16, gap: 3 },
      { count: 11, y: 31, startX: 20, keyWidth: 17, gap: 3 },
      { count: 9, y: 50, startX: 29, keyWidth: 18, gap: 4 },
    ];

    for (const row of rows) {
      for (let index = 0; index < row.count; index += 1) {
        const x = row.startX + index * (row.keyWidth + row.gap);
        const key = new PIXI.Graphics();
        key.lineStyle(1, 0xcbd5e1, 0.45);
        key.beginFill(0x405064, 0.92);
        key.drawRoundedRect(x, row.y, row.keyWidth, 12, 3);
        key.endFill();
        key.alpha = 0.66;
        this.keyboard.addChild(key);
        (x + row.keyWidth / 2 < KEYBOARD_WIDTH / 2 ? this.leftKeys : this.rightKeys).push(key);
      }
    }
  }

  private readonly update = (): void => {
    if (this.disposed) return;

    const deltaMs = Math.min(50, this.app.ticker.deltaMS || 16.67);
    this.layoutCountdownMs -= deltaMs;

    if (this.keyboard.visible) {
      this.typeCountdownMs -= deltaMs;
      if (this.layoutCountdownMs <= 0) this.layoutKeyboard();
      if (this.typeCountdownMs <= 0) {
        this.typeCountdownMs += TYPE_BEAT_MS;
        this.typeLeft = !this.typeLeft;
        this.flashKeys(this.typeLeft);
        if (this.activeProps.has("typing_particles")) this.spawnTypingParticles(this.typeLeft);
      }
      this.updateParticles(deltaMs);
    }

    if (this.voiceIndicator.visible) {
      if (this.layoutCountdownMs <= 0) this.layoutVoiceIndicator();
      this.animateVoiceIndicator();
    }

    if (this.layoutCountdownMs <= 0) this.layoutCountdownMs = LAYOUT_REFRESH_MS;
  };

  private layoutVoiceIndicator(): void {
    const bounds = this.getModelBounds();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    const scale = clamp(bounds.width / 460, 0.78, 1.08);
    const width = VOICE_INDICATOR_WIDTH * scale;
    const x = clamp(bounds.x + bounds.width * 0.5 - width / 2, 10, this.app.screen.width - width - 10);
    const y = clamp(bounds.y + bounds.height * 0.13, 10, this.app.screen.height - VOICE_INDICATOR_HEIGHT * scale - 10);
    this.voiceIndicator.scale.set(scale);
    this.voiceIndicator.position.set(x, y);
  }

  private paintVoiceIndicator(): void {
    const color = voiceColor(this.voiceActivity.mode);
    this.voiceIndicatorDot.clear();
    this.voiceIndicatorDot.beginFill(color, 1);
    this.voiceIndicatorDot.drawCircle(17, VOICE_INDICATOR_HEIGHT / 2, this.voiceActivity.continuous ? 6 : 5);
    this.voiceIndicatorDot.endFill();
    for (const bar of this.voiceBars) bar.tint = color;
  }

  private animateVoiceIndicator(): void {
    const now = performance.now();
    const base = this.voiceActivity.mode === "thinking"
      ? 0.22 + Math.abs(Math.sin(now / 280)) * 0.55
      : this.voiceActivity.mode === "error"
        ? 0.3 + Math.abs(Math.sin(now / 110)) * 0.55
        : this.voiceActivity.level;

    this.voiceBars.forEach((bar, index) => {
      const wave = 0.32 + Math.abs(Math.sin(now / 125 + index * 0.75)) * 0.68;
      const strength = clamp(base * 0.75 + wave * 0.25, 0.08, 1);
      bar.scale.y = 0.22 + strength * 0.95;
      bar.alpha = 0.45 + strength * 0.55;
    });
    this.voiceIndicatorDot.alpha = 0.65 + Math.abs(Math.sin(now / 240)) * 0.35;
  }

  private layoutKeyboard(): void {
    const bounds = this.getModelBounds();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

    const targetWidth = clamp(bounds.width * 0.52, 180, 268);
    const scale = targetWidth / KEYBOARD_WIDTH;
    const renderedWidth = KEYBOARD_WIDTH * scale;
    const renderedHeight = KEYBOARD_HEIGHT * scale;
    const x = bounds.x + bounds.width / 2 - renderedWidth / 2;

    // Place the keyboard at approximately half the character's height measured
    // upward from the feet. The value below positions the keyboard's centre at
    // the model midpoint instead of placing its top near the lower legs.
    const targetCenterY = bounds.y + bounds.height * KEYBOARD_VERTICAL_RATIO;
    const y = clamp(
      targetCenterY - renderedHeight / 2,
      10,
      this.app.screen.height - renderedHeight - 10,
    );

    this.keyboard.scale.set(scale);
    this.keyboard.position.set(x, y);
    this.particleLayer.scale.set(scale);
    this.particleLayer.position.set(x, y);
  }

  private flashKeys(leftSide: boolean): void {
    const active = leftSide ? this.leftKeys : this.rightKeys;
    const inactive = leftSide ? this.rightKeys : this.leftKeys;

    for (const key of active) key.alpha = 1;
    for (const key of inactive) key.alpha = 0.52;
  }

  private resetKeyBrightness(): void {
    for (const key of [...this.leftKeys, ...this.rightKeys]) key.alpha = 0.66;
  }

  private spawnTypingParticles(leftSide: boolean): void {
    const centerX = leftSide ? KEYBOARD_WIDTH * 0.34 : KEYBOARD_WIDTH * 0.66;
    const particleCount = 2 + Math.floor(Math.random() * 2);

    for (let index = 0; index < particleCount; index += 1) {
      const graphic = new PIXI.Graphics();
      const size = 2.5 + Math.random() * 2.5;
      graphic.beginFill(index % 2 === 0 ? 0x7dd3fc : 0xfde68a, 0.9);
      graphic.drawRoundedRect(-size / 2, -size / 2, size, size, 1.2);
      graphic.endFill();
      graphic.x = centerX + (Math.random() - 0.5) * 55;
      graphic.y = 4 + Math.random() * 12;
      this.particleLayer.addChild(graphic);

      const maxLifeMs = 430 + Math.random() * 240;
      this.particles.push({
        graphic,
        velocityX: (Math.random() - 0.5) * 0.045,
        velocityY: -0.045 - Math.random() * 0.035,
        maxLifeMs,
        lifeMs: maxLifeMs,
      });
    }
  }

  private updateParticles(deltaMs: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      if (!particle) continue;
      particle.lifeMs -= deltaMs;
      particle.graphic.x += particle.velocityX * deltaMs;
      particle.graphic.y += particle.velocityY * deltaMs;
      particle.graphic.rotation += 0.0025 * deltaMs;
      particle.graphic.alpha = Math.max(0, particle.lifeMs / particle.maxLifeMs);

      if (particle.lifeMs <= 0) {
        particle.graphic.destroy();
        this.particles.splice(index, 1);
      }
    }
  }

  private clearParticles(): void {
    for (const particle of this.particles) particle.graphic.destroy();
    this.particles.splice(0, this.particles.length);
  }
}

function voiceColor(mode: VoiceActivityVisualState["mode"]): number {
  switch (mode) {
    case "listening": return 0x38bdf8;
    case "thinking": return 0xfbbf24;
    case "speaking": return 0x34d399;
    case "error": return 0xfb7185;
    case "hidden": return 0x94a3b8;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
