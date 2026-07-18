import type {
  Command,
  CommandSource,
  MaskLayer,
  OpenGradeClient,
  Operation,
  OperationType,
  ProjectState,
} from "../types";

const defaultValues: Record<OperationType, Record<string, number>> = {
  Exposure: { Exposure: 0, Blend: 100 },
  BasicAdjustments: { Contrast: 0, Highlights: 0, Shadows: 0, Whites: 0, Blacks: 0, Blend: 100 },
  WhiteBalance: { Temperature: 0, Tint: 0, Blend: 100 },
  ChannelBalance: { Red: 0, Green: 0, Blue: 0, Blend: 100 },
  HueRange: { Center: 120, Range: 36, Feather: 24, Hue: 0, Saturation: 0, Value: 0, Blend: 100 },
  Curve: {
    Point0X: 0,
    Point0Y: 0,
    Point1X: 0.25,
    Point1Y: 0.22,
    Point2X: 0.5,
    Point2Y: 0.5,
    Point3X: 0.75,
    Point3Y: 0.82,
    Point4X: 1,
    Point4Y: 1,
    Blend: 100,
  },
  HSV: { Hue: 0, Saturation: 0, Value: 0, Blend: 100 },
  LUT: { Intensity: 72, Blend: 100 },
};

const initialOperations: Operation[] = [];

const initialLayers: MaskLayer[] = [];

function sourceLabel(source: CommandSource | undefined): string {
  if (source === "agent") return "Agent";
  if (source === "system") return "System";
  return "User";
}

function maskShapeLabel(shape: MaskLayer["shape"] | undefined): string {
  if (shape === "polygon") return "Pen";
  if (shape === "rectangle") return "Rectangle";
  if (shape === "linear") return "Linear";
  return "Ellipse";
}

const initialState: ProjectState = {
  projectName: "Untitled Grade",
  selectedMediaId: "scene01",
  media: [
    { id: "scene01", name: "scene01.jpg", resolution: "3840 × 2160", palette: "warm" },
    { id: "scene02", name: "scene02.jpg", resolution: "3840 × 2160", palette: "dusk" },
    { id: "scene03", name: "scene03.jpg", resolution: "3840 × 2160", palette: "night" },
  ],
  layers: initialLayers,
  activeLayerId: null,
  operations: initialOperations,
  logs: [],
  history: {
    canUndo: false,
    canRedo: false,
  },
  revision: 1,
};

function copyState(state: ProjectState): ProjectState {
  return {
    ...state,
    media: state.media.map((item) => ({ ...item })),
    layers: state.layers.map((layer) => ({ ...layer })),
    activeLayerId: state.activeLayerId,
    operations: state.operations.map((operation) => ({
      ...operation,
      values: { ...operation.values },
      lutPath: operation.lutPath,
      masks: operation.masks?.map((mask) => ({ ...mask })),
      mask: operation.mask ? { ...operation.mask } : undefined,
    })),
    logs: state.logs.map((log) => ({ ...log })),
    history: { ...state.history },
  };
}

function historySnapshot(state: ProjectState): ProjectState {
  return {
    ...copyState(state),
    history: {
      canUndo: false,
      canRedo: false,
    },
  };
}

function withHistoryFlags(state: ProjectState, canUndo: boolean, canRedo: boolean): ProjectState {
  return {
    ...state,
    history: {
      canUndo,
      canRedo,
    },
  };
}

export class MockOpenGradeClient implements OpenGradeClient {
  private state = copyState(initialState);
  private past: ProjectState[] = [];
  private future: ProjectState[] = [];
  private listeners = new Set<() => void>();

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async dispatch(command: Command) {
    if (command.type === "project.replace") {
      this.past = [];
      this.future = [];
      this.state = withHistoryFlags(historySnapshot(command.state), false, false);
      this.listeners.forEach((listener) => listener());
      return;
    }

    if (command.type === "history.undo") {
      const previous = this.past.pop();
      if (!previous) return;
      this.future.push(historySnapshot(this.state));
      this.state = withHistoryFlags(historySnapshot(previous), this.past.length > 0, this.future.length > 0);
      this.listeners.forEach((listener) => listener());
      return;
    }

    if (command.type === "history.redo") {
      const nextState = this.future.pop();
      if (!nextState) return;
      this.past.push(historySnapshot(this.state));
      this.state = withHistoryFlags(historySnapshot(nextState), this.past.length > 0, this.future.length > 0);
      this.listeners.forEach((listener) => listener());
      return;
    }

    const before = historySnapshot(this.state);
    const next = copyState(this.state);
    const operationIndex =
      "operationId" in command
        ? next.operations.findIndex((operation) => operation.id === command.operationId)
        : -1;

    switch (command.type) {
      case "media.import": {
        const existingIndex = next.media.findIndex((item) => item.id === command.item.id);
        if (existingIndex >= 0) {
          next.media[existingIndex] = { ...next.media[existingIndex], ...command.item };
        } else {
          next.media.unshift({ ...command.item });
        }
        next.selectedMediaId = command.item.id;
        next.logs.unshift({
          id: `log-${crypto.randomUUID()}`,
          title: "Imported media",
          detail: command.item.name,
          tone: "success",
          timestamp: Date.now(),
        });
        break;
      }
      case "media.select":
        next.selectedMediaId = command.mediaId;
        break;
      case "operation.add": {
        const operation: Operation = {
          id: command.operationId ?? `op-${crypto.randomUUID()}`,
          type: command.operationType,
          enabled: true,
          collapsed: false,
          values: { ...defaultValues[command.operationType], ...command.values },
          lutPath: command.lutPath,
          masks: command.masks?.filter((mask) => mask.mode !== "none").map((mask) => ({ ...mask })),
          mask: undefined,
          source: command.source ?? "user",
          commandText: command.commandText,
        };
        const existingIndex = next.operations.findIndex((item) => item.id === operation.id);
        if (existingIndex >= 0) next.operations[existingIndex] = operation;
        else next.operations.push(operation);
        next.logs.unshift({
          id: `log-${crypto.randomUUID()}`,
          title: `Created ${command.operationType}`,
          detail: command.commandText ?? `Added by ${sourceLabel(command.source)}`,
          tone: command.source === "agent" ? "note" : "change",
          timestamp: Date.now(),
        });
        break;
      }
      case "operation.clear":
        next.operations = [];
        next.logs.unshift({
          id: `log-${crypto.randomUUID()}`,
          title: "Cleared operations",
          detail: command.commandText ?? `Cleared by ${sourceLabel(command.source)}`,
          tone: command.source === "agent" ? "note" : "change",
          timestamp: Date.now(),
        });
        break;
      case "operation.delete":
        if (operationIndex >= 0) next.operations.splice(operationIndex, 1);
        break;
      case "operation.toggle":
        if (operationIndex >= 0) next.operations[operationIndex].enabled = !next.operations[operationIndex].enabled;
        break;
      case "operation.collapse":
        if (operationIndex >= 0) next.operations[operationIndex].collapsed = !next.operations[operationIndex].collapsed;
        break;
      case "operation.update":
        if (operationIndex >= 0) {
          next.operations[operationIndex].values[command.key] = command.value;
          next.operations[operationIndex].source = command.source ?? "user";
        }
        break;
      case "operation.setLutPath":
        if (operationIndex >= 0) {
          next.operations[operationIndex].lutPath = command.lutPath;
          next.operations[operationIndex].source = command.source ?? "user";
          next.logs.unshift({
            id: `log-${crypto.randomUUID()}`,
            title: "Loaded LUT",
            detail: command.lutPath.split(/[\\/]/).pop() ?? command.lutPath,
            tone: command.source === "agent" ? "note" : "change",
            timestamp: Date.now(),
          });
        }
        break;
      case "operation.replaceValues":
        if (operationIndex >= 0) {
          next.operations[operationIndex].values = { ...command.values };
          next.operations[operationIndex].source = command.source ?? "user";
        }
        break;
      case "operation.setMask":
        if (operationIndex >= 0) {
          next.operations[operationIndex].masks = command.mask.mode === "none" ? [] : [{ ...command.mask }];
          next.operations[operationIndex].mask = undefined;
          next.operations[operationIndex].source = command.source ?? "user";
        }
        break;
      case "operation.addMask":
        if (operationIndex >= 0 && command.mask.mode !== "none") {
          next.operations[operationIndex].masks = [
            ...(next.operations[operationIndex].masks ?? []),
            { ...command.mask },
          ];
          next.operations[operationIndex].mask = undefined;
          next.operations[operationIndex].source = command.source ?? "user";
        }
        break;
      case "operation.updateMask":
        if (operationIndex >= 0) {
          const masks = next.operations[operationIndex].masks ?? [];
          if (command.maskIndex >= 0 && command.maskIndex < masks.length) {
            const nextMasks = masks.map((mask, index) => (
              index === command.maskIndex ? { ...command.mask } : { ...mask }
            ));
            next.operations[operationIndex].masks = nextMasks.filter((mask) => mask.mode !== "none");
            next.operations[operationIndex].mask = undefined;
            next.operations[operationIndex].source = command.source ?? "user";
          }
        }
        break;
      case "operation.removeMask":
        if (operationIndex >= 0) {
          next.operations[operationIndex].masks = (next.operations[operationIndex].masks ?? [])
            .filter((_, index) => index !== command.maskIndex);
          next.operations[operationIndex].mask = undefined;
          next.operations[operationIndex].source = command.source ?? "user";
        }
        break;
      case "operation.move": {
        const targetIndex = next.operations.findIndex((operation) => operation.id === command.targetId);
        if (operationIndex >= 0 && targetIndex >= 0 && operationIndex !== targetIndex) {
          const [moved] = next.operations.splice(operationIndex, 1);
          next.operations.splice(targetIndex, 0, moved);
        }
        break;
      }
      case "layer.select":
        next.activeLayerId = command.layerId;
        break;
      case "layer.addMask": {
        const index = next.layers.length + 1;
        const layer: MaskLayer = {
          id: command.layerId ?? `mask-${crypto.randomUUID()}`,
          name: command.layer?.name ?? `${maskShapeLabel(command.layer?.shape)} Mask ${String(index).padStart(2, "0")}`,
          type: "mask",
          shape: command.layer?.shape ?? "ellipse",
          x: command.layer?.x ?? 0.5,
          y: command.layer?.y ?? 0.5,
          width: command.layer?.width ?? 0.46,
          height: command.layer?.height ?? 0.52,
          feather: command.layer?.feather ?? 0.28,
          opacity: command.layer?.opacity ?? 1,
          angle: command.layer?.angle ?? 0,
          points: command.layer?.points?.map((point) => ({ ...point })),
        };
        const existingIndex = next.layers.findIndex((item) => item.id === layer.id);
        if (existingIndex >= 0) next.layers[existingIndex] = layer;
        else next.layers.push(layer);
        next.activeLayerId = layer.id;
        next.logs.unshift({
          id: `log-${crypto.randomUUID()}`,
          title: "Created mask layer",
          detail: layer.name,
          tone: command.source === "agent" ? "note" : "change",
          timestamp: Date.now(),
        });
        break;
      }
      case "layer.updateMask": {
        const layerIndex = next.layers.findIndex((layer) => layer.id === command.layerId);
        if (layerIndex >= 0) {
          next.layers[layerIndex] = {
            ...next.layers[layerIndex],
            ...command.patch,
            type: "mask",
          };
        }
        break;
      }
      case "layer.deleteMask": {
        next.layers = next.layers.filter((layer) => layer.id !== command.layerId);
        if (next.activeLayerId === command.layerId) {
          next.activeLayerId = next.layers[0]?.id ?? null;
        }
        next.operations = next.operations.map((operation) => ({
          ...operation,
          masks: operation.masks?.filter((mask) => mask.layerId !== command.layerId),
          mask: operation.mask?.layerId === command.layerId ? undefined : operation.mask,
        }));
        next.logs.unshift({
          id: `log-${crypto.randomUUID()}`,
          title: "Deleted mask layer",
          detail: command.layerId,
          tone: command.source === "agent" ? "note" : "change",
          timestamp: Date.now(),
        });
        break;
      }
      case "assistant.apply":
        next.logs.unshift({
          id: `log-${crypto.randomUUID()}`,
          title: command.source === "agent" ? "Applied agent commands" : "Applied assistant change",
          detail: command.prompt,
          tone: "note",
          timestamp: Date.now(),
        });
        break;
    }

    next.revision += 1;
    this.past.push(before);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.state = withHistoryFlags(next, this.past.length > 0, false);
    this.listeners.forEach((listener) => listener());
  }
}

export const openGradeClient = new MockOpenGradeClient();
