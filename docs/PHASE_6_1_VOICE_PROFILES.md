# Phase 6.1 — Continuous voice and reusable custom voices

## Immediate features

- Manual push-to-talk mode.
- Continuous conversation mode with configurable silence timeout.
- Pixi listening/thinking/speaking indicator visible without opening the radial menu.
- All installed Windows/WebView2 voices remain selectable independently of the character model.
- Voice labels are filters only; a feminine, masculine, neutral, or unclassified voice can be used with any model.
- Custom reference recording/upload, normalization to mono 24 kHz PCM WAV, and persistent app-data storage.
- Consent confirmation before a custom reference can be saved.
- Local response library with time-aware greetings, identity, thanks, affection, sleep/wake, and future desktop-action acknowledgements.

## Custom cloning engine

A webview cannot clone a voice through `speechSynthesis`. The optional local engine lives in `voice-engine/` and exposes a small provider-neutral HTTP contract.

1. Install Python 3.11.
2. Run `powershell -ExecutionPolicy Bypass -File .\voice-engine\setup.ps1`.
3. Review and accept the model's licensing/terms for your intended use.
4. Run `.\voice-engine\run.ps1`.
5. In Desktop Buddy Settings, press **Refresh engine**.
6. Record/upload a voice profile and press **Prepare once**.

The first preparation call passes both `speaker_wav` and the profile ID to Coqui XTTS. Current coqui-tts releases cache that cloned speaker, so later synthesis reuses the speaker ID without processing the reference audio again.

The Python engine is a development integration. Before commercial production, replace or license the underlying model appropriately, package the engine as a Tauri sidecar, add signed updates, and test CPU/GPU requirements.
