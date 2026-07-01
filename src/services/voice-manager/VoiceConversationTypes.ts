export type VoiceConversationPhase =
  | "idle"
  | "requesting-permission"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type VoiceConversationMode = "manual" | "continuous";
export type VoiceMemoryMode = "normal" | "private";
export type VoiceOutputSource = "system" | "piper" | "gtts" | "voice-pack" | "custom";
export type VoiceGenderHint = "feminine" | "masculine";
export type VoiceGenderPreference = "follow-character" | VoiceGenderHint;
export type VoiceResponseEmotion =
  | "neutral"
  | "happy"
  | "loving"
  | "curious"
  | "confused"
  | "sad"
  | "sleepy"
  | "surprised"
  | "focused"
  | "proud";

export type CustomVoiceProcessingState =
  | "reference-ready"
  | "processing"
  | "ready"
  | "error";

export interface VoiceDescriptor {
  readonly voiceURI: string;
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
  readonly default: boolean;
  readonly genderHint: VoiceGenderHint | null;
}

export interface PiperVoiceDescriptor {
  readonly id: string;
  readonly label: string;
  readonly language: string;
  readonly genderHint: VoiceGenderHint;
  readonly installed: boolean;
  readonly modelName: string;
  readonly quality: string;
}

export interface CustomVoiceProfile {
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly genderHint: VoiceGenderHint;
  readonly durationSeconds: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly referencePath: string;
  readonly processingState: CustomVoiceProcessingState;
  readonly processingError: string | null;
  readonly engineId: string | null;
}

export interface VoiceCloneEngineStatus {
  readonly available: boolean;
  readonly engineId: string;
  readonly label: string;
  readonly modelLoaded: boolean;
  readonly detail: string;
  readonly dataDir?: string;
  readonly voiceCacheDir?: string;
  readonly device?: string;
  readonly piperAvailable?: boolean;
  readonly gttsAvailable?: boolean;
  readonly xttsEnabled?: boolean;
  readonly engineMode?: "lightweight" | "xtts-enabled";
  readonly piperLoadedVoices?: number;
}

export interface VoiceConversationSnapshot {
  readonly phase: VoiceConversationPhase;
  readonly transcript: string;
  readonly interimTranscript: string;
  readonly response: string;
  readonly responseEmotion: VoiceResponseEmotion;
  readonly error: string | null;
  readonly notice: string | null;
  readonly microphoneLevel: number;
  readonly outputLevel: number;
  readonly recognitionAvailable: boolean;
  readonly synthesisAvailable: boolean;
  readonly agentLabel: string;
  readonly voices: readonly VoiceDescriptor[];
  readonly piperVoices: readonly PiperVoiceDescriptor[];
  readonly customVoices: readonly CustomVoiceProfile[];
  readonly cloneEngine: VoiceCloneEngineStatus;
  readonly continuousSessionActive: boolean;
  readonly pushToTalkArmed: boolean;
}

export interface VoiceConversationOptions {
  readonly language: string;
  readonly voiceEnabled: boolean;
  readonly voiceSource: VoiceOutputSource;
  readonly voiceURI: string | null;
  readonly piperVoiceId: string | null;
  readonly customVoiceProfileId: string | null;
  readonly preferredGender: VoiceGenderHint;
  readonly rate: number;
  readonly pitch: number;
  readonly mode: VoiceConversationMode;
  readonly silenceTimeoutMs: number;
  readonly pushToTalkEnabled: boolean;
  readonly memoryMode: VoiceMemoryMode;
  readonly gttsTld: string;
}

export interface VoiceAgentRequest {
  readonly text: string;
  readonly language: string;
  readonly createdAt: number;
  readonly mode: VoiceConversationMode;
  readonly memoryMode: VoiceMemoryMode;
  readonly sessionId: string;
}

export interface VoiceAgentResponse {
  readonly text: string;
  readonly source: string;
  readonly emotion?: VoiceResponseEmotion;
  readonly audioClipId?: string;
}

export interface VoiceConversationAgent {
  readonly id: string;
  readonly label: string;
  respond(request: VoiceAgentRequest): Promise<VoiceAgentResponse>;
}

export type VoiceConversationListener = (snapshot: VoiceConversationSnapshot) => void;

export interface VoiceActivityVisualState {
  readonly mode: "hidden" | "listening" | "thinking" | "speaking" | "error";
  readonly level: number;
  readonly continuous: boolean;
}
