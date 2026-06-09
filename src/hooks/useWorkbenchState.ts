import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBlockSpec, getDefaultSettings } from '../shared/commandBuilders';
import { canConnect, validateFlow } from '../shared/graph';
import {
  deleteFlow,
  getFlow,
  listFlows,
  listRuns,
  postRun,
  postRunNode,
  saveFlow,
  subscribeRunEvents,
  type ConsoleHistoryEntry,
  type ConsoleState,
  type RunNodeMode
} from '../api';
import {
  DEFAULT_FLOW_ID,
  type CanvasView,
  type NodeIoPreview,
  type NodeSize,
  type NodeStatus,
  type RunStatus,
  type WorkbenchEdge,
  type WorkbenchNode
} from '../flowTypes';
import { createBlockNode } from '../flowFactory';
import { toFlowModel, toFlowRequestBody } from '../flowSerialization';
import { byStartedAtDesc, capLogs, MAX_HISTORY_ENTRIES, runRecordToConsoleState, runsToHistoryEntries, toConsoleStep } from '../runConsole';
import { createSampleEdges, createSampleNodes, SAMPLE_FLOW_NAME } from '../sampleFlow';
import { cronToIntervalMs } from '../scheduleCadence';
import { CANVAS_GEOMETRY, DEFAULT_NODE_SIZE, resolveSplicePorts } from '../canvasGeometry';
import type { SavedSchedule } from '../components/ScheduleModal';
import type { FlowSummary } from '../components/Dashboard';
import { accentForBlock, type AccentKey } from '../blockVisuals';
import type { PersistedFlow, RunRecord } from '../shared/types';
import { useToasts, type ToastKind } from './useToasts';

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

  // Per-node I/O preview for the card badges + Inspector panel, keyed by node id.
  // Updated (merged) as runs complete so a single-node run refreshes only its node
  // while the rest keep their last result.
  const [nodeIoPreview, setNodeIoPreview] = useState<Record<string, NodeIoPreview>>({});
  // The last FULL-flow run — the source of cached upstream samples for a
  // cached-upstream single-node run. Single-node runs never update it.
  const [lastFullRun, setLastFullRun] = useState<RunRecord | null>(null);

  const [activeFlowId, setActiveFlowId] = useState(DEFAULT_FLOW_ID);
  const [schedule, setSchedule] = useState<{ enabled: boolean; cron: string }>({ enabled: false, cron: '0 9 * * 1' });
  const [showSchedule, setShowSchedule] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [flowSummaries, setFlowSummaries] = useState<FlowSummary[]>([]);
  const [dragType, setDragType] = useState<string | null>(null);

  const { toasts, pushToast, dismissToast } = useToasts();

  const runToken = useRef(0);
  const addCounter = useRef(0);
  // Refs read inside the SSE subscription so a stopped/stale run can't mutate UI.
  const isRunningRef = useRef(false);
  const activeFlowIdRef = useRef(activeFlowId);
  activeFlowIdRef.current = activeFlowId;

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);

  // Node ids whose last full run produced cached output — the candidates a
  // cached-upstream single-node run can feed from.
  const cachedOutputNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const step of lastFullRun?.steps ?? []) {
      if ((step.io?.outputCount ?? 0) > 0) {
        ids.add(step.blockId);
      }
    }
    return ids;
  }, [lastFullRun]);

  const hasUpstream = useCallback(
    (nodeId: string) => edges.some((edge) => edge.target === nodeId),
    [edges]
  );

  const hasCachedUpstream = useCallback(
    (nodeId: string) => edges.some((edge) => edge.target === nodeId && cachedOutputNodeIds.has(edge.source)),
    [edges, cachedOutputNodeIds]
  );

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
        pushToast(result.reason, 'error');
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
    [nodes, pushToast]
  );

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((current) => (current === edgeId ? null : current));
  }, []);

  // Drop a node into the middle of an edge: remove source→target and rewire as
  // source→node→target, reusing each block's compatible ports. No-op (with a
  // toast) when the node can't bridge the two — the canvas only offers a splice
  // for valid pairs, so this is the defensive backstop.
  const spliceNodeIntoEdge = useCallback(
    (nodeId: string, edgeId: string) => {
      const edge = edges.find((item) => item.id === edgeId);
      if (!edge || nodeId === edge.source || nodeId === edge.target) {
        return;
      }
      const sourceNode = nodes.find((node) => node.id === edge.source);
      const targetNode = nodes.find((node) => node.id === edge.target);
      const draggedNode = nodes.find((node) => node.id === nodeId);
      if (!sourceNode || !targetNode || !draggedNode) {
        return;
      }
      const ports = resolveSplicePorts({
        sourceBlockType: sourceNode.blockType,
        sourcePortId: edge.sourcePortId,
        nodeBlockType: draggedNode.blockType,
        targetBlockType: targetNode.blockType,
        targetPortId: edge.targetPortId
      });
      if (!ports) {
        pushToast(`${draggedNode.label} can't splice into this connection`, 'error');
        return;
      }
      const stamp = Date.now();
      const additions: WorkbenchEdge[] = [
        {
          id: `e-${edge.source}-${nodeId}-${ports.inPortId}-${stamp}`,
          source: edge.source,
          sourcePortId: edge.sourcePortId,
          target: nodeId,
          targetPortId: ports.inPortId
        },
        {
          id: `e-${nodeId}-${edge.target}-${edge.targetPortId}-${stamp}`,
          source: nodeId,
          sourcePortId: ports.outPortId,
          target: edge.target,
          targetPortId: edge.targetPortId
        }
      ];
      setEdges((current) => {
        const next = current.filter((item) => item.id !== edgeId);
        // Mirror connect's dedup: skip an addition whose source/target/targetPortId
        // already exists so a pre-existing node edge is preserved, not duplicated.
        const fresh = additions.filter(
          (addition) =>
            !next.some(
              (item) =>
                item.source === addition.source &&
                item.target === addition.target &&
                item.targetPortId === addition.targetPortId
            )
        );
        return [...next, ...fresh];
      });
      setValidationMessage('Ready to run');
    },
    [edges, nodes, pushToast]
  );

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
    const { padding, headerReserve, topNudge, minZoom, maxZoom } = CANVAS_GEOMETRY.fit;
    const fit = Math.min(
      (rect.width - padding * 2) / (maxX - minX),
      (rect.height - padding * 2 - headerReserve) / (maxY - minY)
    );
    const k = Math.max(minZoom, Math.min(maxZoom, fit));
    setView({ k, x: (rect.width - (maxX - minX) * k) / 2 - minX * k, y: padding + topNudge - minY * k });
  }, [nodes, sizes]);

  useEffect(() => {
    const id = window.setTimeout(fitView, CANVAS_GEOMETRY.fitDelayMs.mount);
    return () => window.clearTimeout(id);
    // Run once on mount to frame the sample flow (fitView intentionally omitted from deps).
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
        const consoleStep = toConsoleStep(step, nodeTypeByIdRef.current[step.blockId]);
        setConsoleState((current) => ({ ...current, steps: upsertStep(current.steps, consoleStep) }));
        setNodeStatus(step.blockId, nodeStatusFromStep(step.status));
        setNodeIoPreview((current) => mergeNodeIo(current, [step]));
      },
      onComplete: ({ run }) => {
        // Only reflect the run the user is actively watching for the open flow.
        if (!isRunningRef.current || run.flowId !== activeFlowIdRef.current) {
          return;
        }
        setConsoleState((current) => runRecordToConsoleState(run, current, nodeTypeByIdRef.current));
        if (run.trigger) {
          // Single-node run: refresh only its node; never touch lastFullRun.
          setNodeIoPreview((current) => mergeNodeIo(current, run.steps));
          setNodes((current) => applyStepStatuses(current, run.steps));
        } else {
          setNodeIoPreview(mergeNodeIo({}, run.steps));
          setLastFullRun(run);
          setNodes((current) => applyRunStatuses(current, run));
        }
      },
      onError: (error) => {
        if (!isRunningRef.current) {
          return;
        }
        const message =
          error?.phase === 'parse'
            ? 'Live updates received an unreadable event'
            : error?.readyState === 2
              ? 'Live updates disconnected'
              : 'Live updates interrupted; reconnecting...';
        setConsoleState((current) => ({ ...current, activeTab: 'Logs', logs: capLogs([message, ...current.logs]) }));
        pushToast(message, 'warning');
      }
    });
  }, [pushToast, setNodeStatus]);

  // ----- run history (persisted, loaded on open) -----
  const loadHistory = useCallback(
    (flowId: string) => {
      listRuns(flowId)
        .then((runs) => {
          // A slow history response can land after the user has switched flows.
          // Drop it unless it still belongs to the active flow, so one flow's
          // history can never bleed into another flow's console.
          if (activeFlowIdRef.current !== flowId) {
            return;
          }
          const entries = runsToHistoryEntries(runs);
          setConsoleState((current) => ({ ...current, history: mergeHistory(entries, current.history) }));
        })
        .catch((error: unknown) => {
          // Carry the server's reason (server error vs. network) into the toast
          // and console so a failed history load is diagnosable, not generic.
          const reason = error instanceof Error ? error.message : 'unknown error';
          console.warn('Failed to load run history:', reason);
          pushToast(`Could not load run history: ${reason}`, 'warning');
        });
    },
    [pushToast]
  );

  useEffect(() => {
    loadHistory(DEFAULT_FLOW_ID);
    // Load persisted history once on mount for the initial sample flow (loadHistory intentionally omitted from deps).
  }, []);

  // Live run progress for the console head: completed vs total steps.
  const runProgress = useMemo(() => {
    const done = consoleState.steps.filter(
      (step) => step.status === 'success' || step.status === 'failed' || step.status === 'skipped'
    ).length;
    return { done, total: nodes.length };
  }, [consoleState.steps, nodes.length]);

  // ----- run -----
  const runNow = useCallback(async () => {
    const model = toFlowModel(nodes, edges);
    const validation = validateFlow(model);
    if (!validation.valid) {
      const messages = validation.errors.map((error) => error.message);
      const headline = messages[0] ?? 'flow is invalid';
      setValidationMessage(messages[0] ?? 'Flow is invalid');
      setRunStatus({ kind: 'error', message: `Run blocked: ${headline}` });
      setConsoleState((current) => ({
        ...current,
        activeTab: 'Logs',
        logs: ['Run blocked: flow failed validation', ...messages.map((message) => `• ${message}`)]
      }));
      pushToast(`Run blocked: ${headline}`, 'error');
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
    // Clear stale per-node badges; they repopulate from this run's results.
    setNodeIoPreview({});

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
      setNodeIoPreview(mergeNodeIo({}, run.steps));
      setLastFullRun(run);
      const summary = summarizeRun(run);
      setValidationMessage(summary.validationMessage);
      setRunStatus(summary.runStatus);
      pushToast(summary.toast.text, summary.toast.level);
    } catch (error) {
      if (runToken.current !== token) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unexpected run error';
      setValidationMessage('Run failed');
      setRunStatus({ kind: 'error', message: `Run failed: ${message}` });
      setConsoleState((current) => ({ ...current, activeTab: 'Logs', logs: capLogs([`Run failed: ${message}`, ...current.logs]) }));
      pushToast(`Run failed: ${message}`, 'error');
    } finally {
      if (runToken.current === token) {
        isRunningRef.current = false;
        setIsRunning(false);
      }
    }
  }, [activeFlowId, edges, flowName, nodes, schedule, pushToast]);

  // ----- run a single node in isolation -----
  const runNode = useCallback(
    async (nodeId: string, mode: RunNodeMode) => {
      const target = nodes.find((node) => node.id === nodeId);
      if (!target) {
        return;
      }
      // Validate the whole flow but only block on errors attributable to this node.
      const validation = validateFlow(toFlowModel(nodes, edges));
      const nodeError = validation.errors.find((error) => error.nodeId === nodeId);
      if (nodeError) {
        setRunStatus({ kind: 'error', message: `Run node blocked: ${nodeError.message}` });
        pushToast(`Run node blocked: ${nodeError.message}`, 'error');
        return;
      }

      const token = ++runToken.current;
      isRunningRef.current = true;
      setIsRunning(true);
      setConsoleCollapsed(false);
      setRunStatus({ kind: 'running', message: `Running ${target.label}…` });
      setNodeStatus(nodeId, 'running');

      try {
        const scheduleModel: PersistedFlow['schedule'] = {
          enabled: schedule.enabled,
          intervalMs: schedule.enabled ? cronToIntervalMs(schedule.cron) : undefined
        };
        const body = toFlowRequestBody(nodes, edges, { flowId: activeFlowId, name: flowName, failFast: false }, scheduleModel);
        await saveFlow(activeFlowId, body);
        const run = await postRunNode(activeFlowId, nodeId, mode);
        if (runToken.current !== token) {
          return;
        }
        setConsoleState((current) => runRecordToConsoleState(run, current, nodeTypeByIdRef.current));
        setNodeIoPreview((current) => mergeNodeIo(current, run.steps));
        // Update only the stepped node's status; leave the rest of the canvas alone.
        setNodes((current) => applyStepStatuses(current, run.steps));
        const ok = run.status !== 'failed';
        const outCount = run.steps[0]?.io?.outputCount ?? 0;
        setRunStatus(
          ok
            ? { kind: 'success', message: `${target.label} ran` }
            : { kind: 'error', message: `${target.label} failed` }
        );
        pushToast(
          ok ? `${target.label}: ${outCount} item${outCount === 1 ? '' : 's'} out` : `${target.label} failed: ${run.error ?? 'error'}`,
          ok ? 'success' : 'error'
        );
      } catch (error) {
        if (runToken.current !== token) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Unexpected run error';
        setRunStatus({ kind: 'error', message: `Run node failed: ${message}` });
        pushToast(`Run node failed: ${message}`, 'error');
      } finally {
        if (runToken.current === token) {
          isRunningRef.current = false;
          setIsRunning(false);
        }
      }
    },
    [activeFlowId, edges, flowName, nodes, schedule, pushToast, setNodeStatus]
  );

  const stopRun = useCallback(() => {
    runToken.current += 1;
    isRunningRef.current = false;
    setIsRunning(false);
    setRunStatus({ kind: 'idle', message: 'Run stopped' });
    setNodes((current) => current.map((node) => ({ ...node, status: 'idle' })));
    setConsoleState((current) => ({ ...current, logs: capLogs(['■ run stopped by user', ...current.logs]) }));
    pushToast('Run stopped', 'info');
  }, [pushToast]);

  const clearConsole = useCallback(() => {
    // Clear the report link too: keeping "Open report" after a clear implies the
    // emptied console still has an associated run.
    setConsoleState((current) => ({ ...current, logs: [], steps: [], results: [], reportPath: undefined }));
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
        pushToast(next.enabled ? 'Schedule saved' : 'Schedule paused', 'success');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error';
        setRunStatus({ kind: 'error', message: `Schedule save failed: ${message}` });
        pushToast(`Schedule save failed: ${message}`, 'error');
      }
    },
    [activeFlowId, edges, flowName, nodes, pushToast]
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
          pushToast('Flow not found', 'error');
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
        setNodeIoPreview({});
        setLastFullRun(null);
        setShowDashboard(false);
        loadHistory(flow.id);
        window.setTimeout(fitView, CANVAS_GEOMETRY.fitDelayMs.openFlow);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error';
        setRunStatus({ kind: 'error', message: `Failed to open flow: ${message}` });
        pushToast(`Failed to open flow: ${message}`, 'error');
      }
    },
    [activeFlowId, fitView, loadHistory, pushToast]
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
    setNodeIoPreview({});
    setLastFullRun(null);
    setShowDashboard(false);
  }, []);

  // Delete a saved flow. Removes it from the dashboard list; if it was the flow
  // currently open on the canvas, reset to a fresh blank flow so the editor never
  // points at a flow that no longer exists. A 404 (already gone) is still success.
  const removeFlow = useCallback(
    async (flowId: string) => {
      try {
        await deleteFlow(flowId);
        setFlowSummaries((summaries) => summaries.filter((flow) => flow.id !== flowId));
        if (flowId === activeFlowIdRef.current) {
          newFlow();
        }
        pushToast('Flow deleted', 'success');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error';
        pushToast(`Failed to delete flow: ${message}`, 'error');
      }
    },
    [newFlow, pushToast]
  );

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
    spliceNodeIntoEdge,
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
    runNode,
    nodeIoPreview,
    hasUpstream,
    hasCachedUpstream,
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
    newFlow,
    removeFlow,
    toasts,
    pushToast,
    dismissToast,
    runProgress
  };
}

/**
 * Merge persisted history with current-session entries, deduped by run id with
 * the session copy winning (freshest), newest-first, capped.
 */
function mergeHistory(loaded: ConsoleHistoryEntry[], session: ConsoleHistoryEntry[]): ConsoleHistoryEntry[] {
  const seen = new Set<string>();
  const merged: ConsoleHistoryEntry[] = [];
  // Session entries come first so the freshest copy wins on an id collision.
  for (const entry of [...session, ...loaded]) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged.sort(byStartedAtDesc).slice(0, MAX_HISTORY_ENTRIES);
}

// Reverse of flowSerialization.toFlowNode: maps the persisted `node.type` back to
// the UI's `blockType`. The two names are an intentional boundary (see toFlowNode).
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

/**
 * Pure projection of a completed run into the validation message, run status, and
 * toast the UI shows. Kept out of runNow so the stale-token control flow there
 * isn't tangled with success/failure message formatting and pluralization.
 */
function summarizeRun(run: RunRecord): {
  validationMessage: string;
  runStatus: RunStatus;
  toast: { text: string; level: ToastKind };
} {
  const ok = run.status === 'success';
  const hasFailedStep = run.steps.some((step) => step.status === 'failed');
  const rowCount = run.sample?.length ?? 0;
  const failedCount = run.steps.filter((step) => step.status === 'failed').length;
  return {
    validationMessage: ok ? 'Run completed' : 'Run finished with errors',
    runStatus: ok
      ? { kind: 'success', message: 'Run completed successfully' }
      : { kind: hasFailedStep ? 'error' : 'warning', message: 'Run finished with errors' },
    toast: {
      text: ok
        ? `Run complete — ${rowCount} row${rowCount === 1 ? '' : 's'}`
        : `Run finished with ${failedCount} failed step${failedCount === 1 ? '' : 's'}`,
      level: ok ? 'success' : hasFailedStep ? 'error' : 'warning'
    }
  };
}

// Deliberate domain→UI token mapping, centralized here: the backend/wire status
// is 'failed' (StepStatus/RunRecord.status), while the canvas NodeStatus uses
// 'error' for the same outcome. This one function is the single place that bridges
// the two vocabularies; do not "align" them by editing only one side.
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

/**
 * Apply statuses only for nodes present in `steps`, leaving every other node
 * untouched. Used by single-node runs so running one node does not reset the
 * rest of the canvas to idle (unlike {@link applyRunStatuses}).
 */
function applyStepStatuses(nodes: WorkbenchNode[], steps: RunRecord['steps']): WorkbenchNode[] {
  const byId = new Map(steps.map((step) => [step.blockId, nodeStatusFromStep(step.status)]));
  return nodes.map((node) => {
    const next = byId.get(node.id);
    return next === undefined || node.status === next ? node : { ...node, status: next };
  });
}

/**
 * Merge a run's per-node I/O into the preview map. Steps that recorded an `io`
 * summary overwrite their node's entry; steps without `io` (e.g. skipped
 * dependency steps) leave the previous entry intact.
 */
function mergeNodeIo(
  current: Record<string, NodeIoPreview>,
  steps: RunRecord['steps']
): Record<string, NodeIoPreview> {
  let next = current;
  for (const step of steps) {
    if (!step.io) {
      continue;
    }
    if (next === current) {
      next = { ...current };
    }
    next[step.blockId] = { status: nodeStatusFromStep(step.status), ...step.io };
  }
  return next;
}

function upsertStep(steps: ConsoleState['steps'], next: ConsoleState['steps'][number]): ConsoleState['steps'] {
  const index = steps.findIndex((step) => step.id === next.id);
  if (index === -1) {
    return [...steps, next];
  }
  return steps.map((step, position) => (position === index ? next : step));
}
