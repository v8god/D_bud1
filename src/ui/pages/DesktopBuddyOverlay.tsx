import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DesktopBuddyAnimationEngine } from "../../animation/runtime/DesktopBuddyAnimationEngine";
import type { IdleStage } from "../../animation/types/AnimationTypes";
import {
  DesktopWindowService,
  OVERLAY_HEIGHT,
  OVERLAY_WIDTH,
} from "../../app/window/DesktopWindowService";
import { createCharacterSystem } from "../../characters/createCharacterSystem";
import type { CharacterInteractionBounds } from "../../characters/types/CharacterRuntime";
import { GlobalCursorTracker } from "../../services/desktop-hooks/GlobalCursorTracker";
import {
  GlobalKeyboardActivityMonitor,
  type KeyboardDetectorStatus,
} from "../../services/desktop-hooks/GlobalKeyboardActivityMonitor";
import { SystemIdleMonitor } from "../../services/desktop-hooks/SystemIdleMonitor";
import { VoiceConversationController } from "../../services/voice-manager/VoiceConversationController";
import { MemoryAwareVoiceAgent } from "../../memory/agents/MemoryAwareVoiceAgent";
import { MemoryService } from "../../memory/services/MemoryService";
import type { MemorySnapshot } from "../../memory/models/MemoryTypes";
import type {
  VoiceConversationOptions,
  VoiceConversationPhase,
  VoiceConversationSnapshot,
} from "../../services/voice-manager/VoiceConversationTypes";
import {
  loadBuddyPreferences,
  saveBuddyPreferences,
  type BuddyPreferences,
} from "../../services/preferences/BuddyPreferenceStore";
import {
  CharacterRadialMenu,
  type RadialActionId,
} from "../components/CharacterRadialMenu";
import { CharacterQuickPanel } from "../components/CharacterQuickPanel";

const QUICK_STATES = [
  "idle_neutral",
  "happy",
  "typing",
  "celebrate",
  "sleepy",
  "sleep",
] as const;

interface PointerCandidate {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  dragStarted: boolean;
}

interface MenuCenter {
  readonly x: number;
  readonly y: number;
}

const DEFAULT_MENU_CENTER: MenuCenter = { x: OVERLAY_WIDTH / 2, y: OVERLAY_HEIGHT * 0.43 };

export default function DesktopBuddyOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerCandidateRef = useRef<PointerCandidate | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const previousVoicePhaseRef = useRef<VoiceConversationPhase>("idle");
  const pushToTalkStartedRef = useRef(false);
  const pushToTalkReleasePendingRef = useRef(false);
  const characterService = useMemo(() => createCharacterSystem(), []);
  const animationEngine = useMemo(
    () => new DesktopBuddyAnimationEngine(characterService),
    [characterService],
  );
  const idleMonitor = useMemo(() => new SystemIdleMonitor(), []);
  const cursorTracker = useMemo(
    () => new GlobalCursorTracker((x, y) => characterService.setLookTarget(x, y)),
    [characterService],
  );
  const keyboardMonitor = useMemo(() => new GlobalKeyboardActivityMonitor(), []);
  const memoryService = useMemo(() => new MemoryService(), []);
  const memoryAgent = useMemo(() => new MemoryAwareVoiceAgent(memoryService), [memoryService]);
  const voiceController = useMemo(() => new VoiceConversationController(memoryAgent), [memoryAgent]);
  const windowService = useMemo(() => new DesktopWindowService(), []);
  const character = characterService.listCharacters()[0];
  const characterGender = character?.tags?.includes("female") ? "feminine" : "masculine";

  const [ready, setReady] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [passThrough, setPassThrough] = useState(false);
  const [activeState, setActiveState] = useState<string | null>(null);
  const [activeAnimation, setActiveAnimation] = useState<string | null>(null);
  const [idleStage, setIdleStage] = useState<IdleStage>("active");
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<BuddyPreferences>(() => loadBuddyPreferences());
  const [radialOpen, setRadialOpen] = useState(false);
  const [radialCenter, setRadialCenter] = useState<MenuCenter>(DEFAULT_MENU_CENTER);
  const [activeAction, setActiveAction] = useState<RadialActionId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [keyboardStatus, setKeyboardStatus] = useState<KeyboardDetectorStatus>(() =>
    keyboardMonitor.getStatus(),
  );
  const [voiceSnapshot, setVoiceSnapshot] = useState<VoiceConversationSnapshot>(() =>
    voiceController.getSnapshot(),
  );
  const [memorySnapshot, setMemorySnapshot] = useState<MemorySnapshot>(() =>
    memoryService.getSnapshot(),
  );
  const [pushToTalkSessionArmed, setPushToTalkSessionArmed] = useState(false);

  const preferredGender = preferences.voiceGenderPreference === "follow-character"
    ? characterGender
    : preferences.voiceGenderPreference;
  const voiceOptions = useMemo<VoiceConversationOptions>(() => ({
    language: preferences.voiceLanguage,
    voiceEnabled: preferences.voiceEnabled,
    voiceSource: preferences.voiceSource,
    voiceURI: preferences.voiceURI,
    piperVoiceId: preferences.piperVoiceId,
    customVoiceProfileId: preferences.customVoiceProfileId,
    preferredGender,
    rate: preferences.voiceRate,
    pitch: preferences.voicePitch,
    mode: preferences.voiceConversationMode,
    silenceTimeoutMs: preferences.voiceSilenceTimeoutMs,
    pushToTalkEnabled: preferences.voicePushToTalkEnabled,
    memoryMode: preferences.memoryMode,
    gttsTld: preferences.gttsTld,
  }), [
    preferredGender,
    preferences.gttsTld,
    preferences.memoryMode,
    preferences.customVoiceProfileId,
    preferences.piperVoiceId,
    preferences.voiceConversationMode,
    preferences.voiceEnabled,
    preferences.voiceLanguage,
    preferences.voicePitch,
    preferences.voicePushToTalkEnabled,
    preferences.voiceRate,
    preferences.voiceSilenceTimeoutMs,
    preferences.voiceSource,
    preferences.voiceURI,
  ]);
  // Push-to-talk is always a single manual turn, even when the normal Talk
  // panel is configured for continuous conversation. This keeps the global
  // hold-Space gesture predictable and independent of panel state.
  const pushToTalkOptions = useMemo<VoiceConversationOptions>(
    () => ({ ...voiceOptions, mode: "manual" }),
    [voiceOptions],
  );

  useEffect(() => {
    animationEngine.start();

    const readySubscription = characterService.on("character:ready", payload => {
      setReady(true);
      setError(null);
      setActiveState(payload.snapshot.activeState);
      idleMonitor.start(change => {
        setIdleStage(change.stage);
        animationEngine.emit("user:idle-stage-changed", change);
      });
    });
    const stateSubscription = characterService.on("character:state-changed", payload => {
      setActiveState(payload.stateId);
    });
    const errorSubscription = characterService.on("character:error", payload => {
      setError(payload.message);
    });
    const animationStartedSubscription = animationEngine.onScheduler(
      "animation:started",
      payload => setActiveAnimation(payload.request.stateId),
    );
    const animationCompletedSubscription = animationEngine.onScheduler(
      "animation:completed",
      () => setActiveAnimation(null),
    );
    const animationInterruptedSubscription = animationEngine.onScheduler(
      "animation:interrupted",
      () => setActiveAnimation(null),
    );
    const animationErrorSubscription = animationEngine.onScheduler(
      "animation:error",
      payload => setError(payload.message),
    );

    const canvas = canvasRef.current;
    if (canvas && character) {
      void characterService.attach(
        canvas,
        {
          width: OVERLAY_WIDTH,
          height: OVERLAY_HEIGHT,
          backgroundAlpha: 0,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          fitScale: 0.86,
        },
        character.id,
      );
    }

    void cursorTracker.start().catch(caught => {
      setError(caught instanceof Error ? caught.message : String(caught));
    });

    void windowService.initialize().catch(caught => {
      setError(caught instanceof Error ? caught.message : String(caught));
    });

    let unlistenInteraction: (() => void) | null = null;
    let unlistenReset: (() => void) | null = null;

    if (windowService.available) {
      void listen<boolean>("desktop-overlay-interaction", event => {
        const enabled = event.payload;
        setPassThrough(!enabled);
        if (!enabled) closeInteractionUi();
      }).then(unlisten => {
        unlistenInteraction = unlisten;
      }).catch(caught => {
        setError(caught instanceof Error ? caught.message : String(caught));
      });

      void listen("desktop-overlay-position-reset", () => {
        closeInteractionUi();
        setDebugOpen(false);
      }).then(unlisten => {
        unlistenReset = unlisten;
      }).catch(caught => {
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    }

    return () => {
      readySubscription.unsubscribe();
      stateSubscription.unsubscribe();
      errorSubscription.unsubscribe();
      animationStartedSubscription.unsubscribe();
      animationCompletedSubscription.unsubscribe();
      animationInterruptedSubscription.unsubscribe();
      animationErrorSubscription.unsubscribe();
      idleMonitor.stop();
      cursorTracker.dispose();
      keyboardMonitor.stop();
      animationEngine.dispose();
      unlistenInteraction?.();
      unlistenReset?.();
      windowService.dispose();
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      void characterService.dispose();
    };
  }, [
    animationEngine,
    character,
    characterService,
    cursorTracker,
    idleMonitor,
    keyboardMonitor,
    windowService,
  ]);

  useEffect(() => {
    const unsubscribe = voiceController.subscribe(setVoiceSnapshot);
    void voiceController.initialize().catch(caught => {
      setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => {
      unsubscribe();
      voiceController.dispose();
    };
  }, [voiceController]);

  useEffect(() => {
    const unsubscribe = memoryService.subscribe(setMemorySnapshot);
    void memoryService.initialize().catch(caught => {
      setError(caught instanceof Error ? caught.message : String(caught));
    });
    return unsubscribe;
  }, [memoryService]);

  useEffect(() => {
    const phase = voiceSnapshot.phase;
    const previousPhase = previousVoicePhaseRef.current;
    if (phase === previousPhase) return;
    previousVoicePhaseRef.current = phase;

    switch (phase) {
      case "requesting-permission":
      case "listening":
        animationEngine.emit("voice:listening-started", {});
        break;
      case "thinking":
        animationEngine.emit("voice:thinking-started", {});
        break;
      case "speaking":
        animationEngine.emit("voice:speaking-started", {
          amplitude: Math.max(0.45, voiceSnapshot.outputLevel),
          emotion: voiceSnapshot.responseEmotion,
        });
        break;
      case "error":
        animationEngine.emit("voice:conversation-error", {
          message: voiceSnapshot.error ?? undefined,
        });
        break;
      case "idle":
        animationEngine.emit("voice:conversation-stopped", {});
        break;
    }
  }, [
    animationEngine,
    voiceSnapshot.error,
    voiceSnapshot.outputLevel,
    voiceSnapshot.phase,
    voiceSnapshot.responseEmotion,
  ]);

  useEffect(() => {
    const mode = voiceSnapshot.phase === "listening"
      ? "listening"
      : voiceSnapshot.phase === "thinking" || voiceSnapshot.phase === "requesting-permission"
        ? "thinking"
        : voiceSnapshot.phase === "speaking"
          ? "speaking"
          : voiceSnapshot.phase === "error"
            ? "error"
            : "hidden";
    characterService.setVoiceActivity({
      mode,
      level: mode === "listening" ? voiceSnapshot.microphoneLevel : voiceSnapshot.outputLevel,
      continuous: voiceSnapshot.continuousSessionActive,
    });
  }, [
    characterService,
    voiceSnapshot.continuousSessionActive,
    voiceSnapshot.microphoneLevel,
    voiceSnapshot.outputLevel,
    voiceSnapshot.phase,
  ]);

  useEffect(() => {
    if (
      pushToTalkSessionArmed &&
      activeAction !== "talk" &&
      voiceSnapshot.phase === "error" &&
      voiceSnapshot.error
    ) {
      showToast(voiceSnapshot.error);
    }
  }, [activeAction, pushToTalkSessionArmed, voiceSnapshot.error, voiceSnapshot.phase]);

  useEffect(() => {
    if (
      pushToTalkStartedRef.current &&
      voiceSnapshot.phase === "listening" &&
      voiceSnapshot.notice
    ) {
      showToast("Listening now — speak, then release Space");
    }
  }, [voiceSnapshot.notice, voiceSnapshot.phase]);

  useEffect(() => {
    voiceController.setMemoryMode(preferences.memoryMode);
  }, [preferences.memoryMode, voiceController]);

  useEffect(() => {
    saveBuddyPreferences(preferences);
  }, [preferences]);

  useEffect(() => keyboardMonitor.subscribe(setKeyboardStatus), [keyboardMonitor]);

  useEffect(() => {
    const authoredAnimationIsRunning =
      activeAnimation !== null && activeAnimation !== "idle_neutral";
    const pauseTracking =
      activeState === "sleep" || activeState === "sleepy" || authoredAnimationIsRunning;
    cursorTracker.setEnabled(
      ready && preferences.cursorTrackingEnabled && !pauseTracking,
    );
  }, [
    activeAnimation,
    activeState,
    cursorTracker,
    preferences.cursorTrackingEnabled,
    ready,
  ]);

  // Trigger-mode changes are live configuration updates. They must not tear
  // down native polling or emit a false typing-stop event.
  useEffect(() => {
    keyboardMonitor.setTriggerKeyCount(preferences.typingTriggerKeyCount);
  }, [keyboardMonitor, preferences.typingTriggerKeyCount]);

  // The monitor lifecycle depends only on whether the feature can run.
  useEffect(() => {
    if (
      !ready ||
      !preferences.keyboardReactionsEnabled ||
      activeAction === "talk" ||
      voiceSnapshot.phase !== "idle"
    ) {
      keyboardMonitor.stop();
      return;
    }

    keyboardMonitor.start(
      () => animationEngine.emit("user:typing-started", {}),
      () => animationEngine.emit("user:typing-stopped", {}),
    );

    return () => keyboardMonitor.stop();
  }, [
    animationEngine,
    keyboardMonitor,
    preferences.keyboardReactionsEnabled,
    ready,
    activeAction,
    voiceSnapshot.phase,
  ]);

  useEffect(() => {
    if (!radialOpen || activeAction || preferences.radialMenuAutoCloseMs <= 0) return;
    const timeoutId = window.setTimeout(() => {
      setRadialOpen(false);
    }, preferences.radialMenuAutoCloseMs);
    return () => window.clearTimeout(timeoutId);
  }, [activeAction, preferences.radialMenuAutoCloseMs, radialOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        setDebugOpen(open => !open);
        closeInteractionUi();
      } else if (event.key === "Escape") {
        setDebugOpen(false);
        closeInteractionUi();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (
      !pushToTalkSessionArmed ||
      !preferences.voicePushToTalkEnabled ||
      !windowService.available
    ) {
      pushToTalkStartedRef.current = false;
      pushToTalkReleasePendingRef.current = false;
      voiceController.setPushToTalkArmed(false);
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen<string>("desktop-buddy-push-to-talk-space", event => {
      if (disposed) return;
      const state = event.payload;

      if (state === "pressed") {
        voiceController.setPushToTalkArmed(true);
        return;
      }

      if (state === "held") {
        const snapshot = voiceController.getSnapshot();
        if (snapshot.continuousSessionActive) return;
        if (snapshot.phase !== "idle" && snapshot.phase !== "error") return;

        pushToTalkStartedRef.current = true;
        pushToTalkReleasePendingRef.current = false;
        console.info("Desktop Buddy push-to-talk: native Space hold detected; starting microphone.");
        showToast("Starting microphone… speak when the bars turn blue");
        void voiceController.startListening(pushToTalkOptions).catch(caught => {
          pushToTalkStartedRef.current = false;
          pushToTalkReleasePendingRef.current = false;
          const message = caught instanceof Error ? caught.message : String(caught);
          setError(message);
          showToast(message);
        });
        return;
      }

      if (state === "released") {
        voiceController.setPushToTalkArmed(false);
        if (!pushToTalkStartedRef.current) return;

        const phase = voiceController.getSnapshot().phase;
        if (phase === "listening") {
          pushToTalkStartedRef.current = false;
          void voiceController.stopListeningAndProcess(pushToTalkOptions);
          showToast("Processing voice…");
        } else if (phase === "requesting-permission") {
          pushToTalkReleasePendingRef.current = true;
        } else {
          pushToTalkStartedRef.current = false;
        }
      }
    }).then(dispose => {
      unlisten = dispose;
    }).catch(caught => {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      showToast(message);
    });

    return () => {
      disposed = true;
      unlisten?.();
      pushToTalkStartedRef.current = false;
      pushToTalkReleasePendingRef.current = false;
      voiceController.setPushToTalkArmed(false);
    };
  }, [
    pushToTalkSessionArmed,
    preferences.voicePushToTalkEnabled,
    pushToTalkOptions,
    voiceController,
    windowService.available,
  ]);

  useEffect(() => {
    if (!pushToTalkReleasePendingRef.current || voiceSnapshot.phase !== "listening") return;
    pushToTalkReleasePendingRef.current = false;
    pushToTalkStartedRef.current = false;
    void voiceController.stopListeningAndProcess(pushToTalkOptions);
    showToast("Processing voice…");
  }, [pushToTalkOptions, voiceController, voiceSnapshot.phase]);

  const pointHitsCharacter = useCallback((clientX: number, clientY: number): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;

    const bounds = canvas.getBoundingClientRect();
    const localX = ((clientX - bounds.left) / bounds.width) * OVERLAY_WIDTH;
    const localY = ((clientY - bounds.top) / bounds.height) * OVERLAY_HEIGHT;
    const interactionBounds = characterService.getInteractionBounds();

    return containsPoint(interactionBounds, localX, localY);
  }, [characterService]);

  const startNativeDrag = async () => {
    closeInteractionUi();
    animationEngine.emit("character:drag-started", {});
    try {
      await windowService.startDragging();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      pointerCandidateRef.current = null;
      animationEngine.emit("character:drag-ended", { gravityEnabled: false });
    }
  };

  const requestState = (stateId: string) => {
    animationEngine.emit("character:state-requested", {
      stateId,
      source: "phase5-diagnostics",
    });
  };

  const simulateIdleStage = (stage: IdleStage) => {
    const previousStage = idleStage;
    setIdleStage(stage);
    animationEngine.emit("user:idle-stage-changed", {
      stage,
      previousStage,
      idleMs: stage === "sleep" ? 300_000 : stage === "sleepy" ? 120_000 : 0,
    });
  };

  const enablePassThrough = async () => {
    try {
      setDebugOpen(false);
      closeInteractionUi();
      await windowService.setPassThrough(true);
      setPassThrough(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const toggleRadialMenu = () => {
    const willOpen = !radialOpen;
    if (!willOpen) {
      closeInteractionUi();
      return;
    }

    setDebugOpen(false);
    setRadialCenter(calculateMenuCenter(characterService.getInteractionBounds()));
    setActiveAction(null);
    setRadialOpen(true);
  };

  const handleRadialAction = (action: RadialActionId) => {
    if (action === "talk") {
      if (activeAction === "talk") {
        if (!voiceController.getSnapshot().continuousSessionActive) voiceController.cancel();
        setActiveAction(null);
        setRadialOpen(false);
      } else {
        setActiveAction("talk");
      }
      return;
    }

    if (activeAction === "talk") voiceController.cancel();

    if (action === "voice") {
      const enabled = !preferences.voiceEnabled;
      setPreferences(current => ({ ...current, voiceEnabled: enabled }));
      if (!enabled) voiceController.stopSpeaking();
      showToast(enabled ? "Voice output enabled" : "Voice output muted");
      return;
    }

    if (action === "memory") {
      setActiveAction(current => current === "memory" ? null : "memory");
      if (activeAction !== "memory") void memoryService.refresh();
      return;
    }

    setActiveAction(current => current === action ? null : action);
  };

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 2_400);
  };

  function closeInteractionUi() {
    if (!voiceController.getSnapshot().continuousSessionActive) voiceController.cancel();
    setRadialOpen(false);
    setActiveAction(null);
  }

  return (
    <main
      className="desktop-overlay"
      onContextMenu={event => event.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        className="desktop-character-canvas"
        aria-label="Desktop Buddy character"
        onPointerDown={event => {
          if (event.button !== 0 || !pointHitsCharacter(event.clientX, event.clientY)) return;
          pointerCandidateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            dragStarted: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const candidate = pointerCandidateRef.current;
          if (!candidate || candidate.pointerId !== event.pointerId || candidate.dragStarted) return;
          const distance = Math.hypot(
            event.clientX - candidate.startX,
            event.clientY - candidate.startY,
          );
          if ((event.buttons & 1) === 1 && distance >= 7) {
            candidate.dragStarted = true;
            void startNativeDrag();
          }
        }}
        onPointerUp={event => {
          const candidate = pointerCandidateRef.current;
          if (!candidate || candidate.pointerId !== event.pointerId) return;
          pointerCandidateRef.current = null;
          if (!candidate.dragStarted && pointHitsCharacter(event.clientX, event.clientY)) {
            animationEngine.emit("character:clicked", {});
            setPushToTalkSessionArmed(true);
            console.info("Desktop Buddy push-to-talk armed by character click.");
            if (preferences.voicePushToTalkEnabled) {
              showToast("Hold Space to talk is armed");
            }
            toggleRadialMenu();
          }
        }}
        onPointerCancel={() => {
          pointerCandidateRef.current = null;
        }}
        onDoubleClick={event => {
          if (pointHitsCharacter(event.clientX, event.clientY)) {
            closeInteractionUi();
            setDebugOpen(open => !open);
          }
        }}
        onContextMenu={event => {
          if (pointHitsCharacter(event.clientX, event.clientY)) {
            event.preventDefault();
            closeInteractionUi();
            setDebugOpen(open => !open);
          }
        }}
      />

      <CharacterRadialMenu
        open={radialOpen}
        centerX={radialCenter.x}
        centerY={radialCenter.y}
        voiceEnabled={preferences.voiceEnabled}
        memoryMode={preferences.memoryMode}
        activeAction={activeAction}
        onAction={handleRadialAction}
      />

      <CharacterQuickPanel
        action={activeAction}
        preferences={preferences}
        characterGender={characterGender}
        activeAnimation={activeAnimation}
        activeState={activeState}
        idleStage={idleStage}
        keyboardStatus={keyboardStatus}
        voiceSnapshot={voiceSnapshot}
        voiceOptions={voiceOptions}
        memorySnapshot={memorySnapshot}
        onMemorySearch={query => void memoryService.refresh(query)}
        onMemoryAdd={async content => { await memoryService.addManualFact(content); showToast("Memory saved"); }}
        onMemoryDelete={id => memoryService.deleteEntry(id)}
        onMemoryPin={(id, pinned) => memoryService.setPinned(id, pinned)}
        onMemoryClear={scope => memoryService.clear(scope)}
        onMemoryRefresh={() => memoryService.refresh()}
        onStartListening={() => {
          void voiceController.startListening(voiceOptions);
          if (voiceOptions.mode === "continuous") {
            setActiveAction(null);
            setRadialOpen(false);
            showToast("Continuous conversation active");
          }
        }}
        onStopListening={() => void voiceController.stopListeningAndProcess(voiceOptions)}
        onEndContinuous={() => voiceController.endContinuousConversation()}
        onCancelVoice={() => voiceController.cancel()}
        onSubmitVoiceText={text => void voiceController.submitText(text, voiceOptions)}
        onRepeatVoiceResponse={() => void voiceController.repeatResponse(voiceOptions)}
        onSaveCustomVoice={input => voiceController.saveCustomVoiceProfile(input)}
        onProcessCustomVoice={id => voiceController.processCustomVoiceProfile(id)}
        onDeleteCustomVoice={async id => {
          await voiceController.deleteCustomVoiceProfile(id);
          if (preferences.customVoiceProfileId === id) {
            setPreferences(current => ({ ...current, customVoiceProfileId: null, voiceSource: "system" }));
          }
        }}
        onRefreshVoiceEngine={() => voiceController.refreshVoiceEngine()}
        onStartXttsEngine={() => voiceController.enableXttsEngine()}
        onStopXttsEngine={() => voiceController.disableXttsEngine()}
        onStopLocalVoiceEngine={() => voiceController.stopLocalVoiceEngine()}
        onInstallPiperVoice={id => voiceController.installPiperVoice(id)}
        onPreferencesChange={setPreferences}
        onClose={() => closeInteractionUi()}
      />

      {toast && <div className="phase5-toast" role="status">{toast}</div>}

      {!ready && (
        <div className="overlay-status-card">
          {error ? `Character error: ${error}` : "Loading Desktop Buddy…"}
        </div>
      )}

      {debugOpen && (
        <aside className="overlay-debug-panel" onPointerDown={event => event.stopPropagation()}>
          <div className="overlay-debug-heading">
            <div>
              <span>PHASE 7</span>
              <strong>Memory, voice, interaction, and animation diagnostics</strong>
            </div>
            <button type="button" onClick={() => setDebugOpen(false)} aria-label="Close controls">
              ×
            </button>
          </div>

          <div className="overlay-runtime-line">
            <span>state: <b>{activeState ?? "none"}</b></span>
            <span>scheduler: <b>{activeAnimation ?? "idle"}</b></span>
            <span>system: <b>{idleStage}</b></span>
          </div>

          <div className="overlay-debug-states">
            {QUICK_STATES.map(stateId => (
              <button
                type="button"
                key={stateId}
                className={activeState === stateId ? "active" : ""}
                onClick={() => requestState(stateId)}
              >
                {stateId}
              </button>
            ))}
          </div>

          <div className="overlay-debug-states phase4-events">
            <button type="button" onClick={() => animationEngine.emit("character:celebrate", { source: "test" })}>
              Celebration jump
            </button>
            <button type="button" onClick={() => animationEngine.emit("notification:received", { label: "test" })}>
              Notification pop
            </button>
            <button type="button" onClick={() => animationEngine.emit("agent:task-started", { providerLabel: "Test AI" })}>
              AI working
            </button>
            <button type="button" onClick={() => animationEngine.emit("agent:task-completed", { providerLabel: "Test AI", succeeded: true })}>
              AI completed
            </button>
            <button type="button" onClick={() => simulateIdleStage("sleepy")}>
              Simulate sleepy
            </button>
            <button type="button" onClick={() => simulateIdleStage("sleep")}>
              Simulate sleep
            </button>
            <button type="button" onClick={() => simulateIdleStage("active")}>
              Simulate activity
            </button>
            <button type="button" onClick={() => animationEngine.emit("system:low-battery", { percentage: 10 })}>
              Low battery
            </button>
            <button type="button" onClick={() => animationEngine.emit("character:drag-ended", { gravityEnabled: true })}>
              Throw / landing
            </button>
          </div>

          <button
            type="button"
            className="overlay-wide-button"
            onClick={() => void windowService.resetToBottomRight()}
          >
            Reset to monitor corner
          </button>

          <button
            type="button"
            className="overlay-wide-button warning"
            onClick={() => void enablePassThrough()}
          >
            Enable desktop pass-through
          </button>

          <p>
            A short click now triggers the reaction and opens the Phase 6 radial controls. Move at
            least 7 pixels while holding the character to drag it. F2, right-click, or double-click
            opens this diagnostics panel.
          </p>
          {passThrough && <p className="overlay-warning">Pass-through is active.</p>}
          {error && <p className="overlay-error">{error}</p>}
        </aside>
      )}
    </main>
  );
}

function containsPoint(
  bounds: CharacterInteractionBounds | null,
  x: number,
  y: number,
): boolean {
  if (!bounds) return true;
  return (
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height
  );
}

function calculateMenuCenter(bounds: CharacterInteractionBounds | null): MenuCenter {
  if (!bounds) return DEFAULT_MENU_CENTER;

  const x = clamp(bounds.x + bounds.width * 0.5, 145, OVERLAY_WIDTH - 145);
  const y = clamp(bounds.y + bounds.height * 0.42, 145, OVERLAY_HEIGHT - 145);
  return { x, y };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
