# Desktop Buddy Phase Roadmap

## Phase 1 — Rendering baseline

Cubism 6 rendering, neutral model, face/layer correction, expression and motion validation.

## Phase 2 — Character runtime abstraction

Engine-neutral character interface, Live2D adapter, registry, hot swapping, asset-driven state resolution and test workbench.

## Phase 3 — Transparent desktop overlay

Implemented baseline: Tauri transparent frameless window, always-on-top behaviour, fixed overlay route, native dragging, position persistence, monitor validation, tray safety controls and recoverable whole-window pass-through. Native per-pixel hit-testing remains a Windows verification sub-step.

## Phase 4 — Event-driven animation engine

Implemented baseline: prioritized queue, interruption rules, event-to-state mapping, whole-character root motion, celebration jump, click reaction, Windows system-idle detection, sleepy/sleep/wake transitions, notification and AI task reactions, low-battery state, drag reaction and thrown/impact test sequence. Props, confetti and full screen-edge physics remain later refinements.

## Phase 5 — Character interaction menu

Implemented baseline: click reaction, five radial controls, persistent voice/private-memory preferences, settings panel, typing sensitivity controls and diagnostic task view.

## Phase 6 — Voice conversation

Implemented baseline: microphone permission and level monitoring, one-utterance speech recognition when exposed by WebView2, typed fallback, provider-neutral voice-agent interface, local demo agent, system text-to-speech, voice selection, mouth amplitude, listening/thinking/speaking animation events and cancellation. A production AI provider connects later through Phase 8 / Phase Alpha.

## Phase 7 — Memory

Implemented baseline: default-on local SQLite memory, conversation turns, explicit fact extraction, six-turn session summaries, lightweight relevance-vector retrieval, search/pin/delete/clear controls, manual memories, restart persistence and immediate private mode. At-rest encryption remains a Phase 9 hardening item.

## Phase 8 — Multi-agent task monitoring

Provider-neutral task events, simultaneous job tracking and provider-labelled completion announcements.

## Phase Alpha — Agent connector foundation

A deliberately small but production-tested plug-in boundary inserted after Phase 8.

It will include:

- `AgentConnector` interface;
- connector manifest and capability declaration;
- connector registry;
- authentication/configuration boundary;
- start/cancel/status/result methods;
- normalized streaming and task events;
- health check and version compatibility;
- isolation so one broken connector cannot break the buddy;
- one mock connector and one real connector as acceptance tests.

Adding a later agent should mean registering a connector rather than changing the character, memory, voice or UI core.

Phase Alpha is **not** the large-scale agent creation phase. It is the tested socket into which those future agents will plug.

## Phase 9 — Production hardening

Performance profiles, secure secret storage, crash recovery, logging, updater, installer, tests, privacy controls and GPU fallback.
