import type { VoiceResponseEmotion } from "../services/voice-manager/VoiceConversationTypes";

export interface LocalResponseChoice {
  readonly id?: string;
  readonly text: string;
  readonly emotion: VoiceResponseEmotion;
}

/**
 * Edit this file to change Desktop Buddy's built-in offline replies.
 * These responses do not require Claude, OpenAI, or another agent.
 * Keep `id` stable when using a pre-generated custom voice pack.
 */
export function chooseLocalVoiceResponse(normalized: string, original: string): LocalResponseChoice {
  if (/\b(good morning|morning)\b/.test(normalized)) {
    return { id: "morning", text: "Good morning, Boss. I am awake and ready for you.", emotion: "happy" };
  }
  if (/\b(good afternoon|afternoon)\b/.test(normalized)) {
    return { id: "afternoon", text: "Good afternoon, Boss. Tell me what we are handling next.", emotion: "focused" };
  }
  if (/\b(good evening|evening)\b/.test(normalized)) {
    return { id: "evening", text: "Good evening, Boss. I am right here.", emotion: "loving" };
  }
  if (/\b(hello|hi|hey|namaste)\b/.test(normalized)) {
    return { id: "hello", text: "Hello, Boss. I am listening.", emotion: "happy" };
  }
  if (/\b(time|clock)\b/.test(normalized)) {
    return {
      text: `It is ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date())}.`,
      emotion: "focused",
    };
  }
  if (/\b(date|day|today)\b/.test(normalized)) {
    return {
      text: `Today is ${new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date())}.`,
      emotion: "focused",
    };
  }
  if (/\b(who created you|your creator|who made you)\b/.test(normalized)) {
    return { id: "creator", text: "Pratham created this Desktop Buddy project.", emotion: "proud" };
  }
  if (/\b(your name|who are you|what are you|what can i call you)\b/.test(normalized)) {
    return { id: "identity", text: "I am your Desktop Buddy. You may give me any name you like, Boss.", emotion: "loving" };
  }
  if (/\b(what can you do|help me|features)\b/.test(normalized)) {
    return {
      id: "capabilities",
      text: "I can react to your desktop activity, listen, speak, animate, follow your cursor, and prepare work for connected agents. More tools will arrive in later phases.",
      emotion: "happy",
    };
  }
  if (/\b(thank you|thanks|thank u)\b/.test(normalized)) {
    return { id: "thanks", text: "You are welcome, Boss. I am right here when you need me.", emotion: "loving" };
  }
  if (/\b(i love you|i love u)\b/.test(normalized)) {
    return { id: "love", text: "Aww. I love having you here too, Boss.", emotion: "loving" };
  }
  if (/\b(go to sleep|sleep now|good night)\b/.test(normalized)) {
    return { id: "sleep", text: "All right, Boss. I will quiet down for now.", emotion: "sleepy" };
  }
  if (/\b(wake up|respond|come back)\b/.test(normalized)) {
    return { id: "wake", text: "I am back online, Boss.", emotion: "happy" };
  }
  if (/\b(open youtube|open google|open gmail|search|play\b|song)\b/.test(normalized)) {
    return {
      id: "desktop-action",
      text: "I understood the desktop action you want. I will execute actions like opening sites, searching, and playing music once the desktop-tool agent is connected.",
      emotion: "focused",
    };
  }
  if (/\b(repeat|say that again)\b/.test(normalized)) {
    return { id: "repeat", text: "Of course. Ask me the sentence you want repeated.", emotion: "curious" };
  }

  return {
    text: `I heard: ${original}. I can answer from my local response library now, and a full AI provider can replace it later without changing the voice system.`,
    emotion: "neutral",
  };
}

export function continuousConversationGreeting(): LocalResponseChoice {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return { id: "continuous-morning", text: "Good morning, Boss. Continuous conversation is ready.", emotion: "happy" };
  if (hour >= 12 && hour < 17) return { id: "continuous-afternoon", text: "Good afternoon, Boss. Continuous conversation is ready.", emotion: "focused" };
  if (hour >= 17 && hour < 22) return { id: "continuous-evening", text: "Good evening, Boss. I am ready to listen.", emotion: "loving" };
  return { id: "continuous-night", text: "You are still awake, Boss? I am ready to listen.", emotion: "sleepy" };
}
