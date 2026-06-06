import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBlockSpec, getDefaultSettings } from '../shared/commandBuilders';
import { canConnect, validateFlow } from '../shared/graph';
import { getFlow, listFlows, postRun, saveFlow, subscribeRunEvents, type ConsoleState } from '../api';
import {
  DEFAULT_FLOW_ID,
  type CanvasView,
  type NodeSize,
  type NodeStatus,
  type RunStatus,
  type WorkbenchEdge,
  type WorkbenchNode
} from '../flowTypes';
import { createBlockNode } from '../flowFactory';
import { toFlowModel, toFlowRequestBody } from '../flowSerialization';
import { capLogs, runRecordToConsoleState, runStepToConsoleStep } from '../runConsole';
import { createSampleEdges, createSampleNodes, SAMPLE_FLOW_NAME } from '../sampleFlow';
import { cronToIntervalMs } from '../scheduleCadence';
import { DEFAULT_NODE_SIZE } from '../canvasGeometry';
import type { SavedSchedule } from '../components/ScheduleModal';
import type { FlowSummary } from '../components/Dashboard';
import { accentForBlock, type AccentKey } from '../blockVisuals';
import type { PersistedFlow } from '../shared/types';

export type { WorkbenchNode } from '../flowTypes';

const INITIAL_VIEW: CanvasView = { x: 60, y: 40, k: 0.72 };

function emptyConsoleState(): ConsoleState {
  return {
    activeTab: 'Command Trace',
    command: undefined,
    runLabel: 'No runs yet',
    steps: [],
    logs: ['Ready. Press Run flow to execute the flow.'],
    results: [],
    history: []
  };
}

export function useWorkbenchState() {
  const [nodes, setNodes] = useState<WorkbenchNode[]>(createSampleNodes);
  const [edges, setEdges] = useState<WorkbenchEdge[]>(createSampleEdges);
  const [flowName, setFlowName] = useState(SAMPLE_FLOW_NAME);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('reddit-search');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [view, setView] = useState<CanvasView>(INITIAL_VIEW);
  const [sizes, setSizes] = useState<Record<string, NodeSize>>({});

  const [isRunning, setIsRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>({ kind: 'idle', message: 'Ready to run' });
  const [validationMessage, setValidationMessage] = useState('Ready to run');
  const [consoleState, setConsoleState] = useState<ConsoleState>(emptyConsoleState);
  const [consoleHeight, setConsoleHeight] = useState(208);
  const [consoleCollapsed, setConsoleCollapsed] = useState(false);

  const [activeFlowId, setActiveFlowId] = useState(DEFAULT_FLOW_ID);
  const [schedule, setSchedule] = useState<{ enabled: boolean; cron: string }>({ enabled: false, cron: '0 9 * * 1' });
  const [showSchedule, setShowSchedule] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [flowSummaries, setFlowSummaries] = useState<FlowSummary[]>([]);
  const [dragType, setDragType] = useState<string | null>(null);

  const runToken = useRef(0);
  const addCounter = useRef(0);
  // Refs read inside the SSE subscription so a stopped/stale run can't mutate UI.
  const isRunningRef = useRef(false);
  const activeFlowIdRef = useRef(activeFlowId);
  activeFlowIdRef.current = activeFlowId;

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);

  const onMeasure = useCallback((id: string, w: number, h: number) => {
    setSizes((current) => (current[id]?.w === w && current[id]?.h === h ? current : { ...current, [id]: { w, h } }));
  }, []);

  // ----- node / edge operations -----
  const moveNode = useCallback((id: string, x: number, y: number) => {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, x, y } : node)));
  }, []);

  const selectNode = useCallback((id: string) => {
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  }, []);

  const selectEdge = useCallback((id: string) => {
    setSelectedEdgeId(id);
    setSelectedNodeId(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const updateNodeSettings = useCallback((nodeId: string, key: string, value: unknown) => {
    setNodes((current) =>
      current.map((node) => (node.id === nodeId ? { ...node, settings: { ...node.settings, [key]: value } } : node))
    );
  }, []);

  const addBlock = useCallback((blockType: string, x?: number, y?: number) => {
    addCounter.current += 1;
    const position =
      x !== undefined && y !== undefined ? { x, y } : centerOfViewport(view);
    const node = createBlockNode(blockType, position, `${Date.now()}-${addCounter.current}`);
    setNodes((current) => [...current, node]);
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, [view]);

  const dropBlock = useCallback(
    (blockType: string, x: number, y: number) => {
      addBlock(blockType, x, y);
      setDragType(null);
    },
    [addBlock]
  );

  const deleteNode = useCallback((nodeId: string) => {
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setSelectedNodeId((current) => (current === nodeId ? null : current));
  }, []);

  const duplicateNode = useCallback((nodeId: string) => {
    addCounter.current += 1;
    const suffix = addCounter.current;
    setNodes((current) => {
      const source = current.find((node) => node.id === nodeId);
      if (!source) {
        return current;
      }
      const copy: WorkbenchNode = {
        ...source,
        id: `${source.blockType}-${Date.now()}-${suffix}`,
        x: source.x + 40,
        y: source.y + 44,
        settings: { ...source.settings },
        status: 'idle'
      };
      setSelectedNodeId(copy.id);
      return [...current, copy];
    });
  }, []);

  const connect = useCallback(
    (source: string, sourcePortId: string, target: string, targetPortId: string) => {
      const sourceNode = nodes.find((node) => node.id === source);
      const targetNode = nodes.find((node) => node.id === target);
      if (!sourceNode || !targetNode) {
        return;
      }
      const result = canConnect({
        sourceBlockType: sourceNode.blockType,
        sourcePortId,
        targetBlockType: targetNode.blockType,
        targetPortId
      });
      if (!result.valid) {
        setValidationMessage(result.reason);
        return;
      }
      setValidationMessage('Ready to run');
      setEdges((current) => {
        const exists = current.some(
          (edge) => edge.source === source && edge.target === target && edge.targetPortId === targetPortId
        );
        if (exists) {
          return current;
        }
        return [
          ...current,
          { id: `e-${source}-${target}-${targetPortId}-${Date.now()}`, source, sourcePortId, target, targetPortId }
        ];
      });
    },
    [nodes]
  );

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((current) => (current === edgeId ? null : current));
  }, []);

  // ----- viewport fit -----
  const fitView = useCallback(() => {
    if (nodes.length === 0) {
      return;
    }
    const wrap = document.querySelector('.canvas-wrap');
    if (!wrap) {
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const size = sizes[node.id] ?? DEFAULT_NODE_SIZE;
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + size.w);
      maxY = Math.max(maxY, node.y + size.h);
    }
    const rect = wrap.getBoundingClientRect();
    const pad = 80;
    const fit = Math.min((rect.width - pad * 2) / (maxX - minX), (rect.height - pad * 2 - 60) / (maxY - minY));
    const k = Math.max(0.35, Math.min(1.1, fit));
    setView({ k, x: (rect.width - (maxX - minX) * k) / 2 - minX * k, y: pad + 10 - minY * k });
  }, [nodes, sizes]);

  useEffect(() => {
    const id = window.setTimeout(fitView, 80);
    return () => window.clearTimeout(id);
    // Run once on mount to frame the sample flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- live run-step updates over SSE -----
  const nodeTypeById = useMemo(() => Object.fromEntries(nodes.map((node) => [node.id, node.blockType])), [nodes]);
  const nodeTypeByIdRef = useRef(nodeTypeById);
  nodeTypeByIdRef.current = nodeTypeById;

  const setNodeStatus = useCallback((nodeId: string, status: NodeStatus) => {
    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, status } : node)));
  }, []);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      return;
    }
    return subscribeRunEvents({
      onStep: ({ step }) => {
        // Ignore events from a stopped/stale run so Stop and edits aren't undone.
        if (!step || !isRunningRef.current) {
          return;
        }
        const consoleStep = runStepToConsoleStep(step, nodeTypeByIdRef.current[step.blockId]);
        setConsoleState((current) => ({ ...current, steps: upsertStep(current.steps, consoleStep) }));
        setNodeStatus(step.blockId, nodeStatusFromStep(step.status));
      },
      onComplete: ({ run }) => {
        // Only reflect the run the user is actively watching for the open flow.
        if (!isRunningRef.current || run.flowId !== activeFlowIdRef.current) {
          return;
        }
        setConsoleState((current) => runRecordToConsoleState(run, current, nodeTypeByIdRef.current));
        setNodes((current) => applyRunStatuses(current, run));
      }
    });
  }, [setNodeStatus]);

  // ----- run -----
  const runNow = useCallback(async () => {
    const model = toFlowModel(nodes, edges);
    const validation = validateFlow(model);
    if (!validation.valid) {
      const messages = validation.errors.map((error) => error.message);
      setValidationMessage(messages[0] ?? 'Flow is invalid');
      setRunStatus({ kind: 'error', message: `Run blocked: ${messages[0] ?? 'flow is invalid'}` });
      setConsoleState((current) => ({
        ...current,
        activeTab: 'Logs',
        logs: ['Run blocked: flow failed validation', ...messages.map((message) => `• ${message}`)]
      }));
      return;
    }

    const token = ++runToken.current;
    isRunningRef.current = true;
    setIsRunning(true);
    setConsoleCollapsed(false);
    setValidationMessage('Running flow…');
    setRunStatus({ kind: 'running', message: 'Run started' });
    setConsoleState((current) => ({ ...current, activeTab: 'Logs', logs: ['Run started…'] }));
    setNodes((current) => current.map((node) => ({ ...node, status: 'pending' })));

    try {
      const scheduleModel: PersistedFlow['schedule'] = {
        enabled: schedule.enabled,
        intervalMs: schedule.enabled ? cronToIntervalMs(schedule.cron) : undefined
      };
      const body = toFlowRequestBody(nodes, edges, { flowId: activeFlowId, name: flowName, failFast: false }, scheduleModel);
      await saveFlow(activeFlowId, body);
      const run = await postRun(activeFlowId);
      if (runToken.current !== token) {
        return;
      }
      setConsoleState((current) => runRecordToConsoleState(run, current, nodeTypeByIdRef.current));
      setNodes((current) => applyRunStatuses(current, run));
      const ok = run.status === 'success';
      const hasFailedStep = run.steps.some((step) => step.status === 'failed');
      setValidationMessage(ok ? 'Run completed' : 'Run finished with errors');
      setRunStatus(
        ok
          ? { kind: 'success', message: 'Run completed successfully' }
          : { kind: hasFailedStep ? 'error' : 'warning', message: 'Run finished with errors' }
      );
    } catch (error) {
      if (runToken.current !== token) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unexpected run error';
      setValidationMessage('Run failed');
      setRunStatus({ kind: 'error', message: `Run failed: ${message}` });
      setConsoleState((current) => ({ ...current, activeTab: 'Logs', logs: capLogs([`Run failed: ${message}`, ...current.logs]) }));
    } finally {
      if (runToken.current === token) {
        isRunningRef.current = false;
        setIsRunning(false);
      }
    }
  }, [activeFlowId, edges, flowName, nodes, schedule]);

  const stopRun = useCallback(() => {
    runToken.current += 1;
    isRunningRef.current = false;
    setIsRunning(false);
    setRunStatus({ kind: 'idle', message: 'Run stopped' });
    setNodes((current) => current.map((node) => ({ ...node, status: 'idle' })));
    setConsoleState((current) => ({ ...current, logs: capLogs(['■ run stopped by user', ...current.logs]) }));
  }, []);

  const clearConsole = useCallback(() => {
    setConsoleState((current) => ({ ...current, logs: [], steps: [], results: [] }));
  }, []);

  // ----- schedule -----
  const saveSchedule = useCallback(
    async (next: SavedSchedule) => {
      setSchedule({ enabled: next.enabled, cron: next.cron });
      setShowSchedule(false);
      try {
        const body = toFlowRequestBody(
          nodes,
          edges,
          { flowId: activeFlowId, name: flowName, failFast: false },
          { enabled: next.enabled, intervalMs: next.enabled ? next.intervalMs : undefined }
        );
        await saveFlow(activeFlowId, body);
        setRunStatus({ kind: 'idle', message: next.enabled ? 'Schedule saved' : 'Schedule paused' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error';
        setRunStatus({ kind: 'error', message: `Schedule save failed: ${message}` });
      }
    },
    [activeFlowId, edges, flowName, nodes]
  );

  // ----- dashboard -----
  const openDashboard = useCallback(() => {
    setShowDashboard(true);
    listFlows()
      .then((flows) => setFlowSummaries(toFlowSummaries(flows)))
      .catch(() => setFlowSummaries([]));
  }, []);

  const currentSummary = useMemo<FlowSummary>(
    () => ({
      id: activeFlowId,
      name: flowName,
      description: 'Top SaaS posts on Reddit + matching tweets on X, filtered, merged and exported.',
      blocks: nodes.length,
      sources: deriveSources(nodes),
      status: schedule.enabled ? 'scheduled' : 'idle',
      statusLabel: schedule.enabled ? 'Scheduled' : 'Manual'
    }),
    [activeFlowId, flowName, nodes, schedule.enabled]
  );

  const dashboardFlows = useMemo(() => {
    const others = flowSummaries.filter((flow) => flow.id !== activeFlowId);
    return [currentSummary, ...others];
  }, [activeFlowId, currentSummary, flowSummaries]);

  // Load another saved flow into the canvas (rehydrate from the persisted shape).
  const openFlow = useCallback(
    async (flowId: string) => {
      if (flowId === activeFlowId) {
        setShowDashboard(false);
        return;
      }
      try {
        const flow = await getFlow(flowId);
        if (!flow) {
          setRunStatus({ kind: 'error', message: 'Flow not found' });
          return;
        }
        setNodes(rehydrateNodes(flow));
        setEdges(flow.edges.map((edge) => ({ ...edge })));
        setFlowName(flow.name);
        setSchedule({ enabled: flow.schedule?.enabled ?? false, cron: '0 9 * * 1' });
        setActiveFlowId(flow.id);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setConsoleState(emptyConsoleState());
        setShowDashboard(false);
        window.setTimeout(fitView, 60);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error';
        setRunStatus({ kind: 'error', message: `Failed to open flow: ${message}` });
      }
    },
    [activeFlowId, fitView]
  );

  const newFlow = useCallback(() => {
    addCounter.current += 1;
    setActiveFlowId(`flow-${Date.now()}-${addCounter.current}`);
    setNodes([]);
    setEdges([]);
    setFlowName('Untitled flow');
    setSchedule({ enabled: false, cron: '0 9 * * 1' });
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setConsoleState(emptyConsoleState());
    setShowDashboard(false);
  }, []);

  return {
    activeFlowId,
    nodes,
    edges,
    flowName,
    setFlowName,
    selectedNodeId,
    selectedEdgeId,
    selectedNode,
    selectNode,
    selectEdge,
    clearSelection,
    view,
    setView,
    sizes,
    onMeasure,
    fitView,
    moveNode,
    updateNodeSettings,
    addBlock,
    dropBlock,
    deleteNode,
    duplicateNode,
    connect,
    deleteEdge,
    dragType,
    setDragType,
    isRunning,
    runStatus,
    validationMessage,
    setValidationMessage,
    consoleState,
    setConsoleState,
    consoleHeight,
    setConsoleHeight,
    consoleCollapsed,
    setConsoleCollapsed,
    clearConsole,
    runNow,
    stopRun,
    schedule,
    showSchedule,
    setShowSchedule,
    saveSchedule,
    showDashboard,
    setShowDashboard,
    openDashboard,
    dashboardFlows,
    openFlow,
    newFlow
  };
}

function rehydrateNodes(flow: PersistedFlow): WorkbenchNode[] {
  return flow.nodes.map((node) => {
    const position = flow.nodePositions[node.id] ?? { x: 0, y: 0 };
    const settings = flow.blockSettings[node.id] ?? node.settings ?? getDefaultSettings(node.type);
    return {
      id: node.id,
      blockType: node.type,
      label: getBlockSpec(node.type).label,
      x: position.x,
      y: position.y,
      settings: { ...settings },
      status: 'idle'
    };
  });
}

function centerOfViewport(view: CanvasView): { x: number; y: number } {
  const wrap = document.querySelector('.canvas-wrap');
  if (!wrap) {
    return { x: 200, y: 160 };
  }
  const rect = wrap.getBoundingClientRect();
  return {
    x: Math.round((rect.width / 2 - view.x) / view.k - 110),
    y: Math.round((rect.height / 2 - view.y) / view.k - 40)
  };
}

function deriveSources(nodes: WorkbenchNode[]): AccentKey[] {
  const sources = new Set<AccentKey>();
  for (const node of nodes) {
    const spec = getBlockSpec(node.blockType);
    const accent = accentForBlock(spec.provider, spec.category);
    if (accent === 'reddit' || accent === 'x') {
      sources.add(accent);
    }
  }
  return [...sources];
}

function toFlowSummaries(flows: PersistedFlow[]): FlowSummary[] {
  return flows.map((flow) => {
    const sources = new Set<AccentKey>();
    for (const node of flow.nodes) {
      if (node.type.startsWith('reddit.')) {
        sources.add('reddit');
      } else if (node.type.startsWith('twitter.')) {
        sources.add('x');
      }
    }
    return {
      id: flow.id,
      name: flow.name,
      description: `${flow.nodes.length} blocks across ${[...sources].join(', ') || 'local'} sources.`,
      blocks: flow.nodes.length,
      sources: [...sources],
      status: flow.schedule?.enabled ? 'scheduled' : 'idle',
      statusLabel: flow.schedule?.enabled ? 'Scheduled' : 'Manual',
    } satisfies FlowSummary;
  });
}

function nodeStatusFromStep(status: 'success' | 'failed' | 'skipped' | 'running'): NodeStatus {
  if (status === 'failed') {
    return 'error';
  }
  if (status === 'skipped') {
    return 'idle';
  }
  return status === 'running' ? 'running' : 'success';
}

function applyRunStatuses(
  nodes: WorkbenchNode[],
  run: { steps: Array<{ blockId: string; status: 'success' | 'failed' | 'skipped' | 'running' }> }
): WorkbenchNode[] {
  const byId = new Map(run.steps.map((step) => [step.blockId, nodeStatusFromStep(step.status)]));
  return nodes.map((node) => {
    const next = byId.get(node.id) ?? 'idle';
    return node.status === next ? node : { ...node, status: next };
  });
}

function upsertStep(steps: ConsoleState['steps'], next: ConsoleState['steps'][number]): ConsoleState['steps'] {
  const index = steps.findIndex((step) => step.id === next.id);
  if (index === -1) {
    return [...steps, next];
  }
  return steps.map((step, position) => (position === index ? next : step));
}
