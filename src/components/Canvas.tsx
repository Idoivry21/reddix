import { useCallback, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type NodeChange,
  type OnNodesChange,
  type OnEdgesChange
} from '@xyflow/react';
import { BlockNode } from './BlockNode';
import type { WorkbenchNode, WorkbenchNodeData } from '../flowTypes';
import { canConnect } from '../shared/graph';
import { getBlockSpec, getDefaultSettings } from '../shared/commandBuilders';

const nodeTypes = { workbenchBlock: BlockNode };

interface CanvasProps {
  nodes: WorkbenchNode[];
  edges: Edge[];
  setNodes: React.Dispatch<React.SetStateAction<WorkbenchNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onNodesChange: OnNodesChange<WorkbenchNode>;
  onEdgesChange: OnEdgesChange;
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  setValidationMessage: (message: string) => void;
  readOnly?: boolean;
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({
  nodes,
  edges,
  setNodes,
  setEdges,
  onNodesChange: onNodesChangeBase,
  onEdgesChange,
  onSelectNode,
  setValidationMessage,
  readOnly = false
}: CanvasProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [history, setHistory] = useState<Array<{ nodes: WorkbenchNode[]; edges: Edge[] }>>([]);
  const [future, setFuture] = useState<Array<{ nodes: WorkbenchNode[]; edges: Edge[] }>>([]);

  const pushHistory = useCallback(() => {
    setHistory((items) => [...items.slice(-20), { nodes, edges }]);
    setFuture([]);
  }, [edges, nodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange<WorkbenchNode>[]) => {
      if (changes.some((change) => change.type !== 'select')) {
        pushHistory();
      }
      onNodesChangeBase(changes);
    },
    [onNodesChangeBase, pushHistory]
  );

  const isValidConnection: IsValidConnection<Edge> = useCallback(
    (connection: Connection | Edge) => {
      const source = nodes.find((node) => node.id === connection.source);
      const target = nodes.find((node) => node.id === connection.target);
      if (!source || !target || !connection.sourceHandle || !connection.targetHandle) {
        return false;
      }
      const result = canConnect({
        sourceBlockType: source.data.blockType,
        sourcePortId: connection.sourceHandle,
        targetBlockType: target.data.blockType,
        targetPortId: connection.targetHandle
      });
      setValidationMessage(result.valid ? 'Ready to run' : result.reason);
      return result.valid;
    },
    [nodes, setValidationMessage]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) {
        return;
      }
      pushHistory();
      setEdges((existing) => addEdge({ ...connection, type: 'smoothstep' }, existing));
    },
    [isValidConnection, pushHistory, setEdges]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (readOnly) {
        return;
      }
      const blockType = event.dataTransfer.getData('application/reddix-block');
      if (!blockType) {
        return;
      }
      const spec = getBlockSpec(blockType);
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const node: WorkbenchNode = {
        id: `${blockType}-${Date.now()}`,
        type: 'workbenchBlock',
        position,
        data: {
          blockType,
          label: spec.label,
          settings: getDefaultSettings(blockType),
          status: 'idle'
        } satisfies WorkbenchNodeData
      };
      pushHistory();
      setNodes((current) => [...current, node]);
      onSelectNode(node.id);
    },
    [onSelectNode, pushHistory, readOnly, screenToFlowPosition, setNodes]
  );

  const selectedIds = useMemo(() => nodes.filter((node) => node.selected).map((node) => node.id), [nodes]);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) {
      return;
    }
    setFuture((items) => [{ nodes, edges }, ...items]);
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setHistory((items) => items.slice(0, -1));
  }, [edges, history, nodes, setEdges, setNodes]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) {
      return;
    }
    setHistory((items) => [...items, { nodes, edges }]);
    setNodes(next.nodes);
    setEdges(next.edges);
    setFuture((items) => items.slice(1));
  }, [edges, future, nodes, setEdges, setNodes]);

  const duplicateSelection = useCallback(() => {
    if (!selectedIds.length) {
      return;
    }
    pushHistory();
    setNodes((current) => [
      ...current,
      ...current
        .filter((node) => selectedIds.includes(node.id))
        .map((node) => ({
          ...node,
          id: `${node.id}-copy-${Date.now()}`,
          selected: false,
          position: { x: node.position.x + 32, y: node.position.y + 32 }
        }))
    ]);
  }, [pushHistory, selectedIds, setNodes]);

  const deleteSelection = useCallback(() => {
    if (!selectedIds.length) {
      return;
    }
    pushHistory();
    setNodes((current) => current.filter((node) => !selectedIds.includes(node.id)));
    setEdges((current) => current.filter((edge) => !selectedIds.includes(edge.source) && !selectedIds.includes(edge.target)));
  }, [pushHistory, selectedIds, setEdges, setNodes]);

  return (
    <section
      className="canvas-shell"
      ref={wrapperRef}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={onDrop}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === '0') {
          fitView();
          return;
        }
        if (readOnly) {
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
          event.shiftKey ? redo() : undo();
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
          duplicateSelection();
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          deleteSelection();
        }
      }}
      tabIndex={0}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesFocusable={!readOnly}
        multiSelectionKeyCode={readOnly ? null : ['Meta', 'Control', 'Shift']}
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
      >
        <Background gap={18} size={1} color="#d9dee8" />
        <Controls position="bottom-left" />
        <MiniMap zoomable pannable position="bottom-right" nodeStrokeWidth={3} />
      </ReactFlow>
      {nodes.length === 0 ? (
        <div className="canvas-empty" role="note">
          <strong>Empty canvas</strong>
          <p>Add a block from the palette (drag, click, or Enter) to start building a flow.</p>
        </div>
      ) : null}
    </section>
  );
}
