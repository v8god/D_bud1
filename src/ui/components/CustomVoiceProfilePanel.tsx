import { useMemo, useRef, useState } from "react";
import type {
  CustomVoiceProfile,
  VoiceCloneEngineStatus,
  VoiceGenderHint,
} from "../../services/voice-manager/VoiceConversationTypes";
import { bytesToBase64, processVoiceSample } from "../../services/voice-manager/VoiceSampleAudioProcessor";
import { VoiceSampleRecorder } from "../../services/voice-manager/VoiceSampleRecorder";
import type { SaveCustomVoiceProfileInput } from "../../services/voice-manager/CustomVoiceProfileService";

interface CustomVoiceProfilePanelProps {
  readonly profiles: readonly CustomVoiceProfile[];
  readonly engine: VoiceCloneEngineStatus;
  readonly selectedProfileId: string | null;
  readonly defaultGender: VoiceGenderHint;
  readonly onSave: (input: SaveCustomVoiceProfileInput) => Promise<CustomVoiceProfile>;
  readonly onProcess: (id: string) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
  readonly onSelect: (id: string) => void;
  readonly onRefreshEngine: () => Promise<void>;
  readonly onStartXtts: () => Promise<void>;
  readonly onStopXtts: () => Promise<void>;
  readonly onStopEngine: () => Promise<void>;
}

export function CustomVoiceProfilePanel({
  profiles,
  engine,
  selectedProfileId,
  defaultGender,
  onSave,
  onProcess,
  onDelete,
  onSelect,
  onRefreshEngine,
  onStartXtts,
  onStopXtts,
  onStopEngine,
}: CustomVoiceProfilePanelProps) {
  const recorder = useMemo(() => new VoiceSampleRecorder(), []);
  const timerRef = useRef<number | null>(null);
  const [name, setName] = useState("My custom voice");
  const [genderHint, setGenderHint] = useState<VoiceGenderHint>(defaultGender);
  const [language, setLanguage] = useState("en-IN");
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const saveBlob = async (blob: Blob) => {
    if (!consent) throw new Error("Confirm that you own this voice or have the speaker's permission.");
    setBusy(true);
    setMessage("Normalizing and storing the reference once…");
    try {
      const processed = await processVoiceSample(blob);
      const id = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const profile = await onSave({
        id,
        name: name.trim() || "Custom voice",
        language,
        genderHint,
        durationSeconds: processed.durationSeconds,
        wavBase64: bytesToBase64(processed.wavBytes),
      });
      onSelect(profile.id);
      setMessage(
        engine.available
          ? "Reference saved. Select Prepare once to cache this voice in the local engine."
          : "Reference saved permanently. Start the optional local voice engine when you want to clone it.",
      );
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    setMessage(null);
    await recorder.start();
    setRecording(true);
    setRecordSeconds(0);
    clearTimer();
    timerRef.current = window.setInterval(() => {
      setRecordSeconds(value => {
        const next = value + 1;
        if (next >= 30) void stopRecording();
        return next;
      });
    }, 1_000);
  };

  const stopRecording = async () => {
    if (!recorder.recording) return;
    clearTimer();
    setRecording(false);
    const blob = await recorder.stop();
    await saveBlob(blob);
  };

  return (
    <section className="custom-voice-manager">
      <div className="custom-voice-heading">
        <div>
          <strong>Custom voice profiles</strong>
          <small>References are saved permanently. XTTS stays off until you explicitly start it.</small>
        </div>
        <button type="button" onClick={() => void onRefreshEngine()} disabled={busy}>
          Refresh status
        </button>
      </div>

      <div className={`voice-engine-status ${engine.available ? "ready" : "offline"}`}>
        <b>{engine.available ? "Local voice service online" : "Local voice service stopped"}</b>
        <span>{engine.detail}</span>
        <small>Mode: {engine.xttsEnabled ? "XTTS enabled" : "lightweight only"}</small>
        <small>Piper voices in memory: {engine.piperLoadedVoices ?? 0}</small>
        {engine.dataDir && <small>Data: {engine.dataDir}</small>}
        {engine.voiceCacheDir && <small>XTTS cache: {engine.voiceCacheDir}</small>}
      </div>

      <div className="custom-voice-capture-actions">
        {!engine.xttsEnabled ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onStartXtts().then(() => setMessage("XTTS enabled. The large model loads only when you press Prepare once or speak with a custom voice.")).catch(error => setMessage(String(error)))}
          >
            Start XTTS (heavy)
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onStopXtts().then(() => setMessage("XTTS unloaded. Piper and gTTS can still use the lightweight service.")).catch(error => setMessage(String(error)))}
          >
            Unload XTTS
          </button>
        )}
        {engine.available && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onStopEngine().then(() => setMessage("Local voice service stopped. It will restart on demand for Piper or gTTS.")).catch(error => setMessage(String(error)))}
          >
            Stop local service
          </button>
        )}
      </div>

      <label className="quick-select-row">
        <span><strong>Profile name</strong><small>Shown in the voice selector.</small></span>
        <input value={name} maxLength={80} onChange={event => setName(event.target.value)} />
      </label>

      <label className="quick-select-row">
        <span><strong>Voice label</strong><small>This label never restricts which character can use it.</small></span>
        <select value={genderHint} onChange={event => setGenderHint(event.target.value as VoiceGenderHint)}>
          <option value="feminine">Feminine</option>
          <option value="masculine">Masculine</option>
        </select>
      </label>

      <label className="quick-select-row">
        <span><strong>Reference language</strong><small>Use the language spoken in the sample.</small></span>
        <select value={language} onChange={event => setLanguage(event.target.value)}>
          <option value="en-IN">English — India</option>
          <option value="en-US">English — United States</option>
          <option value="en-GB">English — United Kingdom</option>
          <option value="hi-IN">Hindi — India</option>
        </select>
      </label>

      <label className="voice-consent-row">
        <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
        <span>I own this voice or have the speaker's clear permission to clone and use it.</span>
      </label>

      <div className="custom-voice-capture-actions">
        <button
          type="button"
          className={recording ? "recording" : ""}
          disabled={busy || !consent}
          onClick={() => void (recording ? stopRecording() : startRecording()).catch(error => setMessage(String(error)))}
        >
          {recording ? `Stop recording (${recordSeconds}s)` : "Record voice sample"}
        </button>
        <label className={`custom-voice-upload ${busy || !consent ? "disabled" : ""}`}>
          Upload audio
          <input
            type="file"
            accept="audio/*"
            disabled={busy || !consent}
            onChange={event => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) void saveBlob(file).catch(error => setMessage(String(error)));
            }}
          />
        </label>
      </div>

      {message && <p className="custom-voice-message">{message}</p>}

      <div className="custom-voice-list">
        {profiles.length === 0 && <p>No custom voice references have been saved yet.</p>}
        {profiles.map(profile => (
          <article key={profile.id} className={selectedProfileId === profile.id ? "selected" : ""}>
            <div>
              <strong>{profile.name}</strong>
              <small>
                {profile.genderHint} · {profile.durationSeconds.toFixed(1)}s · {profile.processingState}
              </small>
              {profile.processingError && <em>{profile.processingError}</em>}
            </div>
            <div>
              <button type="button" onClick={() => onSelect(profile.id)}>Select</button>
              <button
                type="button"
                disabled={profile.processingState === "processing" || !engine.xttsEnabled}
                onClick={() => void onProcess(profile.id).catch(error => setMessage(String(error)))}
              >
                {!engine.xttsEnabled ? "Start XTTS first" : profile.processingState === "ready" ? "Re-prepare" : "Prepare once"}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void onDelete(profile.id).catch(error => setMessage(String(error)))}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
