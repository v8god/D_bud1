import type {
  VoiceConversationMode,
  VoiceGenderHint,
  VoiceGenderPreference,
  VoiceOutputSource,
} from "../voice-manager/VoiceConversationTypes";

export type MemoryCaptureMode = "normal" | "private";

export interface BuddyPreferences {
  readonly voiceEnabled: boolean;
  readonly memoryMode: MemoryCaptureMode;
  readonly cursorTrackingEnabled: boolean;
  readonly keyboardReactionsEnabled: boolean;
  readonly typingTriggerKeyCount: number;
  readonly radialMenuAutoCloseMs: number;
  readonly voiceLanguage: string;
  readonly voiceSource: VoiceOutputSource;
  readonly voiceURI: string | null;
  readonly piperVoiceId: string | null;
  readonly customVoiceProfileId: string | null;
  readonly voiceGenderPreference: VoiceGenderPreference;
  readonly voiceRate: number;
  readonly voicePitch: number;
  readonly voiceConversationMode: VoiceConversationMode;
  readonly voiceSilenceTimeoutMs: number;
  readonly voicePushToTalkEnabled: boolean;
  readonly gttsTld: string;
}

const STORAGE_KEY = "desktop-buddy.preferences.v1";

export const DEFAULT_BUDDY_PREFERENCES: BuddyPreferences = {
  voiceEnabled: true,
  memoryMode: "normal",
  cursorTrackingEnabled: true,
  keyboardReactionsEnabled: true,
  typingTriggerKeyCount: 4,
  radialMenuAutoCloseMs: 10_000,
  voiceLanguage: "en-IN",
  voiceSource: "system",
  voiceURI: null,
  piperVoiceId: null,
  customVoiceProfileId: null,
  voiceGenderPreference: "follow-character",
  voiceRate: 1,
  voicePitch: 1,
  voiceConversationMode: "manual",
  voiceSilenceTimeoutMs: 2_000,
  voicePushToTalkEnabled: true,
  gttsTld: "co.in",
};

export function loadBuddyPreferences(): BuddyPreferences {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_BUDDY_PREFERENCES;

  try {
    const parsed = JSON.parse(raw) as Partial<BuddyPreferences> & {
      voiceGenderFilter?: VoiceGenderHint | "all" | "neutral" | "unspecified";
    };
    return sanitizePreferences(parsed);
  } catch {
    return DEFAULT_BUDDY_PREFERENCES;
  }
}

export function saveBuddyPreferences(preferences: BuddyPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

function sanitizePreferences(
  input: Partial<BuddyPreferences> & {
    voiceGenderFilter?: VoiceGenderHint | "all" | "neutral" | "unspecified";
  },
): BuddyPreferences {
  const autoClose = Number(input.radialMenuAutoCloseMs);
  const silenceTimeout = Number(input.voiceSilenceTimeoutMs);
  const legacyGender = input.voiceGenderFilter;
  const requestedGender = input.voiceGenderPreference;
  const voiceGenderPreference: VoiceGenderPreference =
    requestedGender === "feminine" || requestedGender === "masculine" || requestedGender === "follow-character"
      ? requestedGender
      : legacyGender === "masculine"
        ? "masculine"
        : legacyGender === "feminine"
          ? "feminine"
          : "follow-character";

  return {
    voiceEnabled:
      typeof input.voiceEnabled === "boolean"
        ? input.voiceEnabled
        : DEFAULT_BUDDY_PREFERENCES.voiceEnabled,
    memoryMode: input.memoryMode === "private" ? "private" : "normal",
    cursorTrackingEnabled:
      typeof input.cursorTrackingEnabled === "boolean"
        ? input.cursorTrackingEnabled
        : DEFAULT_BUDDY_PREFERENCES.cursorTrackingEnabled,
    keyboardReactionsEnabled:
      typeof input.keyboardReactionsEnabled === "boolean"
        ? input.keyboardReactionsEnabled
        : DEFAULT_BUDDY_PREFERENCES.keyboardReactionsEnabled,
    typingTriggerKeyCount:
      Number.isFinite(Number(input.typingTriggerKeyCount))
        ? Math.min(8, Math.max(2, Math.round(Number(input.typingTriggerKeyCount))))
        : DEFAULT_BUDDY_PREFERENCES.typingTriggerKeyCount,
    radialMenuAutoCloseMs:
      Number.isFinite(autoClose) && autoClose >= 3_000 && autoClose <= 60_000
        ? autoClose
        : DEFAULT_BUDDY_PREFERENCES.radialMenuAutoCloseMs,
    voiceLanguage:
      typeof input.voiceLanguage === "string" && input.voiceLanguage.trim().length > 0
        ? input.voiceLanguage.trim()
        : DEFAULT_BUDDY_PREFERENCES.voiceLanguage,
    voiceSource:
      input.voiceSource === "custom" || input.voiceSource === "piper" || input.voiceSource === "gtts" || input.voiceSource === "voice-pack"
        ? input.voiceSource
        : "system",
    voiceURI:
      typeof input.voiceURI === "string" && input.voiceURI.trim().length > 0
        ? input.voiceURI
        : null,
    piperVoiceId:
      typeof input.piperVoiceId === "string" && input.piperVoiceId.trim().length > 0
        ? input.piperVoiceId
        : null,
    customVoiceProfileId:
      typeof input.customVoiceProfileId === "string" && input.customVoiceProfileId.trim().length > 0
        ? input.customVoiceProfileId
        : null,
    voiceGenderPreference,
    voiceRate: clampNumber(input.voiceRate, 0.5, 1.8, DEFAULT_BUDDY_PREFERENCES.voiceRate),
    voicePitch: clampNumber(input.voicePitch, 0.5, 1.6, DEFAULT_BUDDY_PREFERENCES.voicePitch),
    voiceConversationMode:
      input.voiceConversationMode === "continuous" ? "continuous" : "manual",
    voiceSilenceTimeoutMs:
      Number.isFinite(silenceTimeout) && silenceTimeout >= 800 && silenceTimeout <= 8_000
        ? Math.round(silenceTimeout)
        : DEFAULT_BUDDY_PREFERENCES.voiceSilenceTimeoutMs,
    voicePushToTalkEnabled:
      typeof input.voicePushToTalkEnabled === "boolean"
        ? input.voicePushToTalkEnabled
        : DEFAULT_BUDDY_PREFERENCES.voicePushToTalkEnabled,
    gttsTld:
      typeof input.gttsTld === "string" && input.gttsTld.trim().length > 0
        ? input.gttsTld.trim()
        : DEFAULT_BUDDY_PREFERENCES.gttsTld,
  };
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, numeric))
    : fallback;
}
