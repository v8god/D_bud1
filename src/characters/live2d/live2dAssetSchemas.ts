export interface Live2DExpressionReference {
  readonly Name: string;
  readonly File: string;
}

export interface Live2DMotionReference {
  readonly File: string;
  readonly FadeInTime?: number;
  readonly FadeOutTime?: number;
}

export interface Live2DModelSettings {
  readonly FileReferences: {
    readonly Expressions?: readonly Live2DExpressionReference[];
    readonly Motions?: Readonly<Record<string, readonly Live2DMotionReference[]>>;
  };
}

export interface CharacterDirectorState {
  readonly expression?: string;
  readonly motion?: string;
  readonly motionFile?: string;
  readonly loop?: boolean;
  readonly props?: readonly string[];
}

export interface CharacterDirector {
  readonly version: number;
  readonly model: string;
  readonly settings?: {
    readonly defaultIdle?: string;
    readonly gravityMode?: string;
    readonly useExternalProps?: boolean;
  };
  readonly states: Readonly<Record<string, CharacterDirectorState>>;
}
