import type { OpenGradeClient, ProjectState, Command, MaskLayer, Operation } from "../types";
import { openGradeClient as mockClient } from "./mockClient";

export type BackendKind = "tauri" | "mock";

export type ImageInfo = {
  width: number;
  height: number;
  fileSize: number;
  channels: number;
};

export type OpenGradeProjectFile = {
  schemaVersion: 1;
  app: "OpenGrade";
  savedAt: string;
  project: ProjectState;
};

let backendKind: BackendKind | null = null;
const previewMaxDimension = 960;
const renderCacheLimit = 8;
const renderCache = new Map<string, string>();

type RenderRequest = {
  key: string;
  operations: Operation[];
  layers: MaskLayer[];
  resolve: (url: string | null) => void;
  reject: (error: unknown) => void;
};

let activeRender: Promise<void> | null = null;
let pendingRender: RenderRequest | null = null;

function detectBackend(): BackendKind {
  if (
    typeof window !== "undefined" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  ) {
    return "tauri";
  }
  return "mock";
}

export function getBackendKind(): BackendKind {
  if (!backendKind) backendKind = detectBackend();
  return backendKind;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function rememberRender(key: string, url: string) {
  renderCache.delete(key);
  renderCache.set(key, url);
  while (renderCache.size > renderCacheLimit) {
    const oldest = renderCache.keys().next().value;
    if (!oldest) return;
    renderCache.delete(oldest);
  }
}

function renderKey(operations: Operation[], layers: MaskLayer[]) {
  return JSON.stringify({
    previewMaxDimension,
    operations,
    layers,
  });
}

function cloneRenderInput<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function runRenderQueue(request: RenderRequest): Promise<void> {
  activeRender = (async () => {
    try {
      const cached = renderCache.get(request.key);
      if (cached) {
        request.resolve(cached);
      } else {
        const url = await tauriInvoke<string>("apply_grade", {
          operations: request.operations,
          layers: request.layers,
          previewMaxDimension,
        });
        rememberRender(request.key, url);
        request.resolve(url);
      }
    } catch (error) {
      request.reject(error);
    } finally {
      activeRender = null;
      const next = pendingRender;
      pendingRender = null;
      if (next) void runRenderQueue(next);
    }
  })();

  await activeRender;
}

function enqueueRender(operations: Operation[], layers: MaskLayer[]): Promise<string | null> {
  const key = renderKey(operations, layers);
  const cached = renderCache.get(key);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const request: RenderRequest = {
      key,
      operations: cloneRenderInput(operations),
      layers: cloneRenderInput(layers),
      resolve,
      reject,
    };

    if (!activeRender) {
      void runRenderQueue(request);
      return;
    }

    if (pendingRender) pendingRender.resolve(null);
    pendingRender = request;
  });
}

export function clearRenderCache() {
  renderCache.clear();
  if (pendingRender) pendingRender.resolve(null);
  pendingRender = null;
}

/// Open file dialog and load image
export async function openFileDialog(): Promise<{ path: string; info: ImageInfo; dataUrl: string } | null> {
  if (getBackendKind() !== "tauri") return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "tiff", "tif", "exr"] },
    ],
  });
  if (!selected) return null;

  return openImagePath(selected);
}

export async function openLutDialog(): Promise<string | null> {
  if (getBackendKind() !== "tauri") return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    filters: [
      { name: "3D LUT", extensions: ["cube"] },
    ],
  });
  if (!selected || Array.isArray(selected)) return null;
  return selected;
}

/// Load an image path into the active backend image slot.
export async function openImagePath(path: string): Promise<{ path: string; info: ImageInfo; dataUrl: string }> {
  clearRenderCache();
  const result = await tauriInvoke<{ info: ImageInfo; dataUrl: string }>("open_image", { path });
  return { path, ...result };
}

/// Apply image processing operation via Rust backend
export async function processImage(
  operation: "exposure" | "temperature",
  value: number,
): Promise<string | null> {
  if (getBackendKind() === "tauri") {
    return tauriInvoke(
      operation === "exposure" ? "apply_exposure" : "apply_temperature",
      { [operation === "exposure" ? "exposure" : "temperature"]: value },
    );
  }
  return null;
}

/// Render the active image through the full operation stack.
export async function renderOperations(operations: Operation[], layers: MaskLayer[]): Promise<string | null> {
  if (getBackendKind() !== "tauri") return null;
  return enqueueRender(operations, layers);
}

export async function exportImage(operations: Operation[], layers: MaskLayer[]): Promise<string | null> {
  if (getBackendKind() !== "tauri") return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: "opengrade-export.png",
    filters: [
      { name: "PNG Image", extensions: ["png"] },
      { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
      { name: "TIFF Image", extensions: ["tif", "tiff"] },
    ],
  });
  if (!path) return null;
  return tauriInvoke("export_grade", {
    operations,
    layers,
    path,
  });
}

function ensureProjectExtension(path: string) {
  return path.endsWith(".opengrade.json") ? path : `${path}.opengrade.json`;
}

function projectFileFromState(state: ProjectState): OpenGradeProjectFile {
  return {
    schemaVersion: 1,
    app: "OpenGrade",
    savedAt: new Date().toISOString(),
    project: {
      ...state,
      media: state.media.map((item) => ({ ...item })),
      layers: state.layers.map((layer) => ({ ...layer })),
      operations: state.operations.map((operation) => ({
        ...operation,
        values: { ...operation.values },
        lutPath: operation.lutPath,
        masks: operation.masks?.map((mask) => ({ ...mask })),
        mask: operation.mask ? { ...operation.mask } : undefined,
      })),
      logs: state.logs.map((log) => ({ ...log })),
      history: {
        canUndo: false,
        canRedo: false,
      },
    },
  };
}

function assertProjectFile(value: unknown): asserts value is OpenGradeProjectFile {
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    (value as { app?: unknown }).app !== "OpenGrade" ||
    typeof (value as { project?: unknown }).project !== "object" ||
    (value as { project?: unknown }).project === null
  ) {
    throw new Error("This is not a valid OpenGrade project file.");
  }
}

export async function saveProject(state: ProjectState): Promise<string | null> {
  if (getBackendKind() !== "tauri") return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const selected = await save({
    defaultPath: `${state.projectName || "Untitled Grade"}.opengrade.json`,
    filters: [
      { name: "OpenGrade Project", extensions: ["json"] },
    ],
  });
  if (!selected) return null;
  const path = ensureProjectExtension(selected);
  const contents = JSON.stringify(projectFileFromState(state), null, 2);
  return tauriInvoke("save_project_file", { path, contents });
}

export async function loadProject(): Promise<{ path: string; state: ProjectState } | null> {
  if (getBackendKind() !== "tauri") return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    filters: [
      { name: "OpenGrade Project", extensions: ["json"] },
    ],
  });
  if (!selected || Array.isArray(selected)) return null;
  const contents = await tauriInvoke<string>("load_project_file", { path: selected });
  const parsed: unknown = JSON.parse(contents);
  assertProjectFile(parsed);
  return { path: selected, state: parsed.project };
}

export async function readAgentInbox(): Promise<string | null> {
  if (getBackendKind() !== "tauri") return null;
  return tauriInvoke("read_agent_inbox");
}

/// State management — delegates to mock client (stays in frontend for now)
export function getStateClient(): OpenGradeClient & { backend: BackendKind } {
  return Object.assign(mockClient, { backend: getBackendKind() });
}
