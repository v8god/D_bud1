import type { CSSProperties } from "react";
import type { MemoryCaptureMode } from "../../services/preferences/BuddyPreferenceStore";

export type RadialActionId = "talk" | "voice" | "memory" | "tasks" | "settings";

interface CharacterRadialMenuProps {
  readonly open: boolean;
  readonly centerX: number;
  readonly centerY: number;
  readonly voiceEnabled: boolean;
  readonly memoryMode: MemoryCaptureMode;
  readonly activeAction: RadialActionId | null;
  readonly onAction: (action: RadialActionId) => void;
}

interface RadialItem {
  readonly id: RadialActionId;
  readonly label: string;
  readonly icon: string;
  readonly angleDegrees: number;
}

const RADIUS = 116;

export function CharacterRadialMenu({
  open,
  centerX,
  centerY,
  voiceEnabled,
  memoryMode,
  activeAction,
  onAction,
}: CharacterRadialMenuProps) {
  if (!open) return null;

  const items: readonly RadialItem[] = [
    { id: "talk", label: "Talk", icon: "◉", angleDegrees: -90 },
    {
      id: "voice",
      label: voiceEnabled ? "Mute voice" : "Enable voice",
      icon: voiceEnabled ? "♪" : "×",
      angleDegrees: -18,
    },
    { id: "settings", label: "Settings", icon: "⚙", angleDegrees: 54 },
    { id: "tasks", label: "AI activity", icon: "✓", angleDegrees: 126 },
    {
      id: "memory",
      label: memoryMode === "private" ? "Resume memory" : "Private mode",
      icon: memoryMode === "private" ? "◇" : "◆",
      angleDegrees: 198,
    },
  ];

  return (
    <div
      className="character-radial-menu"
      style={{ left: centerX, top: centerY }}
      role="menu"
      aria-label="Desktop Buddy controls"
      onPointerDown={event => event.stopPropagation()}
      onContextMenu={event => event.preventDefault()}
    >
      <div className="radial-menu-core" aria-hidden="true">•••</div>
      {items.map((item, index) => {
        const angle = (item.angleDegrees * Math.PI) / 180;
        const style = {
          "--radial-x": `${Math.cos(angle) * RADIUS}px`,
          "--radial-y": `${Math.sin(angle) * RADIUS}px`,
          "--radial-delay": `${index * 35}ms`,
        } as CSSProperties;

        return (
          <button
            type="button"
            role="menuitem"
            key={item.id}
            className={`radial-menu-button ${activeAction === item.id ? "active" : ""}`}
            style={style}
            onClick={() => onAction(item.id)}
            aria-label={item.label}
            title={item.label}
          >
            <span className="radial-menu-icon" aria-hidden="true">{item.icon}</span>
            <span className="radial-menu-label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
