# Phase 3 Architecture — Desktop Overlay

## Purpose

Phase 3 moves the Phase 2 character runtime from a visible workbench into a Tauri desktop overlay without coupling native window behaviour to Live2D.

## Runtime flow

```text
DesktopBuddyOverlay
├── CharacterService
│   └── CharacterRuntime
│       └── Live2DCharacterRuntime
└── DesktopWindowService
    └── Tauri Window API
```

The character runtime is responsible for rendering and character interaction bounds. `DesktopWindowService` is responsible for native placement, movement, persistence, monitor validation and pass-through mode.

## Window properties

The main Tauri window is configured as:

- transparent;
- frameless;
- fixed at 520 × 720 logical pixels;
- always on top;
- hidden from the taskbar;
- non-resizable;
- no native shadow.

## Position persistence

The frontend stores the native physical position in local storage under:

```text
desktop-buddy.overlay-position.v1
```

A stored position is restored only when at least 96 physical pixels remain visible inside a monitor work area. Otherwise, the overlay is placed at the lower-right of a visible monitor with a DPI-aware margin.

## Tray safety controls

The Rust tray menu provides:

- Enable Interaction;
- Desktop Pass-through;
- Reset Position;
- Quit Desktop Buddy.

This prevents permanent lockout when the whole native window ignores mouse events.

## Diagnostic UI

The Phase 3 diagnostic panel is hidden by default. It can be opened with:

- right-click on the character;
- double-click on the character;
- F2 while focused.

This panel is temporary. The actual radial interaction menu belongs to Phase 5.

## Interaction bounds

`CharacterRuntime.getInteractionBounds()` exposes an engine-neutral rectangle around the rendered character. Phase 3 uses it to avoid starting drag/debug actions from clearly empty canvas margins.

It is not yet a native per-pixel click-through mask. Whole-window pass-through is available through Tauri and can always be reversed from the tray.

## Deferred work

- Per-pixel or native region hit-testing.
- Click reaction and event priority.
- Drag physics and gravity.
- Idle/sleep scheduling.
- Radial settings/voice/memory buttons.

Those belong to Phase 4 and Phase 5 after the native overlay baseline is stable.
