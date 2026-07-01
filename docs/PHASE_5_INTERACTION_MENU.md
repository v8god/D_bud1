# Phase 5 — Character Interaction Menu

Phase 5 replaces the temporary idea of a separate control window with a compact radial menu anchored to the character.

## Character click behaviour

A short click:

1. emits the existing `character:clicked` reaction;
2. calculates the visible character centre from runtime interaction bounds;
3. opens five radial actions around the upper body;
4. closes automatically after the configured timeout when no panel is open.

Dragging still begins only after the pointer moves at least seven pixels. Right-click, double-click, and F2 retain the diagnostics panel.

## Radial actions

- **Talk** — permanent entry point for Phase 6 voice conversation. Phase 5 does not pretend speech recognition is already connected.
- **Voice** — persists the intended voice-output enabled/muted preference.
- **Memory** — persists normal/private capture preference. Phase 7 will enforce this preference in durable memory storage.
- **AI activity** — shows current character, animation, system-idle, and agent status. Phase 8 and Phase Alpha will populate real tasks and connectors.
- **Settings** — controls cursor following, automatic typing reactions, and menu auto-close timing.

Preferences are stored locally under `desktop-buddy.preferences.v1`.

## Global keyboard activity repair

The frontend no longer invokes `poll_global_keyboard_activity` repeatedly. The Windows Rust process polls activity internally and emits only a boolean start/stop event:

`desktop-buddy-keyboard-typing`

No key code, typed text, shortcut, or password content is emitted or stored.
