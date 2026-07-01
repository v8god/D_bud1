interface RecognitionAlternativeLike {
  readonly transcript: string;
}

interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternativeLike;
}

interface RecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: RecognitionResultLike;
}

interface RecognitionEventLike {
  readonly resultIndex: number;
  readonly results: RecognitionResultListLike;
}

interface RecognitionErrorEventLike {
  readonly error?: string;
  readonly message?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type RecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export interface RecognitionCallbacks {
  readonly onTranscript: (finalText: string, interimText: string) => void;
  readonly onAudioStarted?: () => void;
  readonly onSpeechStarted?: () => void;
  readonly onSpeechEnded?: () => void;
}

export interface RecognitionSession {
  readonly result: Promise<string>;
  stop(): void;
  abort(): void;
}

export class BrowserSpeechRecognitionAdapter {
  private active: SpeechRecognitionLike | null = null;
  private stopRequested = false;

  get available(): boolean {
    return Boolean(this.getConstructor());
  }

  start(language: string, callbacks: RecognitionCallbacks): RecognitionSession {
    if (this.active) {
      throw new Error("Speech recognition is already active");
    }

    const Constructor = this.getConstructor();
    if (!Constructor) {
      throw new Error(
        "Speech recognition is not available in this WebView2 runtime. Use the typed fallback below.",
      );
    }

    const recognition = new Constructor();
    this.active = recognition;
    this.stopRequested = false;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = language;

    let finalTranscript = "";
    let interimTranscript = "";
    let settled = false;
    let resolveResult: (value: string) => void = () => undefined;
    let rejectResult: (reason: Error) => void = () => undefined;

    const cleanup = () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onaudiostart = null;
      recognition.onspeechstart = null;
      recognition.onspeechend = null;
      if (this.active === recognition) this.active = null;
    };

    const settleResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveResult(`${finalTranscript} ${interimTranscript}`.trim());
    };

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectResult(error);
    };

    const result = new Promise<string>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    recognition.onaudiostart = () => callbacks.onAudioStarted?.();
    recognition.onspeechstart = () => callbacks.onSpeechStarted?.();
    recognition.onspeechend = () => callbacks.onSpeechEnded?.();

    recognition.onresult = event => {
      interimTranscript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const recognitionResult = event.results[index];
        const text = recognitionResult?.[0]?.transcript?.trim() ?? "";
        if (!text) continue;
        if (recognitionResult.isFinal) {
          finalTranscript = `${finalTranscript} ${text}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${text}`.trim();
        }
      }
      callbacks.onTranscript(finalTranscript, interimTranscript);
    };

    recognition.onerror = event => {
      const code = event.error ?? "unknown";
      if (code === "aborted" && this.stopRequested) {
        settleResolve();
        return;
      }
      if (code === "no-speech" && this.stopRequested) {
        settleResolve();
        return;
      }
      settleReject(new Error(toRecognitionMessage(code, event.message)));
    };

    recognition.onend = settleResolve;

    try {
      recognition.start();
    } catch (caught) {
      settleReject(caught instanceof Error ? caught : new Error(String(caught)));
    }

    return {
      result,
      stop: () => {
        this.stopRequested = true;
        try {
          recognition.stop();
        } catch {
          settleResolve();
        }
      },
      abort: () => {
        this.stopRequested = true;
        try {
          recognition.abort();
        } catch {
          settleResolve();
        }
      },
    };
  }

  abort(): void {
    this.stopRequested = true;
    try {
      this.active?.abort();
    } catch {
      // The recognizer is already stopped.
    }
    this.active = null;
  }

  private getConstructor(): SpeechRecognitionConstructor | null {
    const candidate = window as RecognitionWindow;
    return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
  }
}

function toRecognitionMessage(code: string, detail?: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone or speech-recognition permission was denied. Allow microphone access and try again.";
    case "audio-capture":
      return "No usable microphone was found.";
    case "network":
      return "The speech-recognition service could not be reached. You can type the message instead.";
    case "no-speech":
      return "I did not hear any speech. Try again or type the message instead.";
    case "language-not-supported":
      return "The selected recognition language is not supported by this speech service.";
    default:
      return detail?.trim() || `Speech recognition failed (${code}).`;
  }
}
