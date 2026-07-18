import React, { useCallback, useEffect, useMemo, useState } from "react";
import { exportImage, loadProject, openImagePath, saveProject } from "./core/coreBackend";
import { setImageUrl } from "./core/imageState";
import { useOpenGrade } from "./core/useOpenGrade";
import { AreaLayout } from "./layout/AreaLayout";
import {
  cloneLayout,
  closeArea,
  countAreas,
  defaultWorkspaces,
  splitArea,
  swapEditors,
  updateEditor,
  updateRatio,
} from "./layout/layoutModel";
import type {
  EditorType,
  LayoutNode,
  SplitDirection,
  Workspace,
  WorkspaceId,
} from "./types";

const STORAGE_KEY = "opengrade.workspaces.v2";
const workspaceIds: WorkspaceId[] = ["grade", "mask", "review"];
const editorTypes: EditorType[] = [
  "media",
  "viewer",
  "effects",
  "stack",
  "mask",
  "assistant",
  "scopes",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEditorType(value: unknown): value is EditorType {
  return typeof value === "string" && editorTypes.includes(value as EditorType);
}

function isSplitDirection(value: unknown): value is SplitDirection {
  return value === "row" || value === "column";
}

function isLayoutNode(value: unknown): value is LayoutNode {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  if (value.kind === "area") return isEditorType(value.editor);
  if (value.kind !== "split") return false;
  return (
    isSplitDirection(value.direction) &&
    typeof value.ratio === "number" &&
    Number.isFinite(value.ratio) &&
    isLayoutNode(value.first) &&
    isLayoutNode(value.second)
  );
}

function isWorkspace(value: unknown, id: WorkspaceId): value is Workspace {
  return (
    isRecord(value) &&
    value.id === id &&
    typeof value.name === "string" &&
    isLayoutNode(value.layout)
  );
}

function loadWorkspaces(): Record<WorkspaceId, Workspace> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : null;
    if (isRecord(parsed)) {
      const restored = cloneLayout(defaultWorkspaces);
      let hasValidWorkspace = false;
      for (const id of workspaceIds) {
        if (isWorkspace(parsed[id], id)) {
          restored[id] = parsed[id];
          hasValidWorkspace = true;
        }
      }
      if (hasValidWorkspace) return restored;
    }
  } catch {
    // A corrupt layout should never prevent the application from opening.
  }
  return cloneLayout(defaultWorkspaces);
}

export function App() {
  const { state, dispatch } = useOpenGrade();
  const [workspaces, setWorkspaces] = useState(loadWorkspaces);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>("grade");
  const [maximizedArea, setMaximizedArea] = useState<string | null>(null);
  const [hoveredArea, setHoveredArea] = useState<string | null>(null);
  const [savedPulse, setSavedPulse] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [projectStatus, setProjectStatus] = useState<string | null>(null);

  const workspace = workspaces[activeWorkspace];
  const areaCount = useMemo(() => countAreas(workspace.layout), [workspace.layout]);

  const setLayout = useCallback(
    (updater: (layout: LayoutNode) => LayoutNode) => {
      setWorkspaces((current) => ({
        ...current,
        [activeWorkspace]: {
          ...current[activeWorkspace],
          layout: updater(current[activeWorkspace].layout),
        },
      }));
      setSavedPulse(true);
    },
    [activeWorkspace],
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
    } catch {
      // file:// previews and privacy-restricted WebViews may disable storage.
    }
    const timer = window.setTimeout(() => setSavedPulse(false), 600);
    return () => window.clearTimeout(timer);
  }, [workspaces]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void dispatch({ type: event.shiftKey ? "history.redo" : "history.undo" });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        void dispatch({ type: "history.redo" });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === "Space" && hoveredArea) {
        event.preventDefault();
        setMaximizedArea((current) => (current === hoveredArea ? null : hoveredArea));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, hoveredArea]);

  const actions = {
    changeEditor: (areaId: string, editor: EditorType) =>
      setLayout((layout) => updateEditor(layout, areaId, editor)),
    split: (areaId: string, direction: SplitDirection, ratio?: number) =>
      setLayout((layout) => splitArea(layout, areaId, direction, ratio)),
    close: (areaId: string) => {
      if (areaCount <= 1) return;
      setLayout((layout) => closeArea(layout, areaId) ?? layout);
      if (maximizedArea === areaId) setMaximizedArea(null);
    },
    resize: (splitId: string, ratio: number) =>
      setLayout((layout) => updateRatio(layout, splitId, ratio)),
    swap: (sourceId: string, targetId: string) =>
      setLayout((layout) => swapEditors(layout, sourceId, targetId)),
    maximize: (areaId: string) =>
      setMaximizedArea((current) => (current === areaId ? null : areaId)),
  };

  function resetWorkspace() {
    setWorkspaces((current) => ({
      ...current,
      [activeWorkspace]: cloneLayout(defaultWorkspaces[activeWorkspace]),
    }));
    setMaximizedArea(null);
  }

  async function handleExport() {
    setExportStatus("Exporting...");
    try {
      const path = await exportImage(state.operations, state.layers);
      setExportStatus(path ? `Exported ${path.split(/[\\/]/).pop()}` : null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExportStatus(`Export failed: ${message}`);
    }
  }

  async function handleSaveProject() {
    setProjectStatus("Saving project...");
    try {
      const path = await saveProject(state);
      setProjectStatus(path ? `Saved ${path.split(/[\\/]/).pop()}` : null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProjectStatus(`Save failed: ${message}`);
    }
  }

  async function handleLoadProject() {
    setProjectStatus("Loading project...");
    try {
      const result = await loadProject();
      if (!result) {
        setProjectStatus(null);
        return;
      }
      await dispatch({ type: "project.replace", state: result.state });
      const selectedMedia = result.state.media.find((item) => item.id === result.state.selectedMediaId)
        ?? result.state.media.find((item) => item.sourcePath);
      if (selectedMedia?.sourcePath) {
        const image = await openImagePath(selectedMedia.sourcePath);
        setImageUrl(image.dataUrl);
      }
      setProjectStatus(`Loaded ${result.path.split(/[\\/]/).pop()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProjectStatus(`Load failed: ${message}`);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><i /><i /></div>
          <strong>OpenGrade</strong>
          <span className="prototype-badge">INTERACTION PROTOTYPE</span>
        </div>

        <nav className="workspace-tabs" aria-label="Workspaces">
          {(Object.keys(workspaces) as WorkspaceId[]).map((id) => (
            <button
              className={activeWorkspace === id ? "active" : ""}
              key={id}
              onClick={() => {
                setActiveWorkspace(id);
                setMaximizedArea(null);
              }}
            >
              {workspaces[id].name}
            </button>
          ))}
          <button className="add-workspace" title="Add workspace">＋</button>
        </nav>

        <div className="top-actions">
          <button className="icon-button" title="Undo" disabled={!state.history.canUndo} onClick={() => dispatch({ type: "history.undo" })}>↶</button>
          <button className="icon-button" title="Redo" disabled={!state.history.canRedo} onClick={() => dispatch({ type: "history.redo" })}>↷</button>
          <button className="layout-button" onClick={() => void handleSaveProject()}>Save Project</button>
          <button className="layout-button" onClick={() => void handleLoadProject()}>Load Project</button>
          <button className="layout-button" onClick={resetWorkspace}>Reset layout</button>
          <button className="live-button"><span />Live</button>
          <button className="export-button" onClick={() => void handleExport()}>Export</button>
        </div>
      </header>

      <main className={`workspace ${maximizedArea ? "is-maximized" : ""}`}>
        <AreaLayout
          node={workspace.layout}
          maximizedArea={maximizedArea}
          areaCount={areaCount}
          actions={actions}
          onAreaHover={setHoveredArea}
        />
      </main>

      <footer className="statusbar">
        <div><span className={`save-dot ${savedPulse ? "pulse" : ""}`} />Layout saved</div>
        <div>
          {projectStatus && <span>{projectStatus}</span>}
          {exportStatus && <span>{exportStatus}</span>}
          <span>{areaCount} areas</span>
          <span>ACEScct</span>
          <span>3840 × 2160</span>
          <span>24 fps</span>
          <span>Mock Core · rev 01</span>
        </div>
      </footer>
    </div>
  );
}
