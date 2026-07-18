import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useOpenGrade } from "../core/useOpenGrade";
import { getBackendKind, openFileDialog, openImagePath, openLutDialog, readAgentInbox, renderOperations } from "../core/coreBackend";
import { getImageUrl, setImageUrl, subscribeToImageUrl } from "../core/imageState";
import { agentGradePresets, applyCommandBatch } from "../core/commandProtocol";
import type { AgentCommand, CommandBatch } from "../core/commandProtocol";
import { ScopesEditor } from "./ScopesEditor";
import type {
  Command,
  EditorType,
  MaskLayer,
  MaskMode,
  MediaItem,
  Operation,
  OperationType,
} from "../types";

export const editorDefinitions: Record<EditorType, { icon: string; label: string }> = {
  media: { icon: "▦", label: "Media Pool" },
  viewer: { icon: "◉", label: "Viewer" },
  effects: { icon: "✦", label: "Effects Library" },
  stack: { icon: "☷", label: "Operation Stack" },
  mask: { icon: "◌", label: "Layers / Masks" },
  assistant: { icon: "✦", label: "Assistant" },
  scopes: { icon: "⌁", label: "Scopes" },
};

const effects: { type: OperationType; icon: string; group: string; tone: string }[] = [
  { type: "Exposure", icon: "☀", group: "LIGHT", tone: "violet" },
  { type: "BasicAdjustments", icon: "◫", group: "LIGHT", tone: "blue" },
  { type: "WhiteBalance", icon: "◒", group: "COLOR", tone: "orange" },
  { type: "ChannelBalance", icon: "▣", group: "COLOR", tone: "rose" },
  { type: "HueRange", icon: "◎", group: "COLOR", tone: "olive" },
  { type: "Curve", icon: "⌁", group: "TONAL", tone: "violet" },
  { type: "HSV", icon: "◉", group: "COLOR", tone: "teal" },
  { type: "LUT", icon: "▧", group: "LOOK", tone: "blue" },
];

const effectGroups = Array.from(new Set(effects.map((effect) => effect.group)));
const libraryGroups = ["PRESETS", ...effectGroups];

async function applyCommands(dispatch: (command: Command) => Promise<void>, commands: AgentCommand[]) {
  for (const command of commands) {
    if (command.type === "media.openPath") continue;
    await dispatch(command);
  }
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function isAgentCommandBatch(value: unknown): value is CommandBatch {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<CommandBatch>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.description === "string" &&
    item.source === "agent" &&
    Array.isArray(item.commands)
  );
}

function isMediaOpenPathCommand(command: AgentCommand): command is Extract<AgentCommand, { type: "media.openPath" }> {
  return command.type === "media.openPath";
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function mediaFromOpenedImage(result: Awaited<ReturnType<typeof openImagePath>>): MediaItem {
  return {
    id: result.path,
    name: fileNameFromPath(result.path),
    resolution: `${result.info.width} × ${result.info.height}`,
    palette: "warm",
    sourcePath: result.path,
  };
}

export function EditorContent({ type }: { type: EditorType; areaId: string }) {
  switch (type) {
    case "media": return <MediaEditor />;
    case "viewer": return <ViewerEditor />;
    case "effects": return <EffectsEditor />;
    case "stack": return <StackEditor />;
    case "mask": return <MaskEditor />;
    case "assistant": return <AssistantEditor />;
    case "scopes": return <ScopesEditor />;
  }
}

function MediaEditor() {
  const { state, dispatch } = useOpenGrade();
  const backend = getBackendKind();
  const [error, setError] = useState<string | null>(null);
  const mediaItems = backend === "tauri"
    ? state.media.filter((item) => item.sourcePath)
    : state.media;

  async function handleOpen() {
    setError(null);
    try {
      if (backend !== "tauri") return;
      const result = await openFileDialog();
      if (!result) return;
      setImageUrl(result.dataUrl);
      await dispatch({
        type: "media.import",
        item: mediaFromOpenedImage(result),
      });
    } catch (error) {
      setError(`Could not open image: ${messageFromError(error)}`);
    }
  }

  async function selectMedia(item: MediaItem) {
    setError(null);
    try {
      if (backend === "tauri" && item.sourcePath) {
        const result = await openImagePath(item.sourcePath);
        setImageUrl(result.dataUrl);
      }
      await dispatch({ type: "media.select", mediaId: item.id });
    } catch (error) {
      setError(`Could not load image: ${messageFromError(error)}`);
    }
  }

  return (
    <div className="media-editor editor-scroll">
      <div className="editor-toolbar">
        <span>PROJECT MEDIA</span>
        <div>
          <button title="Import media" onClick={handleOpen}>＋</button>
          <button title="List view">☷</button>
        </div>
      </div>
      <div className="media-list">
        {mediaItems.length === 0 ? (
          <div className="empty-message" style={{ padding: "20px 10px" }}>
            {backend === "tauri" ? "Click ＋ to open an image from disk" : "No media imported"}
          </div>
        ) : (
          mediaItems.map((item, index) => (
            <button
              key={item.id}
              className={`media-item ${state.selectedMediaId === item.id ? "selected" : ""}`}
              onClick={() => void selectMedia(item)}
            >
              <span className="media-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="media-copy">
                <strong>{item.name}</strong>
                <small>{item.resolution}</small>
              </span>
              {state.selectedMediaId === item.id && <i className="selection-dot" />}
            </button>
          ))
        )}
      </div>
      {error && <div className="empty-message" role="alert">{error}</div>}
      <button className="import-dropzone" onClick={handleOpen}><span>＋</span>{backend === "tauri" ? "Open from disk" : "Import media"}</button>
    </div>
  );
}

function ViewerEditor() {
  const { state, dispatch } = useOpenGrade();
  const [before, setBefore] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [viewerMode, setViewerMode] = useState<"image" | "mask" | "matte">("image");
  const [viewerZoom, setViewerZoom] = useState(1);
  const backend = getBackendKind();
  const media = state.media.find((item) => item.id === state.selectedMediaId) ?? state.media[0];
  const activeLayer = state.layers.find((layer) => layer.id === state.activeLayerId) ?? state.layers[0];

  const processedUrl = React.useSyncExternalStore(
    subscribeToImageUrl,
    getImageUrl,
    getImageUrl,
  );

  useEffect(() => {
    if (backend !== "tauri" || !media.sourcePath) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRenderError(null);
      setIsRendering(true);
      renderOperations(state.operations, state.layers)
        .then((url) => {
          if (!cancelled && url) setImageUrl(url);
        })
        .catch((error) => {
          if (!cancelled) setRenderError(`Render failed: ${messageFromError(error)}`);
        })
        .finally(() => {
          if (!cancelled) setIsRendering(false);
        });
    }, 240);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [backend, media.sourcePath, state.layers, state.operations]);

  function updateLayer(layerId: string, patch: Partial<Omit<MaskLayer, "id" | "type">>) {
    void dispatch({ type: "layer.updateMask", layerId, patch });
  }

  function beginMaskDrag(
    event: React.PointerEvent<HTMLElement>,
    layer: MaskLayer,
    mode: "move" | "size" | "feather",
  ) {
    event.preventDefault();
    event.stopPropagation();
    void dispatch({ type: "layer.select", layerId: layer.id });
    const canvas = event.currentTarget.closest(".viewer-canvas");
    if (!(canvas instanceof HTMLElement)) return;
    const rect = canvas.getBoundingClientRect();

    const readPoint = (pointerEvent: PointerEvent) => ({
      x: clamp((pointerEvent.clientX - rect.left) / rect.width, -1, 2),
      y: clamp((pointerEvent.clientY - rect.top) / rect.height, -1, 2),
    });

    const handleMove = (pointerEvent: PointerEvent) => {
      const point = readPoint(pointerEvent);
      if (mode === "move") {
        if (layer.shape === "polygon" && layer.points) {
          const dx = point.x - layer.x;
          const dy = point.y - layer.y;
          updateLayer(layer.id, {
            x: point.x,
            y: point.y,
            points: layer.points.map((item) => ({ x: item.x + dx, y: item.y + dy })),
          });
          return;
        }
        updateLayer(layer.id, { x: point.x, y: point.y });
        return;
      }
      if (mode === "size") {
        updateLayer(layer.id, {
          width: clamp(Math.abs(point.x - layer.x) * 2, 0.05, 3),
          height: clamp(Math.abs(point.y - layer.y) * 2, 0.05, 3),
        });
        return;
      }
      const rx = Math.max(layer.width / 2, 0.001);
      const ry = Math.max(layer.height / 2, 0.001);
      const dx = (point.x - layer.x) / rx;
      const dy = (point.y - layer.y) / ry;
      const distance = Math.sqrt(dx * dx + dy * dy);
      updateLayer(layer.id, { feather: clamp(1 - distance, 0, 0.95) });
    };

    const stop = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop);
  }

  function beginMaskPointDrag(event: React.PointerEvent<HTMLElement>, layer: MaskLayer, pointIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    void dispatch({ type: "layer.select", layerId: layer.id });
    const canvas = event.currentTarget.closest(".viewer-canvas");
    if (!(canvas instanceof HTMLElement)) return;
    const rect = canvas.getBoundingClientRect();

    const movePoint = (pointerEvent: PointerEvent) => {
      const points = layer.points ?? [];
      const nextPoints = points.map((point, index) => (
        index === pointIndex
          ? {
              x: clamp((pointerEvent.clientX - rect.left) / rect.width, -1, 2),
              y: clamp((pointerEvent.clientY - rect.top) / rect.height, -1, 2),
            }
          : point
      ));
      updateLayer(layer.id, { points: nextPoints });
    };

    const stop = () => {
      window.removeEventListener("pointermove", movePoint);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", movePoint);
    window.addEventListener("pointerup", stop);
  }

  return (
    <div className="viewer-editor">
      <div className="viewer-toolbar">
        <div><span className="viewer-file">{media.name}</span><span>{Math.round(viewerZoom * 100)}%</span></div>
        <div>
          <button onClick={() => setViewerZoom((value) => clamp(value - 0.25, 0.25, 1.5))} title="Zoom out">−</button>
          <button onClick={() => setViewerZoom(1)} title="Fit to viewer">FIT</button>
          <button onClick={() => setViewerZoom((value) => clamp(value + 0.25, 0.25, 1.5))} title="Zoom in">＋</button>
          <button className={viewerMode === "image" ? "active" : ""} onClick={() => setViewerMode("image")} title="Image view">IMG</button>
          <button className={viewerMode === "mask" ? "active" : ""} onClick={() => setViewerMode("mask")} title="Edit selected mask">MSK</button>
          <button className={viewerMode === "matte" ? "active" : ""} onClick={() => setViewerMode("matte")} title="Black and white mask matte">MAT</button>
          <button className={before ? "active" : ""} onClick={() => setBefore((value) => !value)} title="Before / After">◐</button>
          <button title="Fit">⌗</button>
          <button title="Viewer options">•••</button>
        </div>
      </div>
      <div className="viewer-stage">
        <div className="viewer-canvas" style={{ width: `${viewerZoom * 100}%` }}>
          {processedUrl ? (
            <img src={processedUrl} alt="" className="viewer-image" />
          ) : (
            <div className={`viewer-image palette-${media.palette} ${before ? "before" : ""}`}>
              <div className="image-badge">{before ? "BEFORE" : "GRADED"}</div>
              <div className="subject-shape"><i /><i /></div>
              <div className="focus-frame"><i /><i /><i /><i /></div>
            </div>
          )}
          {viewerMode === "matte" && activeLayer && <MaskMatte layer={activeLayer} />}
          {viewerMode === "mask" && state.layers.map((layer) => (
            <MaskOverlay
              key={layer.id}
              layer={layer}
              active={layer.id === state.activeLayerId}
              onPointerDown={beginMaskDrag}
              onPointPointerDown={beginMaskPointDrag}
            />
          ))}
        </div>
        {isRendering && <div className="image-badge render-badge">RENDERING</div>}
        {renderError && <div className="empty-message" role="alert">{renderError}</div>}
      </div>
      <div className="viewer-transport">
        <div className="rgb-readout"><i>R 183</i><i>G 157</i><i>B 141</i></div>
        <div className="transport-buttons"><button>│◀</button><button>◀</button><button className="play">▶</button><button>▶</button><button>▶│</button></div>
        <span className="timecode">00:00:00:01</span>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function maskGradient(layer: MaskLayer) {
  if (layer.shape === "polygon") {
    return "none";
  }
  if (layer.shape === "linear") {
    const feather = clamp(layer.feather, 0, 0.95);
    const soft = clamp(feather * 45, 2, 45);
    const center = 50;
    const start = clamp(center - soft, 0, 100);
    const end = clamp(center + soft, 0, 100);
    const angle = layer.angle ?? 0;
    return `linear-gradient(${angle}deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) ${start}%, rgba(255,255,255,${layer.opacity}) ${end}%, rgba(255,255,255,${layer.opacity}) 100%)`;
  }
  if (layer.shape === "rectangle") {
    const halfW = layer.width * 50;
    const halfH = layer.height * 50;
    const left = layer.x * 100 - halfW;
    const right = layer.x * 100 + halfW;
    const top = layer.y * 100 - halfH;
    const bottom = layer.y * 100 + halfH;
    const feather = clamp(layer.feather * 50, 0, 48);
    return `
      linear-gradient(90deg, rgba(255,255,255,0) ${left - feather}%, rgba(255,255,255,${layer.opacity}) ${left}%, rgba(255,255,255,${layer.opacity}) ${right}%, rgba(255,255,255,0) ${right + feather}%),
      linear-gradient(0deg, rgba(255,255,255,0) ${100 - bottom - feather}%, rgba(255,255,255,${layer.opacity}) ${100 - bottom}%, rgba(255,255,255,${layer.opacity}) ${100 - top}%, rgba(255,255,255,0) ${100 - top + feather}%)
    `;
  }
  const inner = clamp((1 - layer.feather) * 100, 0, 100);
  const outer = 100;
  return `radial-gradient(ellipse ${layer.width * 50}% ${layer.height * 50}% at ${layer.x * 100}% ${layer.y * 100}%, rgba(255,255,255,${layer.opacity}) 0%, rgba(255,255,255,${layer.opacity}) ${inner}%, rgba(255,255,255,0) ${outer}%)`;
}

function MaskMatte({ layer }: { layer: MaskLayer }) {
  if (layer.shape === "polygon" && layer.points && layer.points.length >= 3) {
    const points = layer.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
    return (
      <svg className="mask-matte mask-polygon-matte" viewBox="0 0 100 100" preserveAspectRatio="none">
        <rect width="100" height="100" fill="black" />
        <polygon points={points} fill={`rgba(255,255,255,${layer.opacity})`} />
      </svg>
    );
  }
  return <div className="mask-matte" style={{ backgroundImage: maskGradient(layer) }} />;
}

function MaskOverlay({
  layer,
  active,
  onPointerDown,
  onPointPointerDown,
}: {
  layer: MaskLayer;
  active?: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLElement>, layer: MaskLayer, mode: "move" | "size" | "feather") => void;
  onPointPointerDown: (event: React.PointerEvent<HTMLElement>, layer: MaskLayer, pointIndex: number) => void;
}) {
  if (layer.shape === "polygon") {
    const points = layer.points ?? [];
    const svgPoints = points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
    return (
      <div className={`mask-overlay ${active ? "active" : ""} shape-polygon`}>
        <svg className="mask-polygon-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
          {points.length >= 3 && <polygon className="mask-polygon-fill" points={svgPoints} />}
          {points.length >= 2 && <polyline className="mask-polygon-line" points={svgPoints} />}
        </svg>
        <button
          className="mask-polygon-move"
          style={{ left: `${layer.x * 100}%`, top: `${layer.y * 100}%` }}
          onPointerDown={active ? (event) => onPointerDown(event, layer, "move") : undefined}
          title="Move polygon mask"
        />
        {active && points.map((point, index) => (
          <button
            className="mask-point-handle"
            key={index}
            onPointerDown={(event) => onPointPointerDown(event, layer, index)}
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
            title={`Move point ${index + 1}`}
          />
        ))}
      </div>
    );
  }

  const style = {
    left: `${layer.x * 100}%`,
    top: `${layer.y * 100}%`,
    width: `${layer.width * 100}%`,
    height: `${layer.height * 100}%`,
    transform: layer.shape === "linear"
      ? `translate(-50%, -50%) rotate(${layer.angle ?? 0}deg)`
      : "translate(-50%, -50%)",
  };

  return (
    <div className={`mask-overlay ${active ? "active" : ""} shape-${layer.shape}`}>
      <div className="mask-overlay-fill" style={{ backgroundImage: maskGradient(layer) }} />
      <div
        className="mask-overlay-frame"
        style={style}
        onPointerDown={active ? (event) => onPointerDown(event, layer, "move") : undefined}
      >
        {active && (
          <>
            <button className="mask-handle size" onPointerDown={(event) => onPointerDown(event, layer, "size")} title="Resize mask" />
            <button className="mask-handle feather" onPointerDown={(event) => onPointerDown(event, layer, "feather")} title="Adjust feather" />
          </>
        )}
      </div>
    </div>
  );
}

function EffectsEditor() {
  const { dispatch } = useOpenGrade();
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    PRESETS: true,
    LIGHT: true,
    COLOR: true,
    TONAL: true,
    LOOK: true,
  });
  const query = search.trim().toLowerCase();
  const filteredPresets = agentGradePresets.filter((preset) => (
    `${preset.title} ${preset.description}`.toLowerCase().includes(query)
  ));
  const filteredEffects = effects.filter((effect) => (
    `${effect.type} ${effect.group}`.toLowerCase().includes(query)
  ));

  function toggleGroup(group: string) {
    setOpenGroups((current) => ({ ...current, [group]: !current[group] }));
  }

  function addPreset(presetId: string) {
    const preset = agentGradePresets.find((item) => item.id === presetId);
    if (!preset) return;
    void applyCommands(dispatch, preset.commands);
  }

  return (
    <div className="effects-editor">
      <div className="effects-topline">
        <label className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search effects and presets" /></label>
        <span>Drag or double-click to add</span>
      </div>
      <div className="effect-library editor-scroll">
        {libraryGroups.map((group) => {
          const groupEffects = filteredEffects.filter((effect) => effect.group === group);
          const groupPresets = group === "PRESETS" ? filteredPresets : [];
          const hasItems = groupEffects.length > 0 || groupPresets.length > 0;
          if (!hasItems && query) return null;
          return (
            <section className="effect-section" key={group}>
              <button className="effect-section-header" onClick={() => toggleGroup(group)}>
                <span>{group}</span>
                <i>{openGroups[group] ? "−" : "＋"}</i>
              </button>
              {openGroups[group] && (
                <div className="effects-grid">
                  {groupPresets.map((preset) => (
                    <button
                      key={preset.id}
                      className="effect-card preset-card"
                      draggable
                      data-preset={preset.id}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("application/opengrade-preset", preset.id);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      onDoubleClick={() => addPreset(preset.id)}
                    >
                      <span className="effect-icon preset">▥</span>
                      <strong>{preset.title}</strong>
                      <small>{preset.commands.length} EFFECTS</small>
                    </button>
                  ))}
                  {groupEffects.map((effect) => (
                    <button
                      key={effect.type}
                      className="effect-card"
                      draggable
                      data-effect={effect.type}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("application/opengrade-effect", effect.type);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      onDoubleClick={() => dispatch({ type: "operation.add", operationType: effect.type })}
                    >
                      <span className={`effect-icon ${effect.tone}`}>{effect.icon}</span>
                      <strong>{effect.type}</strong>
                      <small>{effect.group}</small>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {!filteredEffects.length && !filteredPresets.length && <div className="empty-message">No matching effects or presets</div>}
      </div>
    </div>
  );
}

function StackEditor() {
  const { state, dispatch } = useOpenGrade();
  const [dropActive, setDropActive] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState(libraryGroups[0]);
  const activeEffects = effects.filter((effect) => effect.group === activeGroup);
  const activePresets = activeGroup === "PRESETS" ? agentGradePresets : [];

  function addEffect(type: OperationType) {
    void dispatch({ type: "operation.add", operationType: type });
    setAddMenuOpen(false);
  }

  function addPreset(presetId: string) {
    const preset = agentGradePresets.find((item) => item.id === presetId);
    if (!preset) return;
    void applyCommands(dispatch, preset.commands);
    setAddMenuOpen(false);
  }

  return (
    <div
      className={`stack-editor editor-scroll ${dropActive ? "drop-active" : ""}`}
      onDragOver={(event) => {
        if (
          event.dataTransfer.types.includes("application/opengrade-effect")
          || event.dataTransfer.types.includes("application/opengrade-preset")
        ) {
          event.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => {
        setDropActive(false);
        const type = event.dataTransfer.getData("application/opengrade-effect") as OperationType;
        const presetId = event.dataTransfer.getData("application/opengrade-preset");
        if (type) dispatch({ type: "operation.add", operationType: type });
        if (presetId) {
          const preset = agentGradePresets.find((item) => item.id === presetId);
          if (preset) void applyCommands(dispatch, preset.commands);
        }
      }}
    >
      <div className="stack-intro">
        <span>{state.operations.length} OPERATIONS</span>
        <div className="add-effect-wrap">
          <button onClick={() => setAddMenuOpen((value) => !value)}>＋ Add</button>
          {addMenuOpen && (
            <div className="add-effect-menu" onMouseLeave={() => setActiveGroup(libraryGroups[0])}>
              <div className="add-effect-groups">
                {libraryGroups.map((group) => (
                  <button
                    className={activeGroup === group ? "active" : ""}
                    key={group}
                    onMouseEnter={() => setActiveGroup(group)}
                    onFocus={() => setActiveGroup(group)}
                  >
                    {group}
                    <span>›</span>
                  </button>
                ))}
              </div>
              <div className="add-effect-items">
                {activePresets.map((preset) => (
                  <button key={preset.id} onClick={() => addPreset(preset.id)}>
                    <span className="effect-icon preset">▥</span>
                    <strong>{preset.title}</strong>
                    <small>{preset.commands.length}</small>
                  </button>
                ))}
                {activeEffects.map((effect) => (
                  <button key={effect.type} onClick={() => addEffect(effect.type)}>
                    <span className={`effect-icon ${effect.tone}`}>{effect.icon}</span>
                    <strong>{effect.type}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="operation-list">
        {state.operations.length ? (
          state.operations.map((operation) => (
            <OperationCard key={operation.id} operation={operation} />
          ))
        ) : (
          <div className="stack-empty">Add an effect to start grading</div>
        )}
      </div>
      {dropActive && <div className="effect-drop-overlay">Drop to add operation</div>}
    </div>
  );
}

function rangeFor(key: string): [number, number, number, string] {
  if (["Blend", "Opacity", "Intensity"].includes(key)) return [0, 100, 1, "%"];
  if (key === "Temperature") return [-2000, 2000, 10, "K"];
  if (key === "Tint") return [-100, 100, 1, ""];
  if (key === "Exposure") return [-3, 3, 0.05, ""];
  if (key === "Feather") return [0, 180, 1, "°"];
  if (key === "Center") return [0, 360, 1, "°"];
  if (key === "Range") return [1, 180, 1, "°"];
  if (key === "Hue") return [-180, 180, 1, "°"];
  if (["Saturation", "Value", "Contrast", "Shadows", "Highlights", "Whites", "Blacks", "Red", "Green", "Blue"].includes(key)) return [-100, 100, 1, "%"];
  return [-100, 100, 1, ""];
}

function formatValue(key: string, value: number, unit: string) {
  if (key === "Exposure") return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
  if (["Temperature", "Tint", "Hue", "Saturation", "Value", "Contrast", "Shadows", "Highlights", "Whites", "Blacks", "Red", "Green", "Blue"].includes(key)) {
    return `${value > 0 ? "+" : ""}${value}${unit}`;
  }
  return `${value}${unit}`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function circularHueDistance(a: number, b: number) {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

function hueSelectionSegments(center: number, width: number) {
  const half = width / 2;
  const start = (center - half + 360) % 360;
  const end = (center + half + 360) % 360;
  if (width >= 360) return [{ start: 0, end: 360 }];
  if (start <= end) return [{ start, end }];
  return [
    { start: 0, end },
    { start, end: 360 },
  ];
}

type CurvePoint = {
  index: number;
  x: number;
  y: number;
};

type CurveChannel = "Master" | "Red" | "Green" | "Blue";

const curveChannels: CurveChannel[] = ["Master", "Red", "Green", "Blue"];

const defaultCurvePoints: CurvePoint[] = [
  { index: 0, x: 0, y: 0 },
  { index: 1, x: 0.25, y: 0.22 },
  { index: 2, x: 0.5, y: 0.5 },
  { index: 3, x: 0.75, y: 0.82 },
  { index: 4, x: 1, y: 1 },
];

function curvePrefix(channel: CurveChannel) {
  return channel === "Master" ? "" : channel;
}

function curvePointKey(channel: CurveChannel, index: number, axis: "X" | "Y") {
  return `${curvePrefix(channel)}Point${index}${axis}`;
}

function curvePointsFromValues(values: Record<string, number>, channel: CurveChannel): CurvePoint[] {
  const prefix = curvePrefix(channel);
  const hasChannelPoints = `${prefix}Point0X` in values;
  if (!hasChannelPoints) {
    return channel === "Master"
      ? defaultCurvePoints
      : [
          { index: 0, x: 0, y: 0 },
          { index: 1, x: 1, y: 1 },
        ];
  }

  const points: CurvePoint[] = [];
  for (let index = 0; index < 8; index += 1) {
    const x = values[`${prefix}Point${index}X`];
    const y = values[`${prefix}Point${index}Y`];
    if (typeof x === "number" && typeof y === "number") {
      points.push({ index, x, y });
    }
  }
  return points.length >= 2 ? points : defaultCurvePoints;
}

function isCurvePointKey(key: string) {
  return /^(Red|Green|Blue)?Point\d+[XY]$/.test(key);
}

function valuesWithCurvePoints(
  values: Record<string, number>,
  channel: CurveChannel,
  points: CurvePoint[],
) {
  const prefix = curvePrefix(channel);
  const nextValues = Object.fromEntries(
    Object.entries(values).filter(([key]) => !new RegExp(`^${prefix}Point\\d+[XY]$`).test(key)),
  );
  points
    .map((point) => ({
      ...point,
      x: clamp(point.x, 0, 1),
      y: clamp(point.y, 0, 1),
    }))
    .sort((a, b) => a.x - b.x)
    .forEach((point, nextIndex) => {
      nextValues[`${prefix}Point${nextIndex}X`] = Number(point.x.toFixed(3));
      nextValues[`${prefix}Point${nextIndex}Y`] = Number(point.y.toFixed(3));
    });
  return nextValues;
}

function HueRangeControl({
  values,
  onChange,
}: {
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
}) {
  const center = values.Center ?? 120;
  const range = values.Range ?? 36;
  const feather = values.Feather ?? 24;
  const coreSegments = hueSelectionSegments(center, range);
  const featherSegments = hueSelectionSegments(center, clamp(range + feather * 2, 1, 360));
  const markerPosition = `${(center / 360) * 100}%`;

  function spectrumFromTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return null;
    return target.classList.contains("hue-range-spectrum")
      ? target
      : target.closest<HTMLElement>(".hue-range-spectrum");
  }

  function updateFromPointer(event: React.PointerEvent<HTMLElement>, mode: "center" | "range") {
    const spectrum = spectrumFromTarget(event.currentTarget);
    if (!spectrum) return;
    const rect = spectrum.getBoundingClientRect();
    const hue = clamp(((event.clientX - rect.left) / rect.width) * 360, 0, 360);
    if (mode === "center") {
      onChange("Center", Math.round(hue) % 360);
      return;
    }
    const distance = circularHueDistance(hue, center);
    onChange("Range", clamp(Math.round(distance * 2), 1, 180));
  }

  function beginDrag(event: React.PointerEvent<HTMLElement>, mode: "center" | "range") {
    event.preventDefault();
    const spectrum = spectrumFromTarget(event.currentTarget);
    if (!spectrum) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event, mode);

    const handleMove = (moveEvent: PointerEvent) => {
      const rect = spectrum.getBoundingClientRect();
      const hue = clamp(((moveEvent.clientX - rect.left) / rect.width) * 360, 0, 360);
      if (mode === "center") {
        onChange("Center", Math.round(hue) % 360);
      } else {
        const distance = circularHueDistance(hue, center);
        onChange("Range", clamp(Math.round(distance * 2), 1, 180));
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop);
  }

  return (
    <div className="hue-range-control">
      <div className="hue-range-header">
        <span>Hue selection</span>
        <small>{Math.round(center)}° center · {Math.round(range)}° range · {Math.round(feather)}° feather</small>
      </div>
      <div className="hue-range-spectrum" onPointerDown={(event) => beginDrag(event, "center")}>
        {featherSegments.map((segment) => (
          <i
            className="hue-range-band feather"
            key={`feather-${segment.start}-${segment.end}`}
            style={{
              left: `${(segment.start / 360) * 100}%`,
              width: `${((segment.end - segment.start) / 360) * 100}%`,
            }}
          />
        ))}
        {coreSegments.map((segment) => (
          <i
            className="hue-range-band core"
            key={`core-${segment.start}-${segment.end}`}
            style={{
              left: `${(segment.start / 360) * 100}%`,
              width: `${((segment.end - segment.start) / 360) * 100}%`,
            }}
          />
        ))}
        <button
          className="hue-range-marker center"
          style={{ left: markerPosition }}
          onPointerDown={(event) => beginDrag(event, "center")}
          title="Drag hue center"
        />
        {coreSegments.map((segment) => (
          <React.Fragment key={`handles-${segment.start}-${segment.end}`}>
            <button
              className="hue-range-marker edge"
              style={{ left: `${(segment.start / 360) * 100}%` }}
              onPointerDown={(event) => beginDrag(event, "range")}
              title="Drag hue range"
            />
            <button
              className="hue-range-marker edge"
              style={{ left: `${(segment.end / 360) * 100}%` }}
              onPointerDown={(event) => beginDrag(event, "range")}
              title="Drag hue range"
            />
          </React.Fragment>
        ))}
      </div>
      <div className="hue-range-ticks">
        <span>R</span><span>Y</span><span>G</span><span>C</span><span>B</span><span>M</span><span>R</span>
      </div>
    </div>
  );
}

function OperationCard({ operation }: { operation: Operation }) {
  const { state, dispatch } = useOpenGrade();
  const masks = operation.masks ?? (operation.mask && operation.mask.mode !== "none" ? [operation.mask] : []);
  const hasMaskApplicator = masks.length > 0;

  function handleChange(key: string, newValue: number) {
    void dispatch({ type: "operation.update", operationId: operation.id, key, value: newValue });
  }

  function replaceValues(values: Record<string, number>) {
    void dispatch({ type: "operation.replaceValues", operationId: operation.id, values });
  }

  async function loadLut() {
    const lutPath = await openLutDialog();
    if (!lutPath) return;
    void dispatch({ type: "operation.setLutPath", operationId: operation.id, lutPath });
  }

  function setMask(maskIndex: number, layerId: string | null, mode: MaskMode) {
    void dispatch({
      type: "operation.updateMask",
      operationId: operation.id,
      maskIndex,
      mask: {
        layerId,
        mode: layerId ? mode : "none",
      },
    });
  }

  function handleLayerSelect(maskIndex: number, layerId: string) {
    const currentMask = masks[maskIndex];
    setMask(maskIndex, layerId || null, layerId ? (currentMask?.mode === "none" ? "add" : currentMask.mode) : "none");
  }

  function handleMaskMode(maskIndex: number, mode: MaskMode) {
    const currentMask = masks[maskIndex];
    const fallbackLayerId = currentMask?.layerId || state.layers[0]?.id || null;
    setMask(maskIndex, mode === "none" ? null : fallbackLayerId, mode);
  }

  function addMaskApplicator() {
    const layerId = state.activeLayerId || state.layers[0]?.id;
    if (layerId) {
      void dispatch({
        type: "operation.addMask",
        operationId: operation.id,
        mask: { layerId, mode: "add" },
      });
      return;
    }
    void dispatch({ type: "layer.addMask" });
  }

  function removeMaskApplicator(maskIndex: number) {
    void dispatch({ type: "operation.removeMask", operationId: operation.id, maskIndex });
  }

  return (
    <article
      className={`operation-card ${operation.enabled ? "" : "disabled"} ${operation.collapsed ? "collapsed" : ""}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/opengrade-operation")) event.preventDefault();
      }}
      onDrop={(event) => {
        const operationId = event.dataTransfer.getData("application/opengrade-operation");
        if (operationId) dispatch({ type: "operation.move", operationId, targetId: operation.id });
      }}
    >
      <div className="operation-header">
        <span
          className="drag-dots"
          draggable
          onDragStart={(event) => event.dataTransfer.setData("application/opengrade-operation", operation.id)}
        >
          ⠿
        </span>
        <button className="collapse-operation" onClick={() => dispatch({ type: "operation.collapse", operationId: operation.id })}>⌄</button>
        <strong>{operation.type}</strong>
        {operation.source === "agent" && <small>AGENT</small>}
        <button
          className={`toggle ${operation.enabled ? "on" : ""}`}
          aria-label={`Toggle ${operation.type}`}
          onClick={() => dispatch({ type: "operation.toggle", operationId: operation.id })}
        ><i /></button>
        <button className="delete-operation" aria-label={`Delete ${operation.type}`} onClick={() => dispatch({ type: "operation.delete", operationId: operation.id })}>×</button>
      </div>
      {!operation.collapsed && (
        <div className="operation-controls">
          {operation.commandText && <div className="empty-message">{operation.commandText}</div>}
          {operation.type === "Curve" && (
            <CurveControl
              values={operation.values}
              onChange={handleChange}
              onReplaceValues={replaceValues}
            />
          )}
          {operation.type === "HueRange" && (
            <HueRangeControl
              values={operation.values}
              onChange={handleChange}
            />
          )}
          {operation.type === "LUT" && (
            <div className="lut-loader">
              <button onClick={() => void loadLut()}>Load .cube LUT</button>
              <span>{operation.lutPath ? fileNameFromPath(operation.lutPath) : "No LUT loaded"}</span>
            </div>
          )}
          {Object.entries(operation.values).filter(([key]) => operation.type !== "Curve" || !isCurvePointKey(key)).map(([key, value]) => {
            const [min, max, step, unit] = rangeFor(key);
            return (
              <label className="control-row" key={key}>
                <span>{key}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  onInput={(event) => handleChange(key, Number(event.currentTarget.value))}
                  onChange={(event) => handleChange(key, Number(event.target.value))}
                />
                <input
                  className="control-number"
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  aria-label={`${operation.type} ${key}`}
                  onChange={(event) => handleChange(key, Number(event.target.value))}
                />
                <output>{formatValue(key, value, unit)}</output>
              </label>
            );
          })}
          <div className={`mask-applicator ${hasMaskApplicator ? "active" : ""}`}>
            {hasMaskApplicator ? (
              <>
                <div className="mask-applicator-header">
                  <span>Mask Applicators</span>
                  <button onClick={addMaskApplicator}>Add</button>
                </div>
                {masks.map((mask, maskIndex) => (
                  <div className="mask-applicator-item" key={`${mask.layerId}-${maskIndex}`}>
                    <span className="mask-applicator-index">{maskIndex + 1}</span>
                    <label className="control-row mask-row">
                      <span>Layer</span>
                      <select
                        value={mask.layerId ?? ""}
                        onChange={(event) => handleLayerSelect(maskIndex, event.target.value)}
                      >
                        {state.layers.map((layer) => (
                          <option key={layer.id} value={layer.id}>{layer.name}</option>
                        ))}
                      </select>
                      <output>{mask.layerId ? "linked" : "none"}</output>
                    </label>
                    <label className="control-row mask-row">
                      <span>Mode</span>
                      <select
                        value={mask.mode}
                        onChange={(event) => handleMaskMode(maskIndex, event.target.value as MaskMode)}
                      >
                        <option value="add">Add</option>
                        <option value="subtract">Sub</option>
                      </select>
                      <output>{mask.mode}</output>
                    </label>
                    <button className="mask-remove-inline" onClick={() => removeMaskApplicator(maskIndex)}>×</button>
                  </div>
                ))}
              </>
            ) : (
              <button className="add-mask-applicator" onClick={addMaskApplicator}>
                <span>＋</span>Add mask applicator
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function CurveControl({
  values,
  onChange,
  onReplaceValues,
}: {
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
  onReplaceValues: (values: Record<string, number>) => void;
}) {
  const [channel, setChannel] = useState<CurveChannel>("Master");
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const points = curvePointsFromValues(values, channel)
    .map((point) => ({
      ...point,
      x: clamp(point.x, 0, 1),
      y: clamp(point.y, 0, 1),
    }))
    .sort((a, b) => a.x - b.x);
  const selectedPoint = selectedPointIndex === null
    ? null
    : points.find((point) => point.index === selectedPointIndex) ?? null;
  const path = points
    .map((point) => `${(point.x * 100).toFixed(2)},${((1 - point.y) * 100).toFixed(2)}`)
    .join(" ");

  function pointFromEvent(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function addPoint(event: React.PointerEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget && !(event.target instanceof SVGLineElement) && !(event.target instanceof SVGPolylineElement)) {
      return;
    }
    if (points.length >= 8) return;
    const point = pointFromEvent(event);
    const nextPoints = [...points, { index: points.length, x: point.x, y: point.y }]
      .sort((a, b) => a.x - b.x)
      .map((item, index) => ({ ...item, index }));
    setSelectedPointIndex(nextPoints.find((item) => item.x === point.x && item.y === point.y)?.index ?? null);
    onReplaceValues(valuesWithCurvePoints(values, channel, nextPoints));
  }

  function deleteSelectedPoint() {
    if (!selectedPoint || selectedPoint.index === 0 || selectedPoint.index === points.length - 1) return;
    const nextPoints = points
      .filter((point) => point.index !== selectedPoint.index)
      .map((point, index) => ({ ...point, index }));
    setSelectedPointIndex(null);
    onReplaceValues(valuesWithCurvePoints(values, channel, nextPoints));
  }

  function beginDrag(event: React.PointerEvent<SVGCircleElement>, point: CurvePoint) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedPointIndex(point.index);
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();

    const movePoint = (pointerEvent: PointerEvent) => {
      const rawX = (pointerEvent.clientX - rect.left) / rect.width;
      const rawY = 1 - (pointerEvent.clientY - rect.top) / rect.height;
      const previous = points.find((item) => item.index === point.index - 1);
      const next = points.find((item) => item.index === point.index + 1);
      const minX = point.index === 0 ? 0 : (previous?.x ?? 0) + 0.02;
      const maxX = point.index === points.length - 1 ? 1 : (next?.x ?? 1) - 0.02;
      const nextX = point.index === 0 || point.index === points.length - 1
        ? point.x
        : clamp(rawX, minX, maxX);
      const nextY = clamp(rawY, 0, 1);
      onChange(curvePointKey(channel, point.index, "X"), Number(nextX.toFixed(3)));
      onChange(curvePointKey(channel, point.index, "Y"), Number(nextY.toFixed(3)));
    };

    const stop = () => {
      window.removeEventListener("pointermove", movePoint);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", movePoint);
    window.addEventListener("pointerup", stop);
  }

  return (
    <div className="curve-control">
      <div className="curve-header">
        <span>Curve</span>
        <small>{channel} channel</small>
      </div>
      <div className="curve-channel-tabs">
        {curveChannels.map((item) => (
          <button
            key={item}
            className={channel === item ? "active" : ""}
            onClick={() => {
              setChannel(item);
              setSelectedPointIndex(null);
            }}
          >
            {item === "Master" ? "M" : item[0]}
          </button>
        ))}
        <button
          className="curve-delete-point"
          disabled={!selectedPoint || selectedPoint.index === 0 || selectedPoint.index === points.length - 1}
          onClick={deleteSelectedPoint}
        >
          Delete point
        </button>
      </div>
      <svg className={`curve-editor channel-${channel.toLowerCase()}`} viewBox="0 0 100 100" preserveAspectRatio="none" onPointerDown={addPoint}>
        <line x1="0" y1="100" x2="100" y2="0" className="curve-diagonal" />
        <polyline points={path} className="curve-line" />
        {points.map((point) => (
          <circle
            key={point.index}
            className={`curve-point ${selectedPointIndex === point.index ? "selected" : ""}`}
            cx={point.x * 100}
            cy={(1 - point.y) * 100}
            r="3.6"
            vectorEffect="non-scaling-stroke"
            onPointerDown={(event) => beginDrag(event, point)}
          />
        ))}
      </svg>
      <div className="curve-readout">
        <span>{points.length}/8 points</span>
        <span>Click graph to add</span>
      </div>
    </div>
  );
}

function MaskEditor() {
  const { state, dispatch } = useOpenGrade();
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(() => new Set([state.activeLayerId ?? ""]));

  function defaultPolygonPoints() {
    return [
      { x: 0.38, y: 0.34 },
      { x: 0.62, y: 0.34 },
      { x: 0.68, y: 0.58 },
      { x: 0.5, y: 0.72 },
      { x: 0.32, y: 0.58 },
    ];
  }

  function addMask(shape: MaskLayer["shape"]) {
    const shapeName = shape === "polygon" ? "Pen" : shape === "rectangle" ? "Rectangle" : shape === "linear" ? "Linear" : "Ellipse";
    void dispatch({
      type: "layer.addMask",
      layer: {
        shape,
        name: `${shapeName} Mask ${String(state.layers.length + 1).padStart(2, "0")}`,
        width: shape === "linear" ? 1.25 : shape === "polygon" ? 0.36 : 0.46,
        height: shape === "linear" ? 0.5 : shape === "polygon" ? 0.38 : 0.52,
        feather: shape === "linear" ? 0.45 : shape === "polygon" ? 0.05 : 0.28,
        angle: shape === "linear" ? 90 : 0,
        points: shape === "polygon" ? defaultPolygonPoints() : undefined,
      },
    });
  }

  function updateLayer(layer: MaskLayer, key: keyof Omit<MaskLayer, "id" | "type" | "shape" | "name">, value: number) {
    void dispatch({
      type: "layer.updateMask",
      layerId: layer.id,
      patch: { [key]: value },
    });
  }

  function updateShape(layer: MaskLayer, shape: MaskLayer["shape"]) {
    void dispatch({
      type: "layer.updateMask",
      layerId: layer.id,
      patch: {
        shape,
        angle: shape === "linear" ? (layer.angle ?? 90) : (layer.angle ?? 0),
        feather: shape === "linear" ? Math.max(layer.feather, 0.35) : layer.feather,
        points: shape === "polygon" ? (layer.points && layer.points.length >= 3 ? layer.points : defaultPolygonPoints()) : undefined,
      },
    });
  }

  function updatePoint(layer: MaskLayer, pointIndex: number, key: "x" | "y", value: number) {
    const points = layer.points ?? defaultPolygonPoints();
    const nextPoints = points.map((point, index) => (
      index === pointIndex ? { ...point, [key]: value } : point
    ));
    void dispatch({ type: "layer.updateMask", layerId: layer.id, patch: { points: nextPoints } });
  }

  function addPoint(layer: MaskLayer) {
    const points = layer.points ?? defaultPolygonPoints();
    const last = points[points.length - 1] ?? { x: layer.x, y: layer.y };
    const nextPoint = { x: clamp(last.x + 0.04, -1, 2), y: clamp(last.y + 0.04, -1, 2) };
    void dispatch({ type: "layer.updateMask", layerId: layer.id, patch: { points: [...points, nextPoint] } });
  }

  function deletePoint(layer: MaskLayer, pointIndex: number) {
    const points = layer.points ?? [];
    if (points.length <= 3) return;
    void dispatch({
      type: "layer.updateMask",
      layerId: layer.id,
      patch: { points: points.filter((_, index) => index !== pointIndex) },
    });
  }

  function deleteMask(layerId: string) {
    void dispatch({ type: "layer.deleteMask", layerId });
  }

  function toggleLayer(layerId: string) {
    setExpandedLayers((current) => {
      const next = new Set(current);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }

  function selectLayer(layerId: string) {
    void dispatch({ type: "layer.select", layerId });
  }

  return (
    <div className="mask-editor editor-scroll">
      <div className="stack-intro">
        <span>{state.layers.length} MASK LAYERS</span>
        <div className="mask-add-buttons">
          <button onClick={() => addMask("ellipse")}>Ellipse</button>
          <button onClick={() => addMask("rectangle")}>Rect</button>
          <button onClick={() => addMask("linear")}>Linear</button>
          <button onClick={() => addMask("polygon")}>Pen</button>
        </div>
      </div>
      <div className="operation-list mask-layer-list">
        {state.layers.map((layer) => {
          const expanded = expandedLayers.has(layer.id);
          const active = state.activeLayerId === layer.id;
          return (
            <article
              className={`operation-card mask-layer-card ${active ? "active" : ""} ${expanded ? "" : "collapsed"}`}
              key={layer.id}
              onClick={() => selectLayer(layer.id)}
            >
              <div className="operation-header">
                <span className="drag-dots">◌</span>
                <button
                  className="collapse-operation"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleLayer(layer.id);
                  }}
                >
                  ⌄
                </button>
                <strong>{layer.name}</strong>
                {active && <small>ACTIVE</small>}
                <button className={`toggle ${active ? "on" : ""}`} aria-label={`Select ${layer.name}`}><i /></button>
                <button
                  className="delete-operation"
                  aria-label={`Delete ${layer.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteMask(layer.id);
                  }}
                >
                  ×
                </button>
              </div>
              {expanded && (
                <div className="operation-controls mask-layer-controls">
                  <label className="inspector-control">
                    <span>Shape</span>
                    <select
                      value={layer.shape}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => updateShape(layer, event.currentTarget.value as MaskLayer["shape"])}
                    >
                      <option value="ellipse">Ellipse</option>
                      <option value="rectangle">Rectangle</option>
                      <option value="linear">Linear gradient</option>
                      <option value="polygon">Pen / Polygon</option>
                    </select>
                    <output>{layer.shape}</output>
                  </label>
                  <MaskValueControl label="X" value={layer.x} min={-1} max={2} step={0.01} onChange={(value) => updateLayer(layer, "x", value)} />
                  <MaskValueControl label="Y" value={layer.y} min={-1} max={2} step={0.01} onChange={(value) => updateLayer(layer, "y", value)} />
                  {layer.shape !== "polygon" && (
                    <>
                      <MaskValueControl label="Width" value={layer.width} min={0.05} max={3} step={0.01} onChange={(value) => updateLayer(layer, "width", value)} />
                      <MaskValueControl label="Height" value={layer.height} min={0.05} max={3} step={0.01} onChange={(value) => updateLayer(layer, "height", value)} />
                    </>
                  )}
                  <MaskValueControl label="Feather" value={layer.feather} min={0} max={0.95} step={0.01} format={formatPercent} onChange={(value) => updateLayer(layer, "feather", value)} />
                  {layer.shape === "linear" && (
                    <MaskValueControl label="Angle" value={layer.angle ?? 0} min={-180} max={180} step={1} format={(value) => `${Math.round(value)}°`} onChange={(value) => updateLayer(layer, "angle", value)} />
                  )}
                  {layer.shape === "polygon" && (
                    <div className="pen-points">
                      <div className="pen-points-header">
                        <span>{layer.points?.length ?? 0} Pen Points</span>
                        <button onClick={() => addPoint(layer)}>＋ Point</button>
                      </div>
                      {(layer.points ?? []).map((point, pointIndex) => (
                        <div className="pen-point-row" key={pointIndex}>
                          <span>{pointIndex + 1}</span>
                          <input
                            type="number"
                            step={0.01}
                            value={Number(point.x.toFixed(3))}
                            onChange={(event) => updatePoint(layer, pointIndex, "x", Number(event.currentTarget.value))}
                          />
                          <input
                            type="number"
                            step={0.01}
                            value={Number(point.y.toFixed(3))}
                            onChange={(event) => updatePoint(layer, pointIndex, "y", Number(event.currentTarget.value))}
                          />
                          <button disabled={(layer.points?.length ?? 0) <= 3} onClick={() => deletePoint(layer, pointIndex)}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <MaskValueControl label="Opacity" value={layer.opacity} min={0} max={1} step={0.01} format={formatPercent} onChange={(value) => updateLayer(layer, "opacity", value)} />
                </div>
              )}
            </article>
          );
        })}
      </div>
      <div className="mask-note"><span>✦</span><div><strong>Mask applicator ready</strong><small>Select a mask layer, then link it from an effect</small></div></div>
    </div>
  );
}

function MaskValueControl({
  label,
  value,
  min,
  max,
  step,
  format = (item) => item.toFixed(2),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="inspector-control">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <input
        className="inspector-number"
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(3))}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <output>{format(value)}</output>
    </label>
  );
}

function AssistantEditor() {
  const { state, dispatch } = useOpenGrade();
  const [prompt, setPrompt] = useState("");
  const [agentInboxStatus, setAgentInboxStatus] = useState("Agent inbox listening");
  const [lastAgentBatchId, setLastAgentBatchId] = useState<string | null>(null);

  async function applyAgentBatch(batch: CommandBatch) {
    for (const command of batch.commands) {
      if (isMediaOpenPathCommand(command)) {
        const image = await openImagePath(command.path);
        setImageUrl(image.dataUrl);
        await dispatch({
          type: "media.import",
          item: {
            ...mediaFromOpenedImage(image),
            name: command.name ?? fileNameFromPath(image.path),
            palette: command.palette ?? "warm",
          },
        });
        continue;
      }
      await dispatch({
        ...command,
        source: "source" in command && command.source ? command.source : batch.source,
      } as Command);
    }
    await dispatch({
      type: "assistant.apply",
      prompt: `Applied agent batch: ${batch.title}. ${batch.description}`,
      source: batch.source,
    });
  }

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(() => {
      readAgentInbox()
        .then((contents) => {
          if (cancelled || !contents) return;
          const parsed: unknown = JSON.parse(contents);
          if (!isAgentCommandBatch(parsed)) {
            setAgentInboxStatus("Agent inbox ignored invalid JSON");
            return;
          }
          if (parsed.id === lastAgentBatchId) return;
          setLastAgentBatchId(parsed.id);
          setAgentInboxStatus(`Applying ${parsed.title}`);
          void applyAgentBatch(parsed).then(() => {
            if (!cancelled) setAgentInboxStatus(`Applied ${parsed.title}`);
          });
        })
        .catch((error) => {
          if (!cancelled) setAgentInboxStatus(`Agent inbox error: ${messageFromError(error)}`);
        });
    }, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dispatch, lastAgentBatchId]);

  function apply() {
    if (!prompt.trim()) return;
    void dispatch({ type: "assistant.apply", prompt: prompt.trim() });
    setPrompt("");
  }
  return (
    <div className="assistant-editor">
      <div className="agent-inbox-status">
        <span />
        <strong>Agent Bridge</strong>
        <small>{agentInboxStatus}</small>
      </div>
      <div className="assistant-feed editor-scroll">
        {state.logs.length === 0 && <div className="assistant-empty">Agent log is empty</div>}
        {state.logs.map((log) => (
          <button className="log-entry" key={log.id}>
            <span className={`log-icon ${log.tone}`}>{log.tone === "success" ? "✓" : log.tone === "note" ? "✦" : "＋"}</span>
            <span><strong>{log.title}</strong><small>{log.detail}</small></span>
          </button>
        ))}
      </div>
      <div className="assistant-composer">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") apply();
          }}
          placeholder="Describe a color change…"
        />
        <div><span>⌘ ↵ to apply</span><button onClick={apply}>Apply <i>↑</i></button></div>
      </div>
    </div>
  );
}
