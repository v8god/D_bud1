import { chooseLocalVoiceResponse } from "../../config/LocalVoiceResponses";
import type { VoiceAgentRequest, VoiceAgentResponse, VoiceConversationAgent } from "./VoiceConversationTypes";

export class LocalDemoVoiceAgent implements VoiceConversationAgent {
  readonly id = "local-response-library";
  readonly label = "Local response library";

  async respond(request: VoiceAgentRequest): Promise<VoiceAgentResponse> {
    await new Promise(resolve => window.setTimeout(resolve, 220));
    const response = chooseLocalVoiceResponse(request.text.trim().toLocaleLowerCase(), request.text);
    return { ...response, source: this.id, audioClipId: response.id };
  }
}
