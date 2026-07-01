# Phase 4.1 interaction additions

## Procedural typing prop

`Live2DPropLayer` owns character-engine-specific visual props. The keyboard is inserted behind the Live2D model so the hands remain visible, while typing particles are rendered in a foreground layer. Director state props activate it:

```json
"props": ["keyboard", "typing_particles"]
```

The layer is destroyed with the runtime and does not leak Pixi ticker callbacks.

## Global look target

`GlobalCursorTracker` uses Tauri's desktop cursor position and physical window geometry. It samples at 20 Hz, smooths the normalized target, clamps it to `[-1, 1]`, and forwards it only through `CharacterService.setLookTarget`. No UI module imports Live2D.

## Tray-only Windows mode

Tauri's `skipTaskbar` and `alwaysOnTop` remain enabled. The native Windows reinforcement applies:

- `WS_EX_TOOLWINDOW`;
- `WS_EX_TOPMOST`;
- removal of `WS_EX_APPWINDOW`;
- `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE)` after focus loss.

This keeps the overlay visible without stealing keyboard focus and prevents the visible character window from becoming an ordinary taskbar application button.
