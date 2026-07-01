import type { VoiceDescriptor, VoiceGenderHint } from "./VoiceConversationTypes";

const FEMININE_NAMES = [
  "zira", "heera", "hazel", "susan", "samantha", "victoria", "karen", "moira",
  "ava", "aria", "jenny", "sonia", "natasha", "priyamvada", "lessac", "female",
  "neerja", "swara", "libby", "mia", "emily", "olivia", "sara", "emma",
];

const MASCULINE_NAMES = [
  "david", "mark", "ravi", "george", "daniel", "alex", "guy", "ryan",
  "christopher", "male", "rohan", "pratham", "alan", "aryan", "madhur",
  "liam", "brian", "eric", "tony", "william", "andrew",
];

export function inferVoiceGenderHint(name: string): VoiceGenderHint | null {
  const normalized = name.toLocaleLowerCase();
  if (FEMININE_NAMES.some(token => normalized.includes(token))) return "feminine";
  if (MASCULINE_NAMES.some(token => normalized.includes(token))) return "masculine";
  return null;
}

export function chooseBestSystemVoice(
  voices: readonly VoiceDescriptor[],
  language: string,
  gender: VoiceGenderHint,
  requestedVoiceURI: string | null,
): VoiceDescriptor | null {
  const exact = requestedVoiceURI
    ? voices.find(voice => voice.voiceURI === requestedVoiceURI) ?? null
    : null;
  if (exact?.genderHint === gender) return exact;

  const normalizedLanguage = language.toLocaleLowerCase();
  const languageFamily = normalizedLanguage.split("-")[0];
  return voices.find(voice =>
    voice.genderHint === gender && voice.lang.toLocaleLowerCase() === normalizedLanguage,
  ) ?? voices.find(voice =>
    voice.genderHint === gender && voice.lang.toLocaleLowerCase().startsWith(languageFamily),
  ) ?? voices.find(voice => voice.genderHint === gender) ?? exact;
}
