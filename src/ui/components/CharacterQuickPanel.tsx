import type { KeyboardDetectorStatus } from "../../services/desktop-hooks/GlobalKeyboardActivityMonitor";
import type { MemorySnapshot } from "../../memory/models/MemoryTypes";
import type { BuddyPreferences } from "../../services/preferences/BuddyPreferenceStore";
import type { SaveCustomVoiceProfileInput } from "../../services/voice-manager/CustomVoiceProfileService";
import type {
  CustomVoiceProfile,
  VoiceConversationOptions,
  VoiceConversationSnapshot,
  VoiceGenderHint,
} from "../../services/voice-manager/VoiceConversationTypes";
import type { RadialActionId } from "./CharacterRadialMenu";
import { CustomVoiceProfilePanel } from "./CustomVoiceProfilePanel";
import { VoiceConversationPanel } from "./VoiceConversationPanel";
import { MemoryPanel } from "./MemoryPanel";

interface CharacterQuickPanelProps {
  readonly action: RadialActionId | null;
  readonly preferences: BuddyPreferences;
  readonly characterGender: VoiceGenderHint;
  readonly activeAnimation: string | null;
  readonly activeState: string | null;
  readonly idleStage: string;
  readonly keyboardStatus: KeyboardDetectorStatus;
  readonly voiceSnapshot: VoiceConversationSnapshot;
  readonly voiceOptions: VoiceConversationOptions;
  readonly memorySnapshot: MemorySnapshot;
  readonly onMemorySearch: (query: string) => void;
  readonly onMemoryAdd: (content: string) => Promise<void>;
  readonly onMemoryDelete: (id: string) => Promise<void>;
  readonly onMemoryPin: (id: string, pinned: boolean) => Promise<void>;
  readonly onMemoryClear: (scope: "all" | "turns" | "facts" | "summaries") => Promise<void>;
  readonly onMemoryRefresh: () => Promise<void>;
  readonly onStartListening: () => void;
  readonly onStopListening: () => void;
  readonly onEndContinuous: () => void;
  readonly onCancelVoice: () => void;
  readonly onSubmitVoiceText: (text: string) => void;
  readonly onRepeatVoiceResponse: () => void;
  readonly onSaveCustomVoice: (input: SaveCustomVoiceProfileInput) => Promise<CustomVoiceProfile>;
  readonly onProcessCustomVoice: (id: string) => Promise<void>;
  readonly onDeleteCustomVoice: (id: string) => Promise<void>;
  readonly onRefreshVoiceEngine: () => Promise<void>;
  readonly onStartXttsEngine: () => Promise<void>;
  readonly onStopXttsEngine: () => Promise<void>;
  readonly onStopLocalVoiceEngine: () => Promise<void>;
  readonly onInstallPiperVoice: (id: string) => Promise<void>;
  readonly onPreferencesChange: (next: BuddyPreferences) => void;
  readonly onClose: () => void;
}

export function CharacterQuickPanel(props: CharacterQuickPanelProps) {
  const {
    action, preferences, characterGender, activeAnimation, activeState, idleStage,
    keyboardStatus, voiceSnapshot, voiceOptions, memorySnapshot,
    onMemorySearch, onMemoryAdd, onMemoryDelete, onMemoryPin, onMemoryClear, onMemoryRefresh,
    onStartListening, onStopListening, onEndContinuous, onCancelVoice, onSubmitVoiceText, onRepeatVoiceResponse,
    onSaveCustomVoice, onProcessCustomVoice, onDeleteCustomVoice, onRefreshVoiceEngine,
    onStartXttsEngine, onStopXttsEngine, onStopLocalVoiceEngine,
    onInstallPiperVoice, onPreferencesChange, onClose,
  } = props;
  if (!action || action === "voice") return null;

  const preferredGender = preferences.voiceGenderPreference === "follow-character"
    ? characterGender
    : preferences.voiceGenderPreference;
  const filteredVoices = voiceSnapshot.voices.filter(voice => voice.genderHint === preferredGender);
  const filteredPiper = voiceSnapshot.piperVoices.filter(voice => voice.genderHint === preferredGender);
  const filteredCustom = voiceSnapshot.customVoices.filter(voice => voice.genderHint === preferredGender);

  return (
    <aside className="character-quick-panel" onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
      <header>
        <div><span>DESKTOP BUDDY</span><strong>{panelTitle(action)}</strong></div>
        <button type="button" onClick={onClose} aria-label="Close panel">×</button>
      </header>

      {action === "talk" && (
        <VoiceConversationPanel
          snapshot={voiceSnapshot}
          options={voiceOptions}
          onStartListening={onStartListening}
          onStopListening={onStopListening}
          onEndContinuous={onEndContinuous}
          onCancel={onCancelVoice}
          onSubmitText={onSubmitVoiceText}
          onRepeatResponse={onRepeatVoiceResponse}
          onModeChange={mode => onPreferencesChange({ ...preferences, voiceConversationMode: mode })}
          onSilenceTimeoutChange={voiceSilenceTimeoutMs => onPreferencesChange({ ...preferences, voiceSilenceTimeoutMs })}
          onPushToTalkChange={voicePushToTalkEnabled => onPreferencesChange({ ...preferences, voicePushToTalkEnabled })}
        />
      )}

      {action === "memory" && (
        <MemoryPanel
          mode={preferences.memoryMode}
          snapshot={memorySnapshot}
          onModeChange={memoryMode => onPreferencesChange({ ...preferences, memoryMode })}
          onSearch={onMemorySearch}
          onAdd={onMemoryAdd}
          onDelete={onMemoryDelete}
          onPin={onMemoryPin}
          onClear={onMemoryClear}
          onRefresh={onMemoryRefresh}
        />
      )}

      {action === "tasks" && (
        <div className="quick-panel-content">
          <dl className="quick-status-grid">
            <div><dt>Character</dt><dd>{activeState ?? "neutral"}</dd></div>
            <div><dt>Animation</dt><dd>{activeAnimation ?? "idle"}</dd></div>
            <div><dt>System</dt><dd>{idleStage}</dd></div>
            <div><dt>Agents</dt><dd>none connected</dd></div>
          </dl>
          <p>This becomes the live agent and task view in Phases 8 and Alpha.</p>
        </div>
      )}

      {action === "settings" && (
        <div className="quick-panel-content quick-settings">
          <ToggleRow label="Follow desktop cursor" description="Move the eyes and head toward the global pointer." checked={preferences.cursorTrackingEnabled} onChange={checked => onPreferencesChange({ ...preferences, cursorTrackingEnabled: checked })} />
          <ToggleRow label="React while I type" description="Show the keyboard prop after a real burst of typing." checked={preferences.keyboardReactionsEnabled} onChange={checked => onPreferencesChange({ ...preferences, keyboardReactionsEnabled: checked })} />
          <label className="quick-select-row">
            <span><strong>Typing trigger</strong><small>Changes apply live.</small></span>
            <select value={preferences.typingTriggerKeyCount} onChange={event => onPreferencesChange({ ...preferences, typingTriggerKeyCount: Number(event.target.value) })}>
              <option value={2}>Sensitive — 2 keys</option><option value={4}>Balanced — 4 keys</option><option value={6}>Deliberate — 6 keys</option>
            </select>
          </label>
          <div className="typing-detector-status" aria-live="polite">
            <div><strong>Typing detector</strong><span>{keyboardStatus.typing ? "typing" : keyboardStatus.running ? "listening" : "off"}</span></div>
            <div><small>Burst</small><b>{Math.min(keyboardStatus.burstCount, keyboardStatus.threshold)} / {keyboardStatus.threshold}</b></div>
            <div><small>Backend</small><b>{keyboardStatus.backendRevision ?? "connecting"}</b></div>
          </div>

          <label className="quick-select-row">
            <span><strong>Recognition language</strong><small>Used for transcription and voice selection.</small></span>
            <select value={preferences.voiceLanguage} onChange={event => onPreferencesChange({ ...preferences, voiceLanguage: event.target.value })}>
              <option value="en-IN">English — India</option><option value="en-US">English — US</option><option value="en-GB">English — UK</option><option value="hi-IN">Hindi — India</option>
            </select>
          </label>

          <label className="quick-select-row">
            <span><strong>Voice gender</strong><small>Follow the current model or force female/male.</small></span>
            <select value={preferences.voiceGenderPreference} onChange={event => onPreferencesChange({ ...preferences, voiceGenderPreference: event.target.value as BuddyPreferences["voiceGenderPreference"], voiceURI: null, piperVoiceId: null, customVoiceProfileId: null })}>
              <option value="follow-character">Follow character ({characterGender === "feminine" ? "female" : "male"})</option>
              <option value="feminine">Female</option>
              <option value="masculine">Male</option>
            </select>
          </label>

          <label className="quick-select-row">
            <span><strong>Voice source</strong><small>Choose a live TTS engine or a pre-generated custom clip pack.</small></span>
            <select value={preferences.voiceSource} onChange={event => onPreferencesChange({ ...preferences, voiceSource: event.target.value as BuddyPreferences["voiceSource"] })}>
              <option value="system">Windows system voice</option>
              <option value="piper">Free offline Piper voice</option>
              <option value="gtts">Google online voice (gTTS)</option>
              <option value="voice-pack">Pre-generated custom voice pack</option>
              <option value="custom">Custom cloned voice (XTTS)</option>
            </select>
          </label>

          {preferences.voiceSource === "system" && (
            <label className="quick-select-row">
              <span><strong>{preferredGender === "feminine" ? "Female" : "Male"} system voice</strong><small>Install additional Windows voices if this list is empty.</small></span>
              <select value={preferences.voiceURI ?? ""} onChange={event => onPreferencesChange({ ...preferences, voiceURI: event.target.value || null })}>
                <option value="">Automatically choose matching voice</option>
                {filteredVoices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}
              </select>
            </label>
          )}

          {preferences.voiceSource === "gtts" && (
            <label className="quick-select-row">
              <span><strong>Google online voice accent</strong><small>Uses gTTS/Google Translate speech. Internet required; this is not the Google Assistant voice and does not clone speakers.</small></span>
              <select value={preferences.gttsTld} onChange={event => onPreferencesChange({ ...preferences, gttsTld: event.target.value })}>
                <option value="co.in">English — India</option>
                <option value="us">English — United States</option>
                <option value="co.uk">English — United Kingdom</option>
                <option value="com.au">English — Australia</option>
                <option value="ca">English — Canada</option>
                <option value="com">Automatic/local accent</option>
              </select>
            </label>
          )}

          {preferences.voiceSource === "voice-pack" && (
            <section className="voice-pack-help">
              <strong>Pre-generated custom voice pack</strong>
              <p>Desktop Buddy plays your exported custom-voice clips for fixed local replies. Put the files and manifest in <code>public/assets/voice-packs/custom/</code>. Dynamic replies fall back to gTTS.</p>
              <small>See <code>docs/VOICE_PACK_GUIDE.md</code> for every supported response ID.</small>
            </section>
          )}

          {preferences.voiceSource === "piper" && (
            <section className="piper-voice-list">
              <strong>{preferredGender === "feminine" ? "Female" : "Male"} offline voices</strong>
              {filteredPiper.map(voice => (
                <div key={voice.id} className="piper-voice-row">
                  <label><input type="radio" checked={preferences.piperVoiceId === voice.id} onChange={() => onPreferencesChange({ ...preferences, piperVoiceId: voice.id })} /> {voice.label}</label>
                  {!voice.installed && <button type="button" onClick={() => void onInstallPiperVoice(voice.id)}>Download</button>}
                  {voice.installed && <span>installed</span>}
                </div>
              ))}
              {filteredPiper.length === 0 && <p>Refresh the local voice engine to load Piper voices.</p>}
            </section>
          )}

          {preferences.voiceSource === "custom" && (
            <label className="quick-select-row">
              <span><strong>{preferredGender === "feminine" ? "Female" : "Male"} custom voice</strong><small>XTTS must prepare the profile successfully; there is no silent system fallback.</small></span>
              <select value={preferences.customVoiceProfileId ?? ""} onChange={event => onPreferencesChange({ ...preferences, customVoiceProfileId: event.target.value || null })}>
                <option value="">Choose a prepared custom voice</option>
                {filteredCustom.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.processingState}</option>)}
              </select>
            </label>
          )}

          <label className="quick-select-row"><span><strong>Speech speed</strong><small>Base output speed.</small></span><select value={preferences.voiceRate} onChange={event => onPreferencesChange({ ...preferences, voiceRate: Number(event.target.value) })}><option value={0.8}>Slow</option><option value={1}>Normal</option><option value={1.2}>Fast</option><option value={1.4}>Very fast</option></select></label>
          <label className="quick-select-row"><span><strong>Voice pitch</strong><small>System voices only.</small></span><select value={preferences.voicePitch} onChange={event => onPreferencesChange({ ...preferences, voicePitch: Number(event.target.value) })}><option value={0.8}>Lower</option><option value={1}>Normal</option><option value={1.2}>Higher</option><option value={1.4}>Very high</option></select></label>

          <CustomVoiceProfilePanel
            profiles={voiceSnapshot.customVoices}
            engine={voiceSnapshot.cloneEngine}
            selectedProfileId={preferences.customVoiceProfileId}
            defaultGender={preferredGender}
            onSave={onSaveCustomVoice}
            onProcess={onProcessCustomVoice}
            onDelete={onDeleteCustomVoice}
            onSelect={customVoiceProfileId => onPreferencesChange({ ...preferences, voiceSource: "custom", customVoiceProfileId })}
            onRefreshEngine={onRefreshVoiceEngine}
            onStartXtts={onStartXttsEngine}
            onStopXtts={onStopXttsEngine}
            onStopEngine={onStopLocalVoiceEngine}
          />

          <label className="quick-select-row"><span><strong>Menu auto-close</strong><small>Close unused radial controls.</small></span><select value={preferences.radialMenuAutoCloseMs} onChange={event => onPreferencesChange({ ...preferences, radialMenuAutoCloseMs: Number(event.target.value) })}><option value={5_000}>5 seconds</option><option value={10_000}>10 seconds</option><option value={20_000}>20 seconds</option><option value={60_000}>1 minute</option></select></label>
        </div>
      )}
    </aside>
  );
}

function panelTitle(action: RadialActionId): string {
  switch (action) { case "talk": return "Talk"; case "tasks": return "AI activity"; case "settings": return "Settings"; case "voice": return "Voice"; case "memory": return "Memory"; }
}

function ToggleRow({ label, description, checked, onChange }: { readonly label: string; readonly description: string; readonly checked: boolean; readonly onChange: (checked: boolean) => void }) {
  return <label className="quick-toggle-row"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}
