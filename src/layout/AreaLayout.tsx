import React, { useEffect, useRef, useState } from "react";
import { EditorContent, editorDefinitions } from "../editors/Editors";
import type {
  AreaNode,
  EditorType,
  LayoutNode,
  SplitDirection,
} from "../types";

type LayoutActions = {
  changeEditor(areaId: string, editor: EditorType): void;
  split(areaId: string, direction: SplitDirection, ratio?: number): void;
  close(areaId: string): void;
  resize(splitId: string, ratio: number): void;
  swap(sourceId: string, targetId: string): void;
  maximize(areaId: string): void;
};

type AreaLayoutProps = {
  node: LayoutNode;
  maximizedArea: string | null;
  areaCount: number;
  actions: LayoutActions;
  onAreaHover(areaId: string | null): void;
};

function findArea(node: LayoutNode, id: string): AreaNode | null {
  if (node.kind === "area") return node.id === id ? node : null;
  return findArea(node.first, id) ?? findArea(node.second, id);
}

export function AreaLayout(props: AreaLayoutProps) {
  if (props.maximizedArea) {
    const area = findArea(props.node, props.maximizedArea);
    if (area) {
      return (
        <Area
          {...props}
          node={area}
          isMaximized
        />
      );
    }
  }

  return <LayoutNodeView {...props} />;
}

function LayoutNodeView(props: AreaLayoutProps) {
  const { node } = props;
  if (node.kind === "area") return <Area {...props} node={node} isMaximized={false} />;

  return (
    <Split
      node={node}
      onResize={(ratio) => props.actions.resize(node.id, ratio)}
    >
      <LayoutNodeView {...props} node={node.first} />
      <LayoutNodeView {...props} node={node.second} />
    </Split>
  );
}

function Split({
  node,
  onResize,
  children,
}: {
  node: Extract<LayoutNode, { kind: "split" }>;
  onResize(ratio: number): void;
  children: [React.ReactNode, React.ReactNode];
}) {
  const ref = useRef<HTMLDivElement>(null);

  function beginResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    element.classList.add("dragging");

    const onMove = (moveEvent: PointerEvent) => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const ratio =
        node.direction === "row"
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height;
      onResize(ratio);
    };
    const onUp = () => {
      element.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div ref={ref} className={`split split-${node.direction}`}>
      <div className="split-child" style={{ flexBasis: `calc(${node.ratio * 100}% - 2px)` }}>{children[0]}</div>
      <div className="split-divider" onPointerDown={beginResize} />
      <div className="split-child" style={{ flexBasis: `calc(${(1 - node.ratio) * 100}% - 2px)` }}>{children[1]}</div>
    </div>
  );
}

function Area({
  node,
  actions,
  areaCount,
  onAreaHover,
  isMaximized,
}: Omit<AreaLayoutProps, "node"> & { node: AreaNode; isMaximized: boolean }) {
  const areaRef = useRef<HTMLElement>(null);
  const splitPreviewRef = useRef<{ direction: SplitDirection; ratio: number } | null>(null);
  const [editorMenu, setEditorMenu] = useState(false);
  const [areaMenu, setAreaMenu] = useState(false);
  const [splitPreview, setSplitPreview] = useState<{ direction: SplitDirection; ratio: number } | null>(null);
  const definition = editorDefinitions[node.editor];

  useEffect(() => {
    if (!editorMenu && !areaMenu) return;
    const close = () => {
      setEditorMenu(false);
      setAreaMenu(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [editorMenu, areaMenu]);

  function beginCornerSplit(event: React.PointerEvent<HTMLButtonElement>) {
    if (isMaximized || !areaRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = areaRef.current.getBoundingClientRect();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("is-corner-splitting");

    const calculatePreview = (clientX: number, clientY: number) => {
      const horizontalDistance = Math.max(0, clientX - rect.left);
      const verticalDistance = Math.max(0, clientY - rect.top);
      if (Math.max(horizontalDistance, verticalDistance) < 10) return null;

      const direction: SplitDirection =
        horizontalDistance >= verticalDistance ? "row" : "column";
      const rawRatio =
        direction === "row"
          ? horizontalDistance / rect.width
          : verticalDistance / rect.height;
      return {
        direction,
        ratio: Math.min(0.82, Math.max(0.18, rawRatio)),
      };
    };

    const onMove = (moveEvent: PointerEvent) => {
      const preview = calculatePreview(moveEvent.clientX, moveEvent.clientY);
      splitPreviewRef.current = preview;
      setSplitPreview(preview);
    };
    const onUp = (upEvent: PointerEvent) => {
      const preview =
        calculatePreview(upEvent.clientX, upEvent.clientY) ??
        splitPreviewRef.current;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-corner-splitting");
      splitPreviewRef.current = null;
      setSplitPreview(null);
      if (preview) actions.split(node.id, preview.direction, preview.ratio);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <section
      ref={areaRef}
      className={`area editor-${node.editor} ${isMaximized ? "maximized-area" : ""}`}
      data-area-id={node.id}
      onMouseEnter={() => onAreaHover(node.id)}
      onMouseLeave={() => onAreaHover(null)}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/opengrade-area")) {
          event.preventDefault();
          event.currentTarget.classList.add("swap-target");
        }
      }}
      onDragLeave={(event) => event.currentTarget.classList.remove("swap-target")}
      onDrop={(event) => {
        event.currentTarget.classList.remove("swap-target");
        const sourceId = event.dataTransfer.getData("application/opengrade-area");
        if (sourceId && sourceId !== node.id) actions.swap(sourceId, node.id);
      }}
    >
      {!isMaximized && (
        <button
          className="corner-split-origin"
          aria-label="Drag to split area"
          title="Drag right or down to split"
          onPointerDown={beginCornerSplit}
        >
          <span aria-hidden="true">＋</span>
        </button>
      )}

      <header
        className="area-header"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("application/opengrade-area", node.id);
          event.dataTransfer.effectAllowed = "move";
        }}
      >
        <div className="editor-switcher-wrap">
          <button
            className="editor-switcher"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setEditorMenu((value) => !value)}
            aria-label={`Editor: ${definition.label}`}
            aria-expanded={editorMenu}
          >
            <span>{definition.icon}</span>
            <strong>{definition.label}</strong>
            <i>⌄</i>
          </button>
          {editorMenu && (
            <div className="editor-menu" onPointerDown={(event) => event.stopPropagation()}>
              <div className="menu-label">EDITOR TYPE</div>
              {(Object.entries(editorDefinitions) as [EditorType, typeof definition][]).map(([type, item]) => (
                <button
                  className={type === node.editor ? "selected" : ""}
                  key={type}
                  onClick={() => {
                    actions.changeEditor(node.id, type);
                    setEditorMenu(false);
                  }}
                >
                  <span>{item.icon}</span><strong>{item.label}</strong>
                  {type === node.editor && <i>✓</i>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="area-header-center">
          {isMaximized && <span>MAXIMIZED · CTRL SPACE TO RESTORE</span>}
        </div>

        <div className="area-actions">
          <button
            className="maximize-button"
            title={isMaximized ? "Restore area (Ctrl Space)" : "Maximize area (Ctrl Space)"}
            onClick={() => actions.maximize(node.id)}
          >
            {isMaximized ? "⊙" : "⌗"}
          </button>
          <div className="area-menu-wrap">
            <button
              aria-label="Area options"
              aria-expanded={areaMenu}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setAreaMenu((value) => !value)}
            >•••</button>
            {areaMenu && (
              <div className="area-menu" onPointerDown={(event) => event.stopPropagation()}>
                <button onClick={() => actions.split(node.id, "row")}><span>◫</span>Split left / right</button>
                <button onClick={() => actions.split(node.id, "column")}><span>⊟</span>Split top / bottom</button>
                <button onClick={() => actions.maximize(node.id)}><span>⌗</span>{isMaximized ? "Restore area" : "Maximize area"}<kbd>⌃ Space</kbd></button>
                <div className="menu-separator" />
                <button
                  className="danger"
                  disabled={areaCount <= 1}
                  onClick={() => actions.close(node.id)}
                ><span>×</span>Close area</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="area-content">
        <EditorContent type={node.editor} areaId={node.id} />
      </div>

      {splitPreview && (
        <div
          className={`split-gesture-preview split-gesture-${splitPreview.direction}`}
          style={
            splitPreview.direction === "row"
              ? { left: `${splitPreview.ratio * 100}%` }
              : { top: `${splitPreview.ratio * 100}%` }
          }
        >
          <span>{Math.round(splitPreview.ratio * 100)}%</span>
        </div>
      )}

      <button
        className="corner-split-handle"
        title="Split area"
        onClick={() => actions.split(node.id, "row")}
      />
    </section>
  );
}
