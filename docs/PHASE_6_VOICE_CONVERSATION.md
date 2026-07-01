# Phase 6 — Voice Conversation

Phase 6 adds an engine-neutral voice conversation pipeline without coupling the character runtime to any specific AI provider.

## Runtime flow

```text
Talk panel
  -> microphone permission and level meter
  -> speech recognition adapter
  -> VoiceConversationAgent interface
  -> local demo agent
  -> system speech synthesis
  -> voice animation events
  -> Live2D mouth movement
```

## Modules

- `VoiceConversationController`: lifecycle orchestration and cancellation.
- `BrowserSpeechRecognitionAdapter`: one-utterance Web Speech recognition when available.
- `MicrophoneLevelMonitor`: non-persistent microphone level monitoring.
- `BrowserSpeechSynthesisService`: system voice selection and TTS.
- `VoiceConversationAgent`: provider-neutral response contract.
- `LocalDemoVoiceAgent`: test agent used until Phase 8 / Phase Alpha connectors are registered.

## Privacy baseline

- Microphone tracks exist only during an active listening request.
- Tracks and Web Audio resources are stopped after recognition, cancellation, or errors.
- Phase 6 does not save microphone recordings.
- Typed fallback messages are not persisted by Phase 6.
- A speech-recognition implementation supplied by the installed browser runtime may use an external recognition service.

## Animation mapping

- Requesting/listening -> `focused`
- Thinking -> `ai_waiting`
- Speaking -> `soft_smile` plus runtime mouth amplitude
- Error -> `surprised`
- Completion/cancel -> `idle_neutral`

## Future provider replacement

`VoiceConversationController` depends on `VoiceConversationAgent`. Phase 8 / Phase Alpha can replace `LocalDemoVoiceAgent` with Claude, OpenAI, Gemini, a local model, or another connector without changing microphone, TTS, UI, or character code.
