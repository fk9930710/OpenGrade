export type EditorType =
  | "media"
  | "viewer"
  | "effects"
  | "stack"
  | "mask"
  | "assistant"
  | "scopes";

export type SplitDirection = "row" | "column";

export type AreaNode = {
  kind: "area";
  id: string;
  editor: EditorType;
};

export type SplitNode = {
  kind: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
};

export type LayoutNode = AreaNode | SplitNode;

export type WorkspaceId = "grade" | "mask" | "review";

export type Workspace = {
  id: WorkspaceId;
  name: string;
  layout: LayoutNode;
};

export type MediaItem = {
  id: string;
  name: string;
  resolution: string;
  palette: string;
  sourcePath?: string;
};

export type OperationType =
  | "Exposure"
  | "BasicAdjustments"
  | "WhiteBalance"
  | "ChannelBalance"
  | "HueRange"
  | "Curve"
  | "HSV"
  | "LUT";

export type CommandSource = "user" | "agent" | "system";
export type MaskMode = "none" | "add" | "subtract";

export type MaskReference = {
  layerId: string | null;
  mode: MaskMode;
};

export type MaskPoint = {
  x: number;
  y: number;
};

export type MaskLayer = {
  id: string;
  name: string;
  type: "mask";
  shape: "ellipse" | "rectangle" | "linear" | "polygon";
  x: number;
  y: number;
  width: number;
  height: number;
  feather: number;
  opacity: number;
  angle?: number;
  points?: MaskPoint[];
};

export type Operation = {
  id: string;
  type: OperationType;
  enabled: boolean;
  collapsed: boolean;
  values: Record<string, number>;
  lutPath?: string;
  masks?: MaskReference[];
  /** @deprecated use masks for multi-mask operation applicators. */
  mask?: MaskReference;
  source?: CommandSource;
  commandText?: string;
};

export type AssistantLog = {
  id: string;
  title: string;
  detail: string;
  tone: "success" | "change" | "note";
  timestamp: number;
};

export type ProjectState = {
  projectName: string;
  selectedMediaId: string;
  media: MediaItem[];
  layers: MaskLayer[];
  activeLayerId: string | null;
  operations: Operation[];
  logs: AssistantLog[];
  history: {
    canUndo: boolean;
    canRedo: boolean;
  };
  revision: number;
};

export type Command =
  | { type: "media.import"; item: MediaItem }
  | { type: "media.select"; mediaId: string }
  | {
      type: "operation.add";
      operationId?: string;
      operationType: OperationType;
      values?: Record<string, number>;
      lutPath?: string;
      masks?: MaskReference[];
      source?: CommandSource;
      commandText?: string;
    }
  | { type: "operation.clear"; source?: CommandSource; commandText?: string }
  | { type: "operation.delete"; operationId: string }
  | { type: "operation.toggle"; operationId: string }
  | { type: "operation.collapse"; operationId: string }
  | { type: "operation.update"; operationId: string; key: string; value: number; source?: CommandSource }
  | { type: "operation.setLutPath"; operationId: string; lutPath: string; source?: CommandSource }
  | { type: "operation.replaceValues"; operationId: string; values: Record<string, number>; source?: CommandSource }
  | { type: "operation.addMask"; operationId: string; mask: MaskReference; source?: CommandSource }
  | { type: "operation.updateMask"; operationId: string; maskIndex: number; mask: MaskReference; source?: CommandSource }
  | { type: "operation.removeMask"; operationId: string; maskIndex: number; source?: CommandSource }
  | { type: "operation.setMask"; operationId: string; mask: MaskReference; source?: CommandSource }
  | { type: "operation.move"; operationId: string; targetId: string }
  | { type: "layer.select"; layerId: string | null }
  | { type: "layer.addMask"; layerId?: string; layer?: Partial<Omit<MaskLayer, "id" | "type">>; source?: CommandSource }
  | { type: "layer.updateMask"; layerId: string; patch: Partial<Omit<MaskLayer, "id" | "type">>; source?: CommandSource }
  | { type: "layer.deleteMask"; layerId: string; source?: CommandSource }
  | { type: "history.undo" }
  | { type: "history.redo" }
  | { type: "project.replace"; state: ProjectState; source?: CommandSource }
  | { type: "assistant.apply"; prompt: string; source?: CommandSource };

export interface OpenGradeClient {
  getSnapshot(): ProjectState;
  subscribe(listener: () => void): () => void;
  dispatch(command: Command): Promise<void>;
}
