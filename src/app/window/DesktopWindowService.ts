import {
  LogicalSize,
  PhysicalPosition,
  availableMonitors,
  getCurrentWindow,
  type Monitor,
  type Window as TauriWindow,
} from "@tauri-apps/api/window";

export const OVERLAY_WIDTH = 520;
export const OVERLAY_HEIGHT = 720;

const POSITION_STORAGE_KEY = "desktop-buddy.overlay-position.v1";
const EDGE_MARGIN_LOGICAL = 24;
const MIN_VISIBLE_PHYSICAL = 96;

interface StoredPosition {
  readonly x: number;
  readonly y: number;
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export class DesktopWindowService {
  private readonly appWindow: TauriWindow | null = isTauriRuntime()
    ? getCurrentWindow()
    : null;
  private unlistenMoved: (() => void) | null = null;
  private unlistenScaleChanged: (() => void) | null = null;
  private saveTimer: number | null = null;

  get available(): boolean {
    return this.appWindow !== null;
  }

  async initialize(): Promise<void> {
    if (!this.appWindow) return;

    await Promise.all([
      this.appWindow.setAlwaysOnTop(true),
      this.appWindow.setSkipTaskbar(true),
      this.appWindow.setSize(new LogicalSize(OVERLAY_WIDTH, OVERLAY_HEIGHT)),
      this.appWindow.setIgnoreCursorEvents(false),
    ]);

    await this.restoreOrPlaceWindow();

    this.unlistenMoved = await this.appWindow.onMoved(({ payload }) => {
      this.schedulePositionSave({ x: payload.x, y: payload.y });
    });

    this.unlistenScaleChanged = await this.appWindow.onScaleChanged(() => {
      void this.ensureVisibleOnSomeMonitor();
    });
  }

  async startDragging(): Promise<void> {
    if (!this.appWindow) return;
    await this.appWindow.startDragging();
  }

  async setPassThrough(enabled: boolean): Promise<void> {
    if (!this.appWindow) return;
    await this.appWindow.setIgnoreCursorEvents(enabled);
  }

  async resetToBottomRight(): Promise<void> {
    if (!this.appWindow) return;

    const monitors = await availableMonitors();
    if (monitors.length === 0) return;

    const currentPosition = await this.appWindow.outerPosition();
    const windowSize = await this.appWindow.outerSize();
    const monitor = this.findBestMonitor(currentPosition, windowSize.width, windowSize.height, monitors)
      ?? monitors[0];

    const margin = Math.round(EDGE_MARGIN_LOGICAL * monitor.scaleFactor);
    const x =
      monitor.workArea.position.x +
      monitor.workArea.size.width -
      windowSize.width -
      margin;
    const y =
      monitor.workArea.position.y +
      monitor.workArea.size.height -
      windowSize.height -
      margin;

    await this.appWindow.setPosition(new PhysicalPosition(x, y));
    this.savePosition({ x, y });
  }

  async ensureVisibleOnSomeMonitor(): Promise<void> {
    if (!this.appWindow) return;

    const [position, size, monitors] = await Promise.all([
      this.appWindow.outerPosition(),
      this.appWindow.outerSize(),
      availableMonitors(),
    ]);

    if (monitors.length === 0) return;
    if (this.isPositionVisible(position, size.width, size.height, monitors)) return;
    await this.resetToBottomRight();
  }

  dispose(): void {
    this.unlistenMoved?.();
    this.unlistenScaleChanged?.();
    this.unlistenMoved = null;
    this.unlistenScaleChanged = null;

    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private async restoreOrPlaceWindow(): Promise<void> {
    if (!this.appWindow) return;

    const [size, monitors] = await Promise.all([
      this.appWindow.outerSize(),
      availableMonitors(),
    ]);
    const stored = this.readStoredPosition();

    if (
      stored &&
      monitors.length > 0 &&
      this.isPositionVisible(stored, size.width, size.height, monitors)
    ) {
      await this.appWindow.setPosition(new PhysicalPosition(stored.x, stored.y));
      return;
    }

    await this.resetToBottomRight();
  }

  private schedulePositionSave(position: StoredPosition): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }

    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.savePosition(position);
    }, 160);
  }

  private savePosition(position: StoredPosition): void {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
  }

  private readStoredPosition(): StoredPosition | null {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Partial<StoredPosition>;
      if (typeof parsed.x !== "number" || typeof parsed.y !== "number") {
        return null;
      }
      return { x: parsed.x, y: parsed.y };
    } catch {
      return null;
    }
  }

  private isPositionVisible(
    position: StoredPosition,
    width: number,
    height: number,
    monitors: readonly Monitor[],
  ): boolean {
    return monitors.some(monitor => {
      const left = Math.max(position.x, monitor.workArea.position.x);
      const top = Math.max(position.y, monitor.workArea.position.y);
      const right = Math.min(
        position.x + width,
        monitor.workArea.position.x + monitor.workArea.size.width,
      );
      const bottom = Math.min(
        position.y + height,
        monitor.workArea.position.y + monitor.workArea.size.height,
      );

      return (
        right - left >= MIN_VISIBLE_PHYSICAL &&
        bottom - top >= MIN_VISIBLE_PHYSICAL
      );
    });
  }

  private findBestMonitor(
    position: StoredPosition,
    width: number,
    height: number,
    monitors: readonly Monitor[],
  ): Monitor | null {
    let best: Monitor | null = null;
    let bestArea = -1;

    for (const monitor of monitors) {
      const left = Math.max(position.x, monitor.workArea.position.x);
      const top = Math.max(position.y, monitor.workArea.position.y);
      const right = Math.min(
        position.x + width,
        monitor.workArea.position.x + monitor.workArea.size.width,
      );
      const bottom = Math.min(
        position.y + height,
        monitor.workArea.position.y + monitor.workArea.size.height,
      );
      const area = Math.max(0, right - left) * Math.max(0, bottom - top);
      if (area > bestArea) {
        bestArea = area;
        best = monitor;
      }
    }

    return best;
  }
}
