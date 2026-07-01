export type CharacterEngine = "live2d-cubism";

export interface CharacterStateGroup {
  readonly label: string;
  readonly stateIds: readonly string[];
}

export interface CharacterManifest {
  readonly id: string;
  readonly displayName: string;
  readonly engine: CharacterEngine;
  readonly modelPath: string;
  readonly directorPath?: string;
  readonly defaultState?: string;
  readonly tags?: readonly string[];
  readonly stateGroups?: readonly CharacterStateGroup[];
}

export interface CharacterMountOptions {
  readonly width: number;
  readonly height: number;
  readonly backgroundAlpha?: number;
  readonly resolution?: number;
  readonly fitScale?: number;
}

export interface CharacterRootTransform {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
  readonly rotation: number;
}

export interface MotionDescriptor {
  readonly group: string;
  readonly index: number;
  readonly name: string;
  readonly file: string;
}

export interface CharacterCatalog {
  readonly states: readonly string[];
  readonly expressions: readonly string[];
  readonly motions: readonly MotionDescriptor[];
}

export interface CharacterRuntimeCapabilities {
  readonly expressions: boolean;
  readonly motions: boolean;
  readonly states: boolean;
  readonly lookTarget: boolean;
  readonly lipSync: boolean;
  readonly rootTransform: boolean;
  readonly hotSwap: boolean;
}
