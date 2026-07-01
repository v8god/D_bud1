import { yachiyoManifest } from "./manifests/yachiyo";
import { CharacterRegistry } from "./registry/CharacterRegistry";
import { CharacterService } from "./services/CharacterService";

export function createCharacterSystem(): CharacterService {
  const registry = new CharacterRegistry();
  registry.register(yachiyoManifest);
  return new CharacterService(registry);
}
