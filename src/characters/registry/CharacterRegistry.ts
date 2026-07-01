import type { CharacterManifest } from "../types/CharacterManifest";

export class CharacterRegistry {
  private readonly manifests = new Map<string, CharacterManifest>();

  register(manifest: CharacterManifest): void {
    if (this.manifests.has(manifest.id)) {
      throw new Error(`Character '${manifest.id}' is already registered`);
    }
    this.manifests.set(manifest.id, manifest);
  }

  replace(manifest: CharacterManifest): void {
    this.manifests.set(manifest.id, manifest);
  }

  get(characterId: string): CharacterManifest {
    const manifest = this.manifests.get(characterId);
    if (!manifest) {
      throw new Error(`Unknown character '${characterId}'`);
    }
    return manifest;
  }

  list(): readonly CharacterManifest[] {
    return [...this.manifests.values()];
  }

  has(characterId: string): boolean {
    return this.manifests.has(characterId);
  }
}
