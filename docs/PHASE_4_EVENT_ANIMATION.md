# Phase 4 — Event-driven animation engine

## Delivered baseline

Phase 4 separates application events from direct Live2D calls.

```text
Desktop/system/AI event
        ↓
DesktopBuddyAnimationEngine
        ↓
CharacterAnimationScheduler
        ↓
CharacterService
        ↓
CharacterRuntime (Live2D today, another engine later)
```

## Implemented events

- character click → curious reaction;
- manual state requests;
- celebration → rig motion plus whole-character double jump;
- notification → alert pop;
- AI task started → thinking/waiting loop;
- AI task completed → success bounce;
- system idle → sleepy after 2 minutes, sleep after 5 minutes;
- renewed user activity → wake-up transition;
- low battery → drooping loop;
- drag started → dragged/flailing state;
- gravity drop test → thrown flight followed by impact/recovery.

## Scheduler behaviour

- one animation owns the character at a time;
- requests carry priorities;
- high-priority events can interrupt lower-priority loops;
- queued requests are ordered by priority;
- duplicate sources replace stale queued requests;
- temporary reactions return to neutral state;
- root motion is reset after completion, interruption, or failure;
- Live2D-specific code remains behind CharacterService.

## Root presentation motion

The Live2D motion controls available rig parameters such as shoulders, body angles,
feet and arm physics. `RootMotionPlayer` moves the complete rendered character for
motions the 2D rig cannot create by itself:

- jumping;
- takeoff compression;
- landing squash/bounce;
- notification pop;
- recoil;
- thrown rotation;
- impact recovery.

This does not add missing fingers, elbows, knees, or hand poses to the model.
Those still require Cubism rig editing or a 3D character runtime.

## Sleep expression correction

The previous sleep-family expressions used `Add` blending for eye openness. A value
of zero added to already-open eyes does not close them. The following now use
absolute `Overwrite` values for eye and mouth state:

- sleepy;
- sleep;
- wake_up;
- low_battery.

The sleep expressions also clear happy/smiling eye parameters so a previous happy
state cannot remain visible while sleeping.

## Native system idle detection

On Windows, Tauri now exposes `get_system_idle_ms`, backed by `GetLastInputInfo`.
The frontend polls every five seconds. Browser workbench mode uses local browser
activity as a fallback.

## Deferred work

- rendered keyboard prop and typing particles;
- confetti/sparkle renderer;
- real screen-edge gravity and collision physics;
- native per-pixel hit testing;
- settings UI for idle thresholds and click reaction;
- audio cues;
- motion blending refinements.
