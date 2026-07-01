import { LocalDemoVoiceAgent } from "../../services/voice-manager/LocalDemoVoiceAgent";
import type {
  VoiceAgentRequest,
  VoiceAgentResponse,
  VoiceConversationAgent,
} from "../../services/voice-manager/VoiceConversationTypes";
import type { MemoryEntry } from "../models/MemoryTypes";
import { MemoryService } from "../services/MemoryService";

export class MemoryAwareVoiceAgent implements VoiceConversationAgent {
  readonly id = "memory-aware-local-agent";
  readonly label = "Local responses + persistent memory";
  private readonly delegate = new LocalDemoVoiceAgent();

  constructor(private readonly memory: MemoryService) {}

  async respond(request: VoiceAgentRequest): Promise<VoiceAgentResponse> {
    const text = request.text.trim();
    const normalized = text.toLocaleLowerCase();

    if (request.memoryMode === "normal") {
      await this.memory.recordConversationTurn({
        sessionId: request.sessionId,
        role: "user",
        content: text,
        source: "voice-or-typed-conversation",
        mode: request.memoryMode,
      });
    }

    let response: VoiceAgentResponse;
    if (asksForAllMemory(normalized)) {
      const facts = await this.memory.listFacts(12);
      response = facts.length > 0
        ? {
            text: `Here is what I remember: ${facts.map(formatFactForSpeech).join(" ")}`,
            emotion: "focused",
            source: this.id,
          }
        : {
            text: "I do not have any saved facts about you yet. You can tell me to remember something, or add it from the Memory panel.",
            emotion: "curious",
            source: this.id,
          };
    } else if (asksForSpecificMemory(normalized)) {
      const relevant = (await this.memory.retrieveRelevant(text, 8))
        .filter(item => item.entry.kind === "fact" || item.entry.kind === "summary")
        .slice(0, 5);
      response = relevant.length > 0
        ? {
            text: `Yes. I remember: ${relevant.map(item => formatFactForSpeech(item.entry)).join(" ")}`,
            emotion: "happy",
            source: this.id,
          }
        : {
            text: "I could not find a matching saved memory. You can add one from the Memory panel.",
            emotion: "confused",
            source: this.id,
          };
    } else {
      const base = await this.delegate.respond(request);
      if (!base.audioClipId) {
        const relevant = (await this.memory.retrieveRelevant(text, 6))
          .filter(item => item.entry.kind === "fact")
          .slice(0, 2);
        response = relevant.length > 0
          ? {
              ...base,
              text: `I remember something related: ${formatFactForSpeech(relevant[0].entry)} ${base.text}`,
              source: this.id,
            }
          : { ...base, source: this.id };
      } else {
        response = { ...base, source: this.id };
      }
    }

    if (request.memoryMode === "normal") {
      await this.memory.recordConversationTurn({
        sessionId: request.sessionId,
        role: "assistant",
        content: response.text,
        source: response.source,
        mode: request.memoryMode,
      });
    }

    return response;
  }
}

function asksForAllMemory(normalized: string): boolean {
  return /\b(what do you remember|what do you know about me|show my memories|tell me what you remember)\b/.test(normalized);
}

function asksForSpecificMemory(normalized: string): boolean {
  return /\b(do you remember|what is my|what are my|who am i|my favou?rite|what do i like)\b/.test(normalized);
}

function formatFactForSpeech(entry: MemoryEntry): string {
  return entry.content.replace(/\s+/g, " ").trim();
}
