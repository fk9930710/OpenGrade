import type {
  AreaNode,
  EditorType,
  LayoutNode,
  SplitDirection,
  Workspace,
  WorkspaceId,
} from "../types";

const area = (id: string, editor: EditorType): AreaNode => ({
  kind: "area",
  id,
  editor,
});

export const defaultWorkspaces: Record<WorkspaceId, Workspace> = {
  grade: {
    id: "grade",
    name: "Grade",
    layout: {
      kind: "split",
      id: "grade-root",
      direction: "row",
      ratio: 0.18,
      first: area("grade-media", "media"),
      second: {
        kind: "split",
        id: "grade-main",
        direction: "row",
        ratio: 0.68,
        first: {
          kind: "split",
          id: "grade-center",
          direction: "column",
          ratio: 0.7,
          first: area("grade-viewer", "viewer"),
          second: area("grade-effects", "effects"),
        },
        second: {
          kind: "split",
          id: "grade-right",
          direction: "column",
          ratio: 0.61,
          first: area("grade-stack", "stack"),
          second: area("grade-assistant", "assistant"),
        },
      },
    },
  },
  mask: {
    id: "mask",
    name: "Mask",
    layout: {
      kind: "split",
      id: "mask-root",
      direction: "row",
      ratio: 0.72,
      first: area("mask-viewer", "viewer"),
      second: {
        kind: "split",
        id: "mask-right",
        direction: "column",
        ratio: 0.52,
        first: area("mask-tools", "mask"),
        second: area("mask-stack", "stack"),
      },
    },
  },
  review: {
    id: "review",
    name: "Review",
    layout: {
      kind: "split",
      id: "review-root",
      direction: "column",
      ratio: 0.76,
      first: area("review-viewer", "viewer"),
      second: {
        kind: "split",
        id: "review-bottom",
        direction: "row",
        ratio: 0.65,
        first: area("review-scopes", "scopes"),
        second: area("review-assistant", "assistant"),
      },
    },
  },
};

export function cloneLayout<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function mapLayout(
  node: LayoutNode,
  updater: (areaNode: AreaNode) => LayoutNode,
): LayoutNode {
  if (node.kind === "area") return updater(node);
  return {
    ...node,
    first: mapLayout(node.first, updater),
    second: mapLayout(node.second, updater),
  };
}

export function updateEditor(
  node: LayoutNode,
  areaId: string,
  editor: EditorType,
): LayoutNode {
  return mapLayout(node, (areaNode) =>
    areaNode.id === areaId ? { ...areaNode, editor } : areaNode,
  );
}

export function splitArea(
  node: LayoutNode,
  areaId: string,
  direction: SplitDirection,
  ratio = 0.5,
): LayoutNode {
  return mapLayout(node, (areaNode) => {
    if (areaNode.id !== areaId) return areaNode;
    return {
      kind: "split",
      id: `split-${crypto.randomUUID()}`,
      direction,
      ratio: Math.min(0.82, Math.max(0.18, ratio)),
      first: areaNode,
      second: {
        ...areaNode,
        id: `area-${crypto.randomUUID()}`,
      },
    };
  });
}

export function closeArea(node: LayoutNode, areaId: string): LayoutNode | null {
  if (node.kind === "area") return node.id === areaId ? null : node;
  const first = closeArea(node.first, areaId);
  const second = closeArea(node.second, areaId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

export function updateRatio(
  node: LayoutNode,
  splitId: string,
  ratio: number,
): LayoutNode {
  if (node.kind === "area") return node;
  return {
    ...node,
    ratio: node.id === splitId ? Math.min(0.82, Math.max(0.18, ratio)) : node.ratio,
    first: updateRatio(node.first, splitId, ratio),
    second: updateRatio(node.second, splitId, ratio),
  };
}

export function swapEditors(
  node: LayoutNode,
  firstId: string,
  secondId: string,
): LayoutNode {
  let firstEditor: EditorType | undefined;
  let secondEditor: EditorType | undefined;
  mapLayout(node, (areaNode) => {
    if (areaNode.id === firstId) firstEditor = areaNode.editor;
    if (areaNode.id === secondId) secondEditor = areaNode.editor;
    return areaNode;
  });
  if (!firstEditor || !secondEditor) return node;
  return mapLayout(node, (areaNode) => {
    if (areaNode.id === firstId) return { ...areaNode, editor: secondEditor! };
    if (areaNode.id === secondId) return { ...areaNode, editor: firstEditor! };
    return areaNode;
  });
}

export function countAreas(node: LayoutNode): number {
  if (node.kind === "area") return 1;
  return countAreas(node.first) + countAreas(node.second);
}
