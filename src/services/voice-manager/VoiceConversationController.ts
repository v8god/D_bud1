import { continuousConversationGreeting } from "../../config/LocalVoiceResponses";
import { BrowserSpeechRecognitionAdapter, type RecognitionSession } from "./BrowserSpeechRecognitionAdapter";
import { BrowserSpeechSynthesisService } from "./BrowserSpeechSynthesisService";
import { CustomVoiceProfileService, type SaveCustomVoiceProfileInput } from "./CustomVoiceProfileService";
import { GTtsSynthesisService } from "./GTtsSynthesisService";
import { LocalDemoVoiceAgent } from "./LocalDemoVoiceAgent";
import { LocalVoiceCloneSynthesisService } from "./LocalVoiceCloneSynthesisService";
import { MicrophoneLevelMonitor } from "./MicrophoneLevelMonitor";
import { PiperVoiceSynthesisService } from "./PiperVoiceSynthesisService";
import { PreGeneratedVoicePackSynthesisService } from "./PreGeneratedVoicePackSynthesisService";
import type {
  CustomVoiceProfile,
  VoiceConversationAgent,
  VoiceConversationListener,
  VoiceConversationOptions,
  VoiceConversationSnapshot,
  VoiceResponseEmotion,
} from "./VoiceConversationTypes";

const EMPTY_SNAPSHOT: VoiceConversationSnapshot = {
  phase: "idle",
  transcript: "",
  interimTranscript: "",
  response: "",
  responseEmotion: "neutral",
  error: null,
  notice: null,
  microphoneLevel: 0,
  outputLevel: 0,
  recognitionAvailable: false,
  synthesisAvailable: false,
  agentLabel: "Local response library",
  voices: [],
  piperVoices: [],
  customVoices: [],
  cloneEngine: {
    available: false,
    engineId: "desktop-buddy-local-voice",
    label: "Desktop Buddy local voice engine",
    modelLoaded: false,
    detail: "The optional local voice engine is not running.",
    piperAvailable: false,
  },
  continuousSessionActive: false,
  pushToTalkArmed: false,
};

const VOICE_ACTIVITY_THRESHOLD = 0.055;
const CONTINUOUS_RESTART_DELAY_MS = 260;
const MIN_READY_CAPTURE_MS = 650;
const RECOGNITION_READY_FALLBACK_MS = 450;

export class VoiceConversationController {
  private readonly recognition = new BrowserSpeechRecognitionAdapter();
  private readonly microphone = new MicrophoneLevelMonitor();
  private readonly systemSynthesis = new BrowserSpeechSynthesisService();
  private readonly customSynthesis = new LocalVoiceCloneSynthesisService();
  private readonly piperSynthesis = new PiperVoiceSynthesisService();
  private readonly gttsSynthesis = new GTtsSynthesisService();
  private readonly voicePackSynthesis = new PreGeneratedVoicePackSynthesisService();
  private readonly profiles = new CustomVoiceProfileService();
  private readonly listeners = new Set<VoiceConversationListener>();
  private snapshot: VoiceConversationSnapshot = EMPTY_SNAPSHOT;
  private operation = 0;
  private disposed = false;
  private lastLevelUpdateAt = 0;
  private activeRecognition: RecognitionSession | null = null;
  private activeRecognitionResult: Promise<string> | null = null;
  private silenceTimer: number | null = null;
  private lastVoiceActivityAt = 0;
  private speechDetected = false;
  private turnClosing = false;
  private continuousRequested = false;
  private continuousGreetingPlayed = false;
  private currentOptions: VoiceConversationOptions | null = null;
  private readonly sessionId = createSessionId();
  private recognitionReadyAt = 0;
  private recognitionReadyTimer: number | null = null;
  private delayedStopTimer: number | null = null;

  constructor(private agent: VoiceConversationAgent = new LocalDemoVoiceAgent()) {}

  getSnapshot(): VoiceConversationSnapshot {
    return this.snapshot;
  }

  subscribe(listener: VoiceConversationListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    const [voices, customVoices, cloneEngine] = await Promise.all([
      this.systemSynthesis.listVoices(),
      this.profiles.list(),
      this.profiles.getEngineStatus({ probeWhenStopped: false }),
    ]);
    let piperVoices = this.snapshot.piperVoices;
    if (cloneEngine.available) {
      try { piperVoices = await this.piperSynthesis.listVoices(); } catch { piperVoices = []; }
    }
    this.update({
      recognitionAvailable: this.recognition.available,
      synthesisAvailable: this.systemSynthesis.available || cloneEngine.available,
      voices,
      piperVoices,
      customVoices,
      cloneEngine,
      agentLabel: this.agent.label,
    });
  }

  setAgent(agent: VoiceConversationAgent): void {
    this.agent = agent;
    this.update({ agentLabel: agent.label });
  }

  async startListening(options: VoiceConversationOptions): Promise<void> {
    if (this.disposed) return;
    const serial = ++this.operation;
    this.cancelResources();
    this.currentOptions = options;
    this.continuousRequested = options.mode === "continuous";
    this.update({
      phase: "requesting-permission",
      transcript: "",
      interimTranscript: "",
      response: "",
      responseEmotion: "neutral",
      error: null,
      notice: null,
      microphoneLevel: 0,
      outputLevel: 0,
      continuousSessionActive: this.continuousRequested,
    });

    if (this.continuousRequested && !this.continuousGreetingPlayed) {
      this.continuousGreetingPlayed = true;
      const greeting = continuousConversationGreeting();
      this.update({ response: greeting.text, responseEmotion: greeting.emotion });
      if (options.voiceEnabled) {
        await this.speak(greeting.text, greeting.emotion, options, serial, true, greeting.id);
      } else {
        await this.beginListeningTurn(options, serial);
      }
      return;
    }

    await this.beginListeningTurn(options, serial);
  }

  async stopListeningAndProcess(options?: VoiceConversationOptions): Promise<void> {
    if (this.snapshot.phase !== "listening" || this.turnClosing) return;
    const resolvedOptions = options ?? this.currentOptions ?? undefined;
    const elapsed = performance.now() - this.recognitionReadyAt;
    const remaining = Math.max(0, MIN_READY_CAPTURE_MS - elapsed);
    if (remaining > 0) {
      if (this.delayedStopTimer !== null) window.clearTimeout(this.delayedStopTimer);
      this.update({ notice: "Finishing the microphone warm-up so the first words are not clipped…" });
      this.delayedStopTimer = window.setTimeout(() => {
        this.delayedStopTimer = null;
        void this.finishCurrentTurn(resolvedOptions);
      }, remaining);
      return;
    }
    await this.finishCurrentTurn(resolvedOptions);
  }

  setPushToTalkArmed(armed: boolean): void {
    this.update({ pushToTalkArmed: armed });
  }

  setMemoryMode(memoryMode: VoiceConversationOptions["memoryMode"]): void {
    if (this.currentOptions) {
      this.currentOptions = { ...this.currentOptions, memoryMode };
    }
  }

  endContinuousConversation(): void {
    this.continuousRequested = false;
    this.continuousGreetingPlayed = false;
    this.cancel();
  }

  async submitText(text: string, options: VoiceConversationOptions): Promise<void> {
    const normalized = text.trim();
    if (!normalized || this.disposed) return;
    const serial = ++this.operation;
    this.cancelResources();
    this.currentOptions = options;
    this.continuousRequested = options.mode === "continuous";
    this.update({ continuousSessionActive: this.continuousRequested });
    await this.processText(normalized, options, serial);
  }

  async repeatResponse(options: VoiceConversationOptions): Promise<void> {
    if (!this.snapshot.response || !options.voiceEnabled) return;
    const serial = ++this.operation;
    this.cancelResources();
    await this.speak(this.snapshot.response, this.snapshot.responseEmotion, options, serial, false);
  }

  async saveCustomVoiceProfile(input: SaveCustomVoiceProfileInput): Promise<CustomVoiceProfile> {
    const profile = await this.profiles.save(input);
    const customVoices = await this.profiles.list();
    this.update({ customVoices });
    return customVoices.find(item => item.id === profile.id) ?? profile;
  }

  async processCustomVoiceProfile(id: string): Promise<void> {
    const profile = this.snapshot.customVoices.find(item => item.id === id);
    if (!profile) throw new Error("Custom voice profile not found.");
    await this.profiles.processWithLocalEngine(profile);
    await this.refreshVoiceEngine();
    this.update({ customVoices: await this.profiles.list() });
  }

  async deleteCustomVoiceProfile(id: string): Promise<void> {
    await this.profiles.remove(id);
    this.update({ customVoices: await this.profiles.list() });
  }

  async startLightweightVoiceEngine(): Promise<void> {
    const cloneEngine = await this.profiles.startLightweightEngine();
    let piperVoices = this.snapshot.piperVoices;
    try { piperVoices = await this.piperSynthesis.listVoices(); } catch { piperVoices = []; }
    this.update({ cloneEngine, piperVoices, synthesisAvailable: true });
  }

  async enableXttsEngine(): Promise<void> {
    const cloneEngine = await this.profiles.enableXtts();
    let piperVoices = this.snapshot.piperVoices;
    try { piperVoices = await this.piperSynthesis.listVoices(); } catch { piperVoices = []; }
    this.update({ cloneEngine, piperVoices, synthesisAvailable: true });
  }

  async disableXttsEngine(): Promise<void> {
    const cloneEngine = await this.profiles.disableXtts();
    this.update({ cloneEngine });
  }

  async stopLocalVoiceEngine(): Promise<void> {
    this.customSynthesis.cancel();
    this.piperSynthesis.cancel();
    this.gttsSynthesis.cancel();
    const cloneEngine = await this.profiles.stopEngine();
    this.update({ cloneEngine, piperVoices: [] });
  }

  async refreshVoiceEngine(): Promise<void> {
    const cloneEngine = await this.profiles.getEngineStatus();
    let piperVoices = this.snapshot.piperVoices;
    if (cloneEngine.available) {
      try { piperVoices = await this.piperSynthesis.listVoices(); } catch { piperVoices = []; }
    }
    this.update({
      cloneEngine,
      piperVoices,
      synthesisAvailable: this.systemSynthesis.available || cloneEngine.available,
    });
  }

  async installPiperVoice(voiceId: string): Promise<void> {
    await this.profiles.ensureEngineRunning();
    const piperVoices = await this.piperSynthesis.installVoice(voiceId);
    this.update({ piperVoices, cloneEngine: await this.profiles.getEngineStatus() });
  }

  cancel(): void {
    ++this.operation;
    this.continuousRequested = false;
    this.continuousGreetingPlayed = false;
    this.currentOptions = null;
    this.cancelResources();
    this.update({
      phase: "idle",
      interimTranscript: "",
      error: null,
      notice: null,
      microphoneLevel: 0,
      outputLevel: 0,
      continuousSessionActive: false,
      pushToTalkArmed: false,
    });
  }

  stopSpeaking(): void {
    if (this.snapshot.phase !== "speaking") return;
    ++this.operation;
    this.continuousRequested = false;
    this.continuousGreetingPlayed = false;
    this.systemSynthesis.cancel();
    this.customSynthesis.cancel();
    this.piperSynthesis.cancel();
    this.gttsSynthesis.cancel();
    this.voicePackSynthesis.cancel();
    this.update({ phase: "idle", outputLevel: 0, continuousSessionActive: false });
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.listeners.clear();
  }

  private async beginListeningTurn(options: VoiceConversationOptions, serial: number): Promise<void> {
    if (serial !== this.operation || this.disposed) return;
    this.turnClosing = false;
    this.speechDetected = false;
    this.lastVoiceActivityAt = performance.now();
    this.clearSilenceTimer();

    try {
      await this.microphone.start(level => this.handleMicrophoneLevel(level, serial, options));
      if (serial !== this.operation) return;
      if (!this.recognition.available) {
        this.microphone.stop();
        this.update({
          phase: "error",
          microphoneLevel: 0,
          error: "Speech recognition is unavailable in this WebView2 runtime. Type your message below.",
        });
        return;
      }

      const markRecognitionReady = () => {
        if (serial !== this.operation || this.snapshot.phase === "listening") return;
        this.recognitionReadyAt = performance.now();
        this.update({
          phase: "listening",
          error: null,
          notice: "Listening now — speak after the bars turn blue.",
        });
      };

      const recognition = this.recognition.start(options.language, {
        onTranscript: (finalText, interimText) => {
          if (serial !== this.operation) return;
          markRecognitionReady();
          if (`${finalText} ${interimText}`.trim()) {
            this.speechDetected = true;
            this.lastVoiceActivityAt = performance.now();
          }
          this.update({ transcript: finalText, interimTranscript: interimText });
        },
        onAudioStarted: markRecognitionReady,
        onSpeechStarted: () => {
          markRecognitionReady();
          this.speechDetected = true;
          this.lastVoiceActivityAt = performance.now();
        },
        onSpeechEnded: () => { this.lastVoiceActivityAt = performance.now(); },
      });

      this.activeRecognition = recognition;
      this.activeRecognitionResult = recognition.result;
      this.update({
        phase: "requesting-permission",
        error: null,
        notice: "Starting microphone… wait for the blue listening bars before speaking.",
      });
      this.recognitionReadyTimer = window.setTimeout(markRecognitionReady, RECOGNITION_READY_FALLBACK_MS);

      if (options.mode === "continuous") {
        this.silenceTimer = window.setInterval(() => {
          if (
            serial === this.operation && !this.turnClosing && this.speechDetected &&
            performance.now() - this.lastVoiceActivityAt >= options.silenceTimeoutMs
          ) void this.finishCurrentTurn(options);
        }, 120);
      }

      void recognition.result.catch(caught => {
        if (serial !== this.operation || this.turnClosing) return;
        this.microphone.stop();
        this.update({ phase: "error", microphoneLevel: 0, error: caught instanceof Error ? caught.message : String(caught) });
      });
    } catch (caught) {
      if (serial !== this.operation) return;
      this.microphone.stop();
      this.update({ phase: "error", microphoneLevel: 0, error: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  private async finishCurrentTurn(options?: VoiceConversationOptions): Promise<void> {
    if (!options || this.turnClosing || !this.activeRecognitionResult) return;
    this.turnClosing = true;
    this.clearSilenceTimer();
    if (this.recognitionReadyTimer !== null) {
      window.clearTimeout(this.recognitionReadyTimer);
      this.recognitionReadyTimer = null;
    }
    const resultPromise = this.activeRecognitionResult;
    this.activeRecognition?.stop();
    try {
      const transcript = await resultPromise;
      const serial = this.operation;
      this.activeRecognition = null;
      this.activeRecognitionResult = null;
      this.microphone.stop();
      this.update({ microphoneLevel: 0, interimTranscript: "" });
      if (!transcript.trim()) {
        this.turnClosing = false;
        if (this.continuousRequested && serial === this.operation) {
          this.update({ phase: "listening", notice: "No complete phrase detected. Listening again…" });
          await delay(CONTINUOUS_RESTART_DELAY_MS);
          await this.beginListeningTurn(options, serial);
        } else {
          this.update({ phase: "error", error: "I did not hear a complete phrase. Try again or type the message below." });
        }
        return;
      }
      await this.processText(transcript, options, serial);
    } catch (caught) {
      this.microphone.stop();
      this.update({ phase: "error", microphoneLevel: 0, error: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      this.turnClosing = false;
    }
  }

  private async processText(text: string, options: VoiceConversationOptions, serial: number): Promise<void> {
    this.update({
      phase: "thinking", transcript: text, interimTranscript: "", response: "",
      responseEmotion: "neutral", error: null, notice: null, microphoneLevel: 0, outputLevel: 0.18,
    });
    try {
      const result = await this.agent.respond({
        text,
        language: options.language,
        createdAt: Date.now(),
        mode: options.mode,
        memoryMode: this.currentOptions?.memoryMode ?? options.memoryMode,
        sessionId: this.sessionId,
      });
      if (serial !== this.operation) return;
      const emotion = result.emotion ?? "neutral";
      this.update({ response: result.text, responseEmotion: emotion });
      if (options.voiceEnabled) await this.speak(result.text, emotion, options, serial, true, result.audioClipId);
      else await this.finishResponseCycle(options, serial);
    } catch (caught) {
      if (serial !== this.operation) return;
      this.update({ phase: "error", outputLevel: 0, error: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  private async speak(
    text: string,
    emotion: VoiceResponseEmotion,
    options: VoiceConversationOptions,
    serial: number,
    restartAfter: boolean,
    audioClipId?: string,
  ): Promise<void> {
    this.update({ phase: "speaking", error: null, notice: null, outputLevel: 0.4 });
    try {
      const level = (value: number) => { if (serial === this.operation) this.update({ outputLevel: value }); };
      if (options.voiceSource === "custom") {
        const profile = options.customVoiceProfileId
          ? this.snapshot.customVoices.find(item => item.id === options.customVoiceProfileId) ?? null
          : null;
        if (!profile) throw new Error("Select a custom voice profile first.");
        if (profile.processingState !== "ready") {
          throw new Error(profile.processingError ?? "This custom voice is not prepared. XTTS preparation requires sufficient RAM.");
        }
        const engine = await this.profiles.getEngineStatus();
        if (!engine.available || !engine.xttsEnabled) {
          throw new Error("XTTS is off. Press Start XTTS (heavy) in Settings before using this cloned voice.");
        }
        await this.customSynthesis.speak(text, profile, options, level);
      } else if (options.voiceSource === "piper") {
        if (!options.piperVoiceId) throw new Error("Select a male or female Piper voice first.");
        await this.profiles.ensureEngineRunning();
        await this.piperSynthesis.speak(text, options.piperVoiceId, options, level);
      } else if (options.voiceSource === "gtts") {
        await this.profiles.ensureEngineRunning();
        await this.gttsSynthesis.speak(text, options, level);
      } else if (options.voiceSource === "voice-pack") {
        if (audioClipId && await this.voicePackSynthesis.hasClip(audioClipId)) {
          await this.voicePackSynthesis.speak(audioClipId, options, level);
        } else {
          this.update({ notice: "This response has no pre-generated custom clip, so gTTS is being used for this dynamic line." });
          await this.profiles.ensureEngineRunning();
          await this.gttsSynthesis.speak(text, options, level);
        }
      } else {
        await this.systemSynthesis.speak(text, options, emotion, level);
      }

      if (serial !== this.operation) return;
      this.update({ outputLevel: 0 });
      if (restartAfter) await this.finishResponseCycle(options, serial);
      else this.update({ phase: "idle" });
    } catch (caught) {
      if (serial !== this.operation) return;
      this.update({ phase: "error", outputLevel: 0, error: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  private async finishResponseCycle(options: VoiceConversationOptions, serial: number): Promise<void> {
    if (this.continuousRequested && options.mode === "continuous" && serial === this.operation) {
      this.update({ phase: "idle", continuousSessionActive: true, notice: "Listening will resume…" });
      await delay(CONTINUOUS_RESTART_DELAY_MS);
      if (serial === this.operation && this.continuousRequested) await this.beginListeningTurn(options, serial);
    } else {
      this.update({ phase: "idle", continuousSessionActive: false });
    }
  }

  private cancelResources(): void {
    this.clearSilenceTimer();
    if (this.recognitionReadyTimer !== null) {
      window.clearTimeout(this.recognitionReadyTimer);
      this.recognitionReadyTimer = null;
    }
    if (this.delayedStopTimer !== null) {
      window.clearTimeout(this.delayedStopTimer);
      this.delayedStopTimer = null;
    }
    this.recognitionReadyAt = 0;
    this.activeRecognition?.abort();
    this.activeRecognition = null;
    this.activeRecognitionResult = null;
    this.recognition.abort();
    this.microphone.stop();
    this.systemSynthesis.cancel();
    this.customSynthesis.cancel();
    this.piperSynthesis.cancel();
    this.gttsSynthesis.cancel();
    this.voicePackSynthesis.cancel();
    this.turnClosing = false;
  }

  private handleMicrophoneLevel(level: number, serial: number, options: VoiceConversationOptions): void {
    if (serial !== this.operation || this.snapshot.phase !== "listening") return;
    const now = performance.now();
    if (level >= VOICE_ACTIVITY_THRESHOLD) {
      this.lastVoiceActivityAt = now;
      if (level >= 0.12) this.speechDetected = true;
    }
    if (now - this.lastLevelUpdateAt < 45 && Math.abs(level - this.snapshot.microphoneLevel) < 0.035) return;
    this.lastLevelUpdateAt = now;
    this.update({ microphoneLevel: level });
    if (
      options.mode === "continuous" && this.speechDetected && !this.turnClosing &&
      now - this.lastVoiceActivityAt >= options.silenceTimeoutMs
    ) void this.finishCurrentTurn(options);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer !== null) {
      window.clearInterval(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private update(next: Partial<VoiceConversationSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

function createSessionId(): string {
  try {
    return `session-${crypto.randomUUID()}`;
  } catch {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}
