import { useEffect, useState } from "react";
import type {
  VoiceConversationMode,
  VoiceConversationOptions,
  VoiceConversationSnapshot,
} from "../../services/voice-manager/VoiceConversationTypes";

interface VoiceConversationPanelProps {
  readonly snapshot: VoiceConversationSnapshot;
  readonly options: VoiceConversationOptions;
  readonly onStartListening: () => void;
  readonly onStopListening: () => void;
  readonly onEndContinuous: () => void;
  readonly onCancel: () => void;
  readonly onSubmitText: (text: string) => void;
  readonly onRepeatResponse: () => void;
  readonly onModeChange: (mode: VoiceConversationMode) => void;
  readonly onSilenceTimeoutChange: (milliseconds: number) => void;
  readonly onPushToTalkChange: (enabled: boolean) => void;
}

export function VoiceConversationPanel({
  snapshot,
  options,
  onStartListening,
  onStopListening,
  onEndContinuous,
  onCancel,
  onSubmitText,
  onRepeatResponse,
  onModeChange,
  onSilenceTimeoutChange,
  onPushToTalkChange,
}: VoiceConversationPanelProps) {
  const [draft, setDraft] = useState("");
  const displayedTranscript = snapshot.interimTranscript || snapshot.transcript;
  const listening = snapshot.phase === "listening";
  const busy = snapshot.phase !== "idle" && snapshot.phase !== "error";
  const continuous = options.mode === "continuous";

  useEffect(() => {
    if (snapshot.transcript) setDraft("");
  }, [snapshot.transcript]);

  return (
    <div className="quick-panel-content voice-conversation-panel">
      <div className="voice-status-row" data-phase={snapshot.phase}>
        <span className="voice-status-dot" aria-hidden="true" />
        <div>
          <strong>{phaseLabel(snapshot.phase)}</strong>
          <small>{snapshot.agentLabel} agent</small>
        </div>
        <span className="voice-output-badge">
          {options.voiceEnabled ? "voice on" : "muted"}
        </span>
      </div>

      <div className="voice-mode-switch">
        <button type="button" className={!continuous ? "active" : ""} onClick={() => onModeChange("manual")}>
          Manual turn
        </button>
        <button type="button" className={continuous ? "active" : ""} onClick={() => onModeChange("continuous")}>
          Continuous
        </button>
      </div>

      {!continuous && (
        <label className="quick-toggle-row voice-push-to-talk-toggle">
          <span><strong>Hold Space to talk</strong><small>After clicking the character once, hold Space anywhere to listen and release it to process. The Talk panel may be closed.</small></span>
          <input type="checkbox" checked={options.pushToTalkEnabled} onChange={event => onPushToTalkChange(event.target.checked)} />
          <i aria-hidden="true" />
        </label>
      )}

      {continuous && (
        <label className="voice-silence-control">
          <span>Respond after silence</span>
          <select value={options.silenceTimeoutMs} onChange={event => onSilenceTimeoutChange(Number(event.target.value))}>
            <option value={1_000}>1 second</option>
            <option value={1_500}>1.5 seconds</option>
            <option value={2_000}>2 seconds</option>
            <option value={3_000}>3 seconds</option>
            <option value={4_000}>4 seconds</option>
            <option value={5_000}>5 seconds</option>
          </select>
        </label>
      )}

      <div className="voice-level-pair">
        <div>
          <span>Microphone</span>
          <div className="microphone-level" aria-label="Microphone input level">
            <i style={{ width: `${Math.round(snapshot.microphoneLevel * 100)}%` }} />
          </div>
        </div>
        <div className="output">
          <span>Response</span>
          <div className="microphone-level" aria-label="Voice output level">
            <i style={{ width: `${Math.round(snapshot.outputLevel * 100)}%` }} />
          </div>
        </div>
      </div>

      <button
        type="button"
        className={`voice-listen-button ${listening ? "listening" : ""}`}
        onClick={() => {
          if (continuous && snapshot.continuousSessionActive) onEndContinuous();
          else if (listening) onStopListening();
          else onStartListening();
        }}
        disabled={snapshot.phase === "thinking" || snapshot.phase === "speaking" || snapshot.phase === "requesting-permission"}
      >
        <span aria-hidden="true">{listening ? "■" : "●"}</span>
        {continuous
          ? snapshot.continuousSessionActive ? "End continuous conversation" : "Start continuous conversation"
          : options.pushToTalkEnabled
            ? snapshot.pushToTalkArmed ? "Release Space to process" : "Hold Space to talk"
            : listening ? "Stop and process" : "Start listening"}
      </button>

      {!snapshot.recognitionAvailable && (
        <p className="voice-support-warning">
          This WebView does not expose speech recognition. The typed fallback still tests the agent, voice output, and lip-sync path.
        </p>
      )}

      {displayedTranscript && (
        <section className="voice-message-card user">
          <span>You</span>
          <p>{displayedTranscript}</p>
        </section>
      )}

      {snapshot.response && (
        <section className="voice-message-card buddy">
          <span>Desktop Buddy · {snapshot.responseEmotion}</span>
          <p>{snapshot.response}</p>
          {snapshot.synthesisAvailable && options.voiceEnabled && snapshot.phase !== "speaking" && (
            <button type="button" onClick={onRepeatResponse}>Speak again</button>
          )}
        </section>
      )}

      {snapshot.notice && <p className="voice-notice">{snapshot.notice}</p>}
      {snapshot.error && <p className="voice-error">{snapshot.error}</p>}

      <form
        className="voice-typed-fallback"
        onSubmit={event => {
          event.preventDefault();
          const text = draft.trim();
          if (!text) return;
          onSubmitText(text);
        }}
      >
        <input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Type a message instead…"
          aria-label="Typed message"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !draft.trim()}>Send</button>
      </form>

      {busy && !snapshot.continuousSessionActive && (
        <button type="button" className="voice-cancel-button" onClick={onCancel}>
          Cancel conversation
        </button>
      )}

      <p className="voice-privacy-note">
        Microphone audio is used only while listening. Desktop Buddy does not save ordinary conversations. Custom voice references are stored only when you explicitly create a profile.
      </p>
    </div>
  );
}

function phaseLabel(phase: VoiceConversationSnapshot["phase"]): string {
  switch (phase) {
    case "idle": return "Ready to talk";
    case "requesting-permission": return "Requesting microphone";
    case "listening": return "Listening";
    case "thinking": return "Thinking";
    case "speaking": return "Speaking";
    case "error": return "Needs attention";
  }
}
