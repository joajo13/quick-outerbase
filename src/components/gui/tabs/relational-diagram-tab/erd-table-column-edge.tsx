import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  InternalNode,
  Node,
  Position,
  useInternalNode,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { useEdgeFocusState } from "./erd-focus";

const EDGE_REST = "#9aa0a6";
const EDGE_HILITE = "#1ded83";

// returns the position (top,right,bottom or right) passed node compared to
function getParams(
  nodeA: InternalNode<Node>,
  nodeB: InternalNode<Node>,
  columnId: string | undefined | null
): {
  x: number;
  y: number;
  position: Position;
} {
  const centerA = getNodeCenter(nodeA);
  const centerB = getNodeCenter(nodeB);

  const position = centerA.x > centerB.x ? Position.Left : Position.Right;

  const { x, y } = getHandleCoordsByPosition(nodeA, position, columnId);
  return { x, y, position };
}

function getHandleCoordsByPosition(
  node: InternalNode<Node>,
  handlePosition: Position,
  columnId: string | undefined | null
): {
  x: number;
  y: number;
} {
  if (
    !node.internals.handleBounds ||
    !node.internals.handleBounds.source ||
    !node.internals.handleBounds.target
  ) {
    return {
      x: node.internals.positionAbsolute.x,
      y: node.internals.positionAbsolute.y,
    };
  }

  let handle: Handle | undefined;

  // According to erd-table-column.tsx, handle left type is target and right type is source
  switch (handlePosition) {
    case Position.Left:
      handle = node.internals.handleBounds.target.find(
        (h) => h.id === columnId
      );
      break;
    case Position.Right:
      handle = node.internals.handleBounds.source.find(
        (h) => h.id === columnId
      );
      break;
  }

  if (!handle) {
    return {
      x: node.internals.positionAbsolute.x,
      y: node.internals.positionAbsolute.y,
    };
  }

  let offsetX = handle.width / 2;
  let offsetY = handle.height / 2;

  // this is a tiny detail to make the markerEnd of an edge visible.
  // The handle position that gets calculated has the origin top-left, so depending which side we are using, we add a little offset
  // when the handlePosition is Position.Right for example, we need to add an offset as big as the handle itself in order to get the correct position
  switch (handlePosition) {
    case Position.Left:
      offsetX = 0;
      break;
    case Position.Right:
      offsetX = handle.width;
      break;
    case Position.Top:
      offsetY = 0;
      break;
    case Position.Bottom:
      offsetY = handle.height;
      break;
  }

  const x = node.internals.positionAbsolute.x + handle.x + offsetX;
  const y = node.internals.positionAbsolute.y + handle.y + offsetY;

  return {
    x,
    y,
  };
}

function getNodeCenter(node: InternalNode<Node>): {
  x: number;
  y: number;
} {
  return {
    x: node.internals.positionAbsolute.x + (node.measured?.width ?? 0) / 2,
    y: node.internals.positionAbsolute.y + (node.measured?.height ?? 0) / 2,
  };
}

export function getEdgeParams(
  source: InternalNode<Node>,
  target: InternalNode<Node>,
  sourceColumnId: string | undefined | null,
  targetColumnId: string | undefined | null
): {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourcePos: Position;
  targetPos: Position;
} {
  const {
    x: sx,
    y: sy,
    position: sourcePos,
  } = getParams(source, target, sourceColumnId);
  const {
    x: tx,
    y: ty,
    position: targetPos,
  } = getParams(target, source, targetColumnId);

  return {
    sx,
    sy,
    tx,
    ty,
    sourcePos,
    targetPos,
  };
}

interface ERDSchemaNodeColumnEdgeProps extends Edge {}

export default function ERDTableColumnEdge({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
}: EdgeProps<ERDSchemaNodeColumnEdgeProps>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const [hover, setHover] = useState(false);
  const focusState = useEdgeFocusState(id);

  if (!sourceNode || !targetNode) {
    return null;
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode,
    sourceHandleId,
    targetHandleId
  );

  const [edgePath] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
    targetX: tx,
    targetY: ty,
  });

  // El edge se resalta por hover o por foco activo ("on"); se atenúa si hay un
  // foco activo en otra parte del diagrama ("dim").
  const on = hover || focusState === "on";
  const dim = focusState === "dim";
  const color = on ? EDGE_HILITE : EDGE_REST;

  // Cardinalidad: lado FK (source) = "muchos" (N), lado PK (target) = "uno" (1).
  const badge = (
    x: number,
    y: number,
    text: string,
    show: boolean
  ) => (
    <div
      style={{
        position: "absolute",
        transform: `translate(-50%,-50%) translate(${x}px,${y}px)`,
        pointerEvents: "none",
        fontSize: 10,
        fontWeight: 700,
        color: EDGE_HILITE,
        opacity: show ? 1 : 0,
        transition: "opacity 150ms",
      }}
      className="nodrag nopan"
    >
      {text}
    </div>
  );

  return (
    <>
      {/* path ancho invisible para detectar hover cómodamente */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ pointerEvents: "stroke" }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: on ? 2 : 1.5,
          opacity: dim ? 0.15 : 1,
          transition: "stroke 150ms, opacity 150ms",
        }}
      />
      <EdgeLabelRenderer>
        {badge(sx, sy, "N", on)}
        {badge(tx, ty, "1", on)}
      </EdgeLabelRenderer>
    </>
  );
}
