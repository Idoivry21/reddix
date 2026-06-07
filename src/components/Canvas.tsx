import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeCard } from './NodeCard';
import { getBlockSpec } from '../shared/commandBuilders';
import { canConnect } from '../shared/graph';
import { accentForBlock } from '../blockVisuals';
import { edgePath, nodePorts, type PortPoint } from '../canvasGeometry';
import type { CanvasView, NodeSize, WorkbenchEdge, WorkbenchNode } from '../flowTypes';

const BLOCK_DRAG_MIME = 'application/reddix-block';
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
const GRID_SPACING = 22;
const VIEW_ANIM_MS = 300;

// Category accent hexes (theme-stable: the base accents don't flip in dark mode)
// used to build per-edge source→target gradients.
const ACCENT_HEX: Record<string, string> = {
  reddit: '#ff4500',
  x: '#1b8fe0',
  transform: '#6e56cf',
  output: '#1e9e6a',
  utility: '#8a8577'
};
const ACCENT_KEYS = Object.keys(ACCENT_HEX);

interface CanvasProps {
  nodes: WorkbenchNode[];
  edges: WorkbenchEdge[];
  view: CanvasView;
  setView: (updater: (view: CanvasView) => CanvasView) => void;
  sizes: Record<string, NodeSize>;
  onMeasure: (id: string, w: number, h: number) => void;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onConnect: (source: string, sourcePortId: string, target: string, targetPortId: string) => void;
  onDeleteEdge: (id: string) => void;
  onDropBlock: (blockType: string, x: number, y: number) => void;
  onPaneClick: () => void;
  onFit: () => void;
  onAddBlock: (blockType: string) => void;
  dragType: string | null;
  readOnly?: boolean;
}

type DragState =
  | { mode: 'pan'; startX: number; startY: number; ox: number; oy: number; moved: boolean }
  | { mode: 'node'; id: string; dx: number; dy: number; moved: boolean }
  | { mode: 'wire'; from: string; fromPort: string };

interface TempWire {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export function Canvas(props: CanvasProps) {
  const {
    nodes,
    edges,
    view,
    setView,
    sizes,
    onMeasure,
    selectedNodeId,
    selectedEdgeId,
    onSelectNode,
    onSelectEdge,
    onMoveNode,
    onConnect,
    onDeleteEdge,
    onDropBlock,
    onPaneClick,
    onFit,
    onAddBlock,
    dragType,
    readOnly = false
  } = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const [temp, setTemp] = useState<TempWire | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [hoverPort, setHoverPort] = useState<{ node: string; port: string } | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);

  const toCanvas = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) {
        return { x: clientX, y: clientY };
      }
      return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
    },
    [view.x, view.y, view.k]
  );

  const portPointById = useCallback(
    (nodeId: string, portId: string, kind: 'in' | 'out'): PortPoint | undefined => {
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) {
        return undefined;
      }
      const geometry = nodePorts(node, getBlockSpec(node.blockType), sizes[nodeId]);
      const list = kind === 'in' ? geometry.ins : geometry.outs;
      return list.find((point) => point.id === portId) ?? list[0];
    },
    [nodes, sizes]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const target = (event.target as HTMLElement).closest('[data-role]');
      const role = target?.getAttribute('data-role');

      if (role === 'port-out' && !readOnly) {
        const nodeId = target!.getAttribute('data-node')!;
        const portId = target!.getAttribute('data-port')!;
        const point = portPointById(nodeId, portId, 'out');
        if (point) {
          drag.current = { mode: 'wire', from: nodeId, fromPort: portId };
          setConnecting(true);
          setTemp({ sx: point.x, sy: point.y, tx: point.x, ty: point.y });
          event.preventDefault();
        }
        return;
      }
      if (role === 'drag' && !readOnly) {
        const nodeId = target!.getAttribute('data-id')!;
        const node = nodes.find((item) => item.id === nodeId);
        if (node) {
          const point = toCanvas(event.clientX, event.clientY);
          drag.current = { mode: 'node', id: nodeId, dx: point.x - node.x, dy: point.y - node.y, moved: false };
          onSelectNode(nodeId);
          event.preventDefault();
        }
        return;
      }
      if (role === 'node') {
        onSelectNode(target!.getAttribute('data-id')!);
        return;
      }
      drag.current = { mode: 'pan', startX: event.clientX, startY: event.clientY, ox: view.x, oy: view.y, moved: false };
    },
    [nodes, onSelectNode, portPointById, readOnly, toCanvas, view.x, view.y]
  );

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const state = drag.current;
      if (!state) {
        return;
      }
      if (state.mode === 'pan') {
        const nx = state.ox + (event.clientX - state.startX);
        const ny = state.oy + (event.clientY - state.startY);
        if (Math.abs(event.clientX - state.startX) + Math.abs(event.clientY - state.startY) > 3) {
          state.moved = true;
        }
        setView((current) => ({ ...current, x: nx, y: ny }));
      } else if (state.mode === 'node') {
        const point = toCanvas(event.clientX, event.clientY);
        state.moved = true;
        onMoveNode(state.id, Math.round(point.x - state.dx), Math.round(point.y - state.dy));
      } else {
        const point = toCanvas(event.clientX, event.clientY);
        const element = document.elementFromPoint(event.clientX, event.clientY);
        const portEl = element?.closest('[data-role="port-in"]');
        setHoverPort(
          portEl
            ? { node: portEl.getAttribute('data-node')!, port: portEl.getAttribute('data-port')! }
            : null
        );
        setTemp((current) => (current ? { ...current, tx: point.x, ty: point.y } : current));
      }
    };

    const up = (event: PointerEvent): void => {
      const state = drag.current;
      if (state?.mode === 'wire') {
        const element = document.elementFromPoint(event.clientX, event.clientY);
        const portEl = element?.closest('[data-role="port-in"]');
        if (portEl) {
          const toNode = portEl.getAttribute('data-node')!;
          const toPort = portEl.getAttribute('data-port')!;
          if (toNode !== state.from) {
            onConnect(state.from, state.fromPort, toNode, toPort);
          }
        }
        setTemp(null);
        setHoverPort(null);
        setConnecting(false);
      }
      if (state?.mode === 'pan' && !state.moved) {
        onPaneClick();
      }
      drag.current = null;
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [onConnect, onMoveNode, onPaneClick, setView, toCanvas]);

  // Native non-passive wheel listener so we can preventDefault (React binds
  // wheel passively). Scroll pans; Cmd/Ctrl-scroll zooms toward the cursor.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      const rect = wrap.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        setView((current) => {
          const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * (event.deltaY < 0 ? 1.08 : 0.926)));
          const ratio = k / current.k;
          return { k, x: mx - (mx - current.x) * ratio, y: my - (my - current.y) * ratio };
        });
        return;
      }
      event.preventDefault();
      setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, [setView]);

  const onDrop = useCallback(
    (event: React.DragEvent): void => {
      event.preventDefault();
      if (readOnly) {
        return;
      }
      const blockType = event.dataTransfer.getData(BLOCK_DRAG_MIME) || dragType;
      if (!blockType) {
        return;
      }
      const point = toCanvas(event.clientX, event.clientY);
      onDropBlock(blockType, Math.round(point.x - 110), Math.round(point.y - 40));
    },
    [dragType, onDropBlock, readOnly, toCanvas]
  );

  // Briefly enable a CSS transition on the pan layer for programmatic view
  // changes (fit, toolbar zoom). Live drag/wheel never call this, so they stay 1:1.
  const animateView = useCallback((): void => {
    const el = panRef.current;
    if (!el) {
      return;
    }
    el.classList.add('is-animating');
    window.setTimeout(() => el.classList.remove('is-animating'), VIEW_ANIM_MS);
  }, []);

  const zoomToCenter = useCallback(
    (factor: number): void => {
      const rect = wrapRef.current?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 0;
      const cy = rect ? rect.height / 2 : 0;
      animateView();
      setView((current) => {
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
        const ratio = k / current.k;
        return { k, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
      });
    },
    [animateView, setView]
  );

  const nodeStatusById = useMemo(
    () => Object.fromEntries(nodes.map((node) => [node.id, node.status])),
    [nodes]
  );

  // Accent bucket per node, used to colour each edge with a source→target gradient.
  const accentById = useMemo(
    () =>
      Object.fromEntries(
        nodes.map((node) => {
          const spec = getBlockSpec(node.blockType);
          return [node.id, accentForBlock(spec.provider, spec.category)];
        })
      ) as Record<string, string>,
    [nodes]
  );

  const activeEdges = useMemo(() => {
    const active = new Set<string>();
    for (const edge of edges) {
      if (
        nodeStatusById[edge.source] === 'success' &&
        (nodeStatusById[edge.target] === 'running' || nodeStatusById[edge.target] === 'success')
      ) {
        active.add(edge.id);
      }
    }
    return active;
  }, [edges, nodeStatusById]);

  return (
    <section
      ref={wrapRef}
      className="canvas-wrap"
      aria-label="Flow canvas"
      data-grid="dots"
      data-connecting={connecting ? 'true' : 'false'}
      style={{
        backgroundPosition: `${view.x}px ${view.y}px`,
        backgroundSize: `${GRID_SPACING * view.k}px ${GRID_SPACING * view.k}px`
      }}
      onPointerDown={onPointerDown}
      onDragOver={(event) => {
        if (dragType) {
          event.preventDefault();
        }
      }}
      onDrop={onDrop}
    >
      <div ref={panRef} className="canvas-pan" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="edges-svg" style={{ left: -4000, top: -4000 }}>
          <defs>
            {ACCENT_KEYS.flatMap((src) =>
              ACCENT_KEYS.map((tgt) => (
                <linearGradient key={`${src}-${tgt}`} id={`edge-grad-${src}-${tgt}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor={ACCENT_HEX[src]} />
                  <stop offset="1" stopColor={ACCENT_HEX[tgt]} />
                </linearGradient>
              ))
            )}
          </defs>
          <g transform="translate(4000,4000)">
            {edges.map((edge) => {
              const sourcePoint = portPointById(edge.source, edge.sourcePortId, 'out');
              const targetPoint = portPointById(edge.target, edge.targetPortId, 'in');
              if (!sourcePoint || !targetPoint) {
                return null;
              }
              const d = edgePath(sourcePoint.x, sourcePoint.y, targetPoint.x, targetPoint.y);
              const isActive = activeEdges.has(edge.id);
              const isSelected = selectedEdgeId === edge.id;
              const isHover = hoverEdge === edge.id;
              const mid = { x: (sourcePoint.x + targetPoint.x) / 2, y: (sourcePoint.y + targetPoint.y) / 2 };
              const srcAccent = accentById[edge.source] ?? 'utility';
              const tgtAccent = accentById[edge.target] ?? 'utility';
              const stroke = `url(#edge-grad-${srcAccent}-${tgtAccent})`;
              return (
                <g key={edge.id}>
                  <path className={`edge-glow ${isActive || isSelected ? 'active' : ''}`} d={d} stroke={stroke} />
                  <path
                    className={`edge flow ${isActive ? 'active edge-dash' : ''} ${isSelected ? 'selected' : ''} ${
                      isHover ? 'hover' : ''
                    }`}
                    d={d}
                    stroke={stroke}
                  />
                  <path
                    className="edge-hit"
                    d={d}
                    role="button"
                    tabIndex={readOnly ? -1 : 0}
                    aria-label={`Connection ${edge.source} → ${edge.target}. Press Delete to remove.`}
                    onPointerEnter={() => setHoverEdge(edge.id)}
                    onPointerLeave={() => setHoverEdge((current) => (current === edge.id ? null : current))}
                    onFocus={() => {
                      setHoverEdge(edge.id);
                      onSelectEdge(edge.id);
                    }}
                    onBlur={() => setHoverEdge((current) => (current === edge.id ? null : current))}
                    onKeyDown={(event) => {
                      if (readOnly) {
                        return;
                      }
                      if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault();
                        onDeleteEdge(edge.id);
                      } else if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectEdge(edge.id);
                      }
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onSelectEdge(edge.id);
                    }}
                  />
                  {(hoverEdge === edge.id || isSelected) && !readOnly ? (
                    <g
                      className="edge-del"
                      transform={`translate(${mid.x},${mid.y})`}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        onDeleteEdge(edge.id);
                        setHoverEdge(null);
                      }}
                    >
                      <circle r="9" />
                      <line x1="-3.5" y1="-3.5" x2="3.5" y2="3.5" />
                      <line x1="3.5" y1="-3.5" x2="-3.5" y2="3.5" />
                    </g>
                  ) : null}
                </g>
              );
            })}
            {temp ? <path className="temp-edge" d={edgePath(temp.sx, temp.sy, temp.tx, temp.ty)} /> : null}
          </g>
        </svg>

        {nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            selected={selectedNodeId === node.id}
            onMeasure={onMeasure}
            onSelect={onSelectNode}
          />
        ))}

        {hoverPort
          ? (() => {
              const point = portPointById(hoverPort.node, hoverPort.port, 'in');
              if (!point) {
                return null;
              }
              const wire = drag.current?.mode === 'wire' ? drag.current : null;
              const sourceNode = wire ? nodes.find((n) => n.id === wire.from) : undefined;
              const targetNode = nodes.find((n) => n.id === hoverPort.node);
              const valid =
                wire && sourceNode && targetNode
                  ? canConnect({
                      sourceBlockType: sourceNode.blockType,
                      sourcePortId: wire.fromPort,
                      targetBlockType: targetNode.blockType,
                      targetPortId: hoverPort.port
                    }).valid
                  : true;
              return (
                <div
                  className={`port-target ${valid ? 'ok' : 'bad'}`}
                  style={{ position: 'absolute', left: point.x - 11, top: point.y - 11, width: 22, height: 22 }}
                />
              );
            })()
          : null}
      </div>

      {nodes.length === 0 ? (
        <div className="canvas-empty" role="note">
          <div className="ce-inner">
            <div className="ce-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
                <path d="M10 6.5h2.5a1.5 1.5 0 0 1 1.5 1.5v6" />
              </svg>
            </div>
            <div className="ce-title">Start your flow</div>
            <div className="ce-sub">Drag a block from the left, or add a source to begin.</div>
            {!readOnly ? (
              <button className="btn btn-primary ce-cta" type="button" onClick={() => onAddBlock('reddit.searchPosts')}>
                Add a Reddit source
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="canvas-hint">Drag blocks in · drag a port to wire · scroll to pan · ⌘scroll to zoom</div>

      <div className="canvas-toolbar">
        <button className="tool-btn" title="Zoom out" onClick={() => zoomToCenter(0.88)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        </button>
        <span className="zoom-val">{Math.round(view.k * 100)}%</span>
        <button className="tool-btn" title="Zoom in" onClick={() => zoomToCenter(1.14)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <div className="toolbar-sep" />
        <button
          className="tool-btn"
          title="Fit / reset"
          onClick={() => {
            animateView();
            onFit();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
          </svg>
        </button>
      </div>
    </section>
  );
}
