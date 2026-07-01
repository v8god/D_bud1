import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createCharacterSystem } from "../../characters/createCharacterSystem";
import type {
  CharacterCatalog,
  CharacterManifest,
  MotionDescriptor,
} from "../../characters/types/CharacterManifest";
import type { CharacterRuntimeSnapshot } from "../../characters/types/CharacterRuntime";

const EMPTY_CATALOG: CharacterCatalog = { states: [], expressions: [], motions: [] };
const INITIAL_SNAPSHOT: CharacterRuntimeSnapshot = {
  characterId: null,
  status: "idle",
  activeState: null,
  activeExpression: null,
  activeMotion: null,
  error: null,
};

export default function CharacterWorkbench() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const service = useMemo(() => createCharacterSystem(), []);
  const characters = service.listCharacters();
  const [selectedCharacterId, setSelectedCharacterId] = useState(characters[0]?.id ?? "");
  const [activeManifest, setActiveManifest] = useState<CharacterManifest | null>(null);
  const [catalog, setCatalog] = useState<CharacterCatalog>(EMPTY_CATALOG);
  const [snapshot, setSnapshot] = useState<CharacterRuntimeSnapshot>(INITIAL_SNAPSHOT);
  const [tab, setTab] = useState<"states" | "expressions" | "motions">("states");
  const [logs, setLogs] = useState<string[]>(["Phase 2 character system initialising…"]);
  const [speaking, setSpeaking] = useState(false);
  const [rootLifted, setRootLifted] = useState(false);

  const log = (message: string) => {
    setLogs(previous => [
      `[${new Date().toLocaleTimeString()}] ${message}`,
      ...previous.slice(0, 59),
    ]);
  };

  useEffect(() => {
    const readySubscription = service.on("character:ready", payload => {
      setActiveManifest(payload.manifest);
      setCatalog(payload.catalog);
      setSnapshot(payload.snapshot);
      log(`✓ ${payload.manifest.displayName} ready through CharacterRuntime`);
    });
    const stateSubscription = service.on("character:state-changed", payload => {
      setSnapshot(payload.snapshot);
      log(`State → ${payload.stateId}`);
    });
    const expressionSubscription = service.on("character:expression-changed", payload => {
      setSnapshot(payload.snapshot);
      log(`Expression → ${payload.expressionId}`);
    });
    const motionSubscription = service.on("character:motion-started", payload => {
      setSnapshot(payload.snapshot);
      log(`Motion → ${payload.group}[${payload.index}]`);
    });
    const errorSubscription = service.on("character:error", payload => {
      setSnapshot(service.getSnapshot());
      log(`✗ ${payload.operation}: ${payload.message}`);
    });

    const canvas = canvasRef.current;
    if (canvas && selectedCharacterId) {
      void service
        .attach(
          canvas,
          { width: 500, height: 600, backgroundAlpha: 0, resolution: 1, fitScale: 0.9 },
          selectedCharacterId,
        )
        .catch(() => undefined);
    }

    return () => {
      readySubscription.unsubscribe();
      stateSubscription.unsubscribe();
      expressionSubscription.unsubscribe();
      motionSubscription.unsubscribe();
      errorSubscription.unsubscribe();
      void service.dispose();
    };
  }, [service]);

  const switchCharacter = async (characterId: string) => {
    setSelectedCharacterId(characterId);
    setSnapshot(previous => ({ ...previous, status: "loading", error: null }));
    try {
      await service.switchCharacter(characterId);
    } catch {
      setSnapshot(service.getSnapshot());
    }
  };

  const playState = async (stateId: string) => {
    try {
      await service.playState(stateId);
    } catch {
      // CharacterService already emitted a useful error event.
    }
  };

  const setExpression = async (expressionId: string) => {
    try {
      await service.setExpression(expressionId);
    } catch {
      // CharacterService already emitted a useful error event.
    }
  };

  const playMotion = async (motion: MotionDescriptor) => {
    try {
      await service.playMotion(motion.group, motion.index);
    } catch {
      // CharacterService already emitted a useful error event.
    }
  };

  const toggleSpeaking = () => {
    const next = !speaking;
    setSpeaking(next);
    service.setSpeaking(next, 0.7);
    log(next ? "Lip-sync test enabled" : "Lip-sync test disabled");
  };

  const toggleRootLift = () => {
    const next = !rootLifted;
    setRootLifted(next);
    service.setRootTransform({ offsetY: next ? -70 : 0, scale: next ? 1.04 : 1 });
    log(next ? "Root transform lifted (future jump layer)" : "Root transform reset");
  };

  const startDrag = async () => {
    try {
      await getCurrentWindow().startDragging();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      log(`Window drag unavailable: ${message}`);
    }
  };

  const stateGroups = activeManifest?.stateGroups ?? [];
  const ungroupedStates = catalog.states.filter(
    stateId => !stateGroups.some(group => group.stateIds.includes(stateId)),
  );
  const motionsByGroup = groupMotions(catalog.motions);

  return (
    <main className="workbench">
      <section className="character-panel">
        <header className="drag-header" onMouseDown={startDrag}>
          <strong>{activeManifest?.displayName ?? "Desktop Buddy"}</strong>
          <span className={`status status-${snapshot.status}`}>{snapshot.status}</span>
        </header>

        <canvas
          ref={canvasRef}
          className="character-canvas"
          onMouseMove={event => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
            const y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
            service.setLookTarget(x, y);
          }}
        />

        <div className="snapshot-line">
          State: <b>{snapshot.activeState ?? "none"}</b>
          <span>Expression: <b>{snapshot.activeExpression ?? "none"}</b></span>
        </div>

        <div className="test-actions">
          <button type="button" onClick={toggleSpeaking} className={speaking ? "active" : ""}>
            {speaking ? "Stop mouth test" : "Test mouth"}
          </button>
          <button type="button" onClick={toggleRootLift} className={rootLifted ? "active" : ""}>
            {rootLifted ? "Reset root" : "Test root lift"}
          </button>
        </div>
      </section>

      <section className="controls-panel">
        <div className="phase-header">
          <div>
            <div className="eyebrow">PHASE 2</div>
            <h1>Character Runtime Workbench</h1>
            <p>UI → CharacterService → CharacterRuntime → Live2D adapter</p>
          </div>
          <label>
            Character
            <select
              value={selectedCharacterId}
              onChange={event => void switchCharacter(event.target.value)}
            >
              {characters.map(character => (
                <option key={character.id} value={character.id}>{character.displayName}</option>
              ))}
            </select>
          </label>
        </div>

        <nav className="tabs" aria-label="Character controls">
          {(["states", "expressions", "motions"] as const).map(tabName => (
            <button
              type="button"
              key={tabName}
              className={tab === tabName ? "active" : ""}
              onClick={() => setTab(tabName)}
            >
              {tabName}
            </button>
          ))}
        </nav>

        <div className="control-scroll">
          {tab === "states" && (
            <>
              {stateGroups.map(group => {
                const available = group.stateIds.filter(stateId => catalog.states.includes(stateId));
                if (available.length === 0) return null;
                return (
                  <ControlGroup key={group.label} label={group.label}>
                    {available.map(stateId => (
                      <ControlButton
                        key={stateId}
                        active={snapshot.activeState === stateId}
                        onClick={() => void playState(stateId)}
                        label={stateId}
                      />
                    ))}
                  </ControlGroup>
                );
              })}
              {ungroupedStates.length > 0 && (
                <ControlGroup label="Other">
                  {ungroupedStates.map(stateId => (
                    <ControlButton
                      key={stateId}
                      active={snapshot.activeState === stateId}
                      onClick={() => void playState(stateId)}
                      label={stateId}
                    />
                  ))}
                </ControlGroup>
              )}
            </>
          )}

          {tab === "expressions" && (
            <ControlGroup label="Raw expressions">
              {catalog.expressions.map(expressionId => (
                <ControlButton
                  key={expressionId}
                  active={snapshot.activeExpression === expressionId}
                  onClick={() => void setExpression(expressionId)}
                  label={expressionId}
                />
              ))}
            </ControlGroup>
          )}

          {tab === "motions" && Object.entries(motionsByGroup).map(([group, motions]) => (
            <ControlGroup key={group} label={group}>
              {motions.map(motion => (
                <ControlButton
                  key={`${motion.group}-${motion.index}`}
                  active={
                    snapshot.activeMotion?.group === motion.group &&
                    snapshot.activeMotion.index === motion.index
                  }
                  onClick={() => void playMotion(motion)}
                  label={motion.name}
                />
              ))}
            </ControlGroup>
          ))}
        </div>

        <div className="runtime-summary">
          <span>Characters: {characters.length}</span>
          <span>States: {catalog.states.length}</span>
          <span>Expressions: {catalog.expressions.length}</span>
          <span>Motions: {catalog.motions.length}</span>
        </div>

        <div className="log-box">
          {logs.map((entry, index) => <div key={`${entry}-${index}`}>{entry}</div>)}
        </div>
      </section>
    </main>
  );
}

interface ControlGroupProps {
  readonly label: string;
  readonly children: React.ReactNode;
}

function ControlGroup({ label, children }: ControlGroupProps) {
  return (
    <section className="control-group">
      <h2>{label}</h2>
      <div className="button-grid">{children}</div>
    </section>
  );
}

interface ControlButtonProps {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}

function ControlButton({ label, active, onClick }: ControlButtonProps) {
  return (
    <button type="button" className={active ? "control-button active" : "control-button"} onClick={onClick}>
      {label}
    </button>
  );
}

function groupMotions(
  motions: readonly MotionDescriptor[],
): Readonly<Record<string, readonly MotionDescriptor[]>> {
  const grouped: Record<string, MotionDescriptor[]> = {};
  for (const motion of motions) {
    (grouped[motion.group] ??= []).push(motion);
  }
  return grouped;
}
