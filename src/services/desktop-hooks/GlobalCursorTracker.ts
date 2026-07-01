import {
  cursorPosition,
  getCurrentWindow,
  type PhysicalPosition,
  type PhysicalSize,
  type Window as TauriWindow,
} from "@tauri-apps/api/window";
import { isTauriRuntime } from "../../app/window/DesktopWindowService";

const SAMPLE_INTERVAL_MS = 50;
const SMOOTHING = 0.22;
const NORMALIZATION_WIDTH_FACTOR = 0.85;
const NORMALIZATION_HEIGHT_FACTOR = 0.82;

interface WindowGeometry {
  position: PhysicalPosition;
  size: PhysicalSize;
}

/** Polls the desktop-level cursor so the character can follow the pointer even
 * when the pointer is over another application or another monitor. */
export class GlobalCursorTracker {
  private readonly appWindow: TauriWindow | null = isTauriRuntime()
    ? getCurrentWindow()
    : null;
  private geometry: WindowGeometry | null = null;
  private timerId: number | null = null;
  private unlistenMoved: (() => void) | null = null;
  private unlistenResized: (() => void) | null = null;
  private enabled = true;
  private sampling = false;
  private smoothedX = 0;
  private smoothedY = 0;

  constructor(private readonly onTarget: (x: number, y: number) => void) {}

  async start(): Promise<void> {
    if (this.timerId !== null) return;

    if (!this.appWindow) {
      const listener = (event: MouseEvent) => {
        if (!this.enabled) return;
        const x = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
        const y = -((event.clientY / Math.max(1, window.innerHeight)) * 2 - 1);
        this.pushTarget(x, y);
      };
      window.addEventListener("mousemove", listener);
      this.unlistenMoved = () => window.removeEventListener("mousemove", listener);
      return;
    }

    await this.refreshGeometry();
    this.unlistenMoved = await this.appWindow.onMoved(({ payload }) => {
      if (!this.geometry) return;
      this.geometry = { ...this.geometry, position: payload };
    });
    this.unlistenResized = await this.appWindow.onResized(({ payload }) => {
      if (!this.geometry) return;
      this.geometry = { ...this.geometry, size: payload };
    });

    this.timerId = window.setInterval(() => {
      void this.sample();
    }, SAMPLE_INTERVAL_MS);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.smoothedX = 0;
      this.smoothedY = 0;
      this.onTarget(0, 0);
    }
  }

  dispose(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    this.unlistenMoved?.();
    this.unlistenResized?.();
    this.unlistenMoved = null;
    this.unlistenResized = null;
  }

  private async sample(): Promise<void> {
    if (!this.enabled || !this.geometry || this.sampling) return;
    this.sampling = true;

    try {
      const pointer = await cursorPosition();
      const centerX = this.geometry.position.x + this.geometry.size.width / 2;
      const centerY = this.geometry.position.y + this.geometry.size.height * 0.42;
      const x = (pointer.x - centerX) /
        Math.max(1, this.geometry.size.width * NORMALIZATION_WIDTH_FACTOR);
      const y = -(pointer.y - centerY) /
        Math.max(1, this.geometry.size.height * NORMALIZATION_HEIGHT_FACTOR);
      this.pushTarget(x, y);
    } finally {
      this.sampling = false;
    }
  }

  private pushTarget(x: number, y: number): void {
    const targetX = clamp(x, -1, 1);
    const targetY = clamp(y, -1, 1);
    this.smoothedX += (targetX - this.smoothedX) * SMOOTHING;
    this.smoothedY += (targetY - this.smoothedY) * SMOOTHING;
    this.onTarget(this.smoothedX, this.smoothedY);
  }

  private async refreshGeometry(): Promise<void> {
    if (!this.appWindow) return;
    const [position, size] = await Promise.all([
      this.appWindow.outerPosition(),
      this.appWindow.outerSize(),
    ]);
    this.geometry = { position, size };
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
