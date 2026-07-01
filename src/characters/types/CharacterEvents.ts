import type { CharacterCatalog, CharacterManifest } from "./CharacterManifest";
import type { CharacterRuntimeSnapshot } from "./CharacterRuntime";

export interface CharacterEvents {
  "character:loading": { readonly manifest: CharacterManifest };
  "character:ready": {
    readonly manifest: CharacterManifest;
    readonly catalog: CharacterCatalog;
    readonly snapshot: CharacterRuntimeSnapshot;
  };
  "character:switched": {
    readonly previousCharacterId: string | null;
    readonly currentCharacterId: string;
  };
  "character:state-changed": { readonly stateId: string; readonly snapshot: CharacterRuntimeSnapshot };
  "character:expression-changed": {
    readonly expressionId: string;
    readonly snapshot: CharacterRuntimeSnapshot;
  };
  "character:motion-started": {
    readonly group: string;
    readonly index: number;
    readonly snapshot: CharacterRuntimeSnapshot;
  };
  "character:unloaded": { readonly characterId: string | null };
  "character:error": {
    readonly operation: string;
    readonly message: string;
    readonly characterId: string | null;
  };
}
