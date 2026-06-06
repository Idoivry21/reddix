import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge } from '@xyflow/react';
import { MarkerType, useEdgesState, useNodesState } from '@xyflow/react';
import { buildBlockCommand, getDefaultSettings, previewCommand } from '../shared/commandBuilders';
import { validateFlow } from '../shared/graph';
import { postRun, saveFlow, subscribeRunEvents, type ConsoleState } from '../api';
import { DEFAULT_FLOW_ID, DEFAULT_FLOW_NAME, type NodeStatus, type RunStatus, type WorkbenchNode } from '../flowTypes';
import { createBlockNode } from '../flowFactory';
import { toFlowModel, toFlowRequestBody } from '../flowSerialization';
import { capLogs, runRecordToConsoleState, runStepToConsoleStep } from '../runConsole';

export type { WorkbenchNode, WorkbenchNodeData } from '../flowTypes';

const edgeDefaults = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { stroke: '#5b6576', strokeWidth: 1.6 }
};

export function createStarterNodes(): WorkbenchNode[] {
  return [
    node('search', 'reddit.searchPosts', 'Search Reddit', { x: 80, y: 90 }, 'idle'),
    node('filter', 'transform.filterText', 'Filter Text', { x: 390, y: 90 }, 'idle'),
    node('export-json', 'output.exportJson', 'Export JSON', { x: 710, y: 90 }, 'idle'),
    node('twitter-search', 'twitter.searchTweets', 'Search Tweets', { x: 80, y: 315 }, 'idle'),
    node('engagement', 'transform.engagementFilter', 'Engagement Filter', { x: 390, y: 315 }, 'idle'),
    node('export-csv', 'output.exportCsv', 'Export CSV', { x: 710, y: 315 }, 'idle')
  ];
}

export function createStarterEdges(): Edge[] {
  return [
    { id: 'e-search-filter', source: 'search', target: 'filter', sourceHandle: 'items', targetHandle: 'items', ...edgeDefaults },
    { id: 'e-filter-export', source: 'filter', target: 'export-json', sourceHandle: 'items', targetHandle: 'items', ...edgeDefaults },
    {
      id: 'e-twitter-engagement',
      source: 'twitter-search',
      target: 'engagement',
      sourceHandle: 'items',
      targetHandle: 'items',
      ...edgeDefaults
    },
    {
      id: 'e-engagement-csv',
      source: 'engagement',
      target: 'export-csv',
      sourceHandle: 'items',
      targetHandle: 'items',
      ...edgeDefaults
    }
  ];
}

function emptyConsoleState(): ConsoleState {
  return {
    activeTab: 'Command Trace',
    command: undefined,
    runLabel: 'No runs yet',
    steps: [],
    logs: ['Ready. Press Run Now to execute the flow.'],
    results: [],
    history: []
  };
}

export function useWorkbenchState() {
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkbenchNode>(createStarterNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(createStarterEdges());
  const [selectedNodeId, setSelectedNodeId] = useState('search');
  const [lastSavedAt, setLastSavedAt] = useState('All changes saved');
  const [validationMessage, setValidationMessage] = useState('Ready to run');
  const [isRunning, setIsRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>({ kind: 'idle', message: 'Ready to run' });
  const [consoleState, setConsoleState] = useState<ConsoleState>(emptyConsoleState);

  const selectedNode = useMemo(
    () => nodes.find((item) => item.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  const addCounter = useRef(0);

  const addBlock = useCallback(
    (blockType: string) => {
      addCounter.current += 1;
      const offset = addCounter.current;
      const node = createBlockNode(
        blockType,
        { x: 160 + (offset % 5) * 40, y: 140 + (offset % 5) * 40 },
        `add-${offset}`
      );
      setNodes((current) => [...current, node]);
      setSelectedNodeId(node.id);
      setLastSavedAt('Unsaved changes');
    },
    [setNodes]
  );

  const updateNodeSettings = useCallback(
    (nodeId: string, key: string, value: unknown) => {
      setNodes((current) =>
        current.map((item) =>
          item.id === nodeId
            ? { ...item, data: { ...item.data, settings: { ...item.data.settings, [key]: value } } }
            : item
        )
      );
      setLastSavedAt('Unsaved changes');
    },
    [setNodes]
  );

  // Gate command rebuilds on the selected node's identity/type/settings, not on
  // the whole nodes array — so dragging an unrelated node won't recompute this.
  const selectedBlockType = selectedNode?.data.blockType;
  const selectedSettings = selectedNode?.data.settings;
  const selectedCommand = useMemo(() => {
    if (!selectedNode || !selectedBlockType || !/^(reddit|twitter)\./.test(selectedBlockType)) {
      return undefined;
    }
    return buildBlockCommand({
      blockId: selectedNode.id,
      blockType: selectedBlockType,
      settings: selectedSettings ?? {}
    });
    // selectedNode is intentionally excluded; the three primitive/ref deps below
    // change only when the selection or its settings actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, selectedBlockType, selectedSettings]);

  // Reflect the selected CLI block in the Command Trace preview.
  useEffect(() => {
    setConsoleState((current) => ({ ...current, command: selectedCommand }));
  }, [selectedCommand]);

  const selectedCommandPreview = useMemo(() => {
    return selectedCommand ? previewCommand(selectedCommand) : 'Local transform block';
  }, [selectedCommand]);

  // Memoize the id→blockType map and expose it via a ref so per-step SSE
  // handlers don't rebuild it on every event.
  const nodeTypeById = useMemo(() => nodeTypeMap(nodes), [nodes]);
  const nodeTypeByIdRef = useRef(nodeTypeById);
  nodeTypeByIdRef.current = nodeTypeById;

  const setNodeStatus = useCallback(
    (nodeId: string, status: WorkbenchNode['data']['status']) => {
      setNodes((current) =>
        current.map((item) =>
          item.id === nodeId ? { ...item, data: { ...item.data, status } } : item
        )
      );
    },
    [setNodes]
  );

  // Live run-step updates over SSE.
  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      return;
    }
    const unsubscribe = subscribeRunEvents({
      onStep: ({ step }) => {
        if (!step) {
          return;
        }
        const consoleStep = runStepToConsoleStep(step, nodeTypeByIdRef.current[step.blockId]);
        setConsoleState((current) => ({ ...current, steps: upsertStep(current.steps, consoleStep) }));
        setNodeStatus(step.blockId, nodeStatusFromStep(step.status));
      },
      onComplete: ({ run }) => {
        setConsoleState((current) => runRecordToConsoleState(run, current, nodeTypeByIdRef.current));
        setNodes((current) => applyRunStatuses(current, run));
      }
    });
    return unsubscribe;
  }, [setNodeStatus, setNodes]);

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

    setIsRunning(true);
    setValidationMessage('Running flow…');
    setRunStatus({ kind: 'running', message: 'Run started' });
    setConsoleState((current) => ({ ...current, activeTab: 'Logs', logs: ['Run started…'] }));
    setNodes((current) => current.map((item) => ({ ...item, data: { ...item.data, status: 'pending' } })));

    try {
      const body = toFlowRequestBody(nodes, edges, {
        flowId: DEFAULT_FLOW_ID,
        name: DEFAULT_FLOW_NAME,
        failFast: false
      });
      await saveFlow(DEFAULT_FLOW_ID, body);
      const run = await postRun(DEFAULT_FLOW_ID);
      setConsoleState((current) => runRecordToConsoleState(run, current, nodeTypeByIdRef.current));
      setNodes((current) => applyRunStatuses(current, run));
      const ok = run.status === 'success';
      const hasFailedStep = run.steps.some((step) => step.status === 'failed');
      setValidationMessage(ok ? 'Run completed' : 'Run finished with errors');
      setLastSavedAt(ok ? 'Run completed' : 'Run finished with errors');
      setRunStatus(
        ok
          ? { kind: 'success', message: 'Run completed successfully' }
          : { kind: hasFailedStep ? 'error' : 'warning', message: 'Run finished with errors' }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected run error';
      setValidationMessage('Run failed');
      setRunStatus({ kind: 'error', message: `Run failed: ${message}` });
      setConsoleState((current) => ({
        ...current,
        activeTab: 'Logs',
        logs: capLogs([`Run failed: ${message}`, ...current.logs])
      }));
    } finally {
      setIsRunning(false);
    }
  }, [edges, nodes, setNodes]);

  return {
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    selectedNodeId,
    setSelectedNodeId,
    selectedNode,
    updateNodeSettings,
    addBlock,
    lastSavedAt,
    validationMessage,
    setValidationMessage,
    consoleState,
    setConsoleState,
    selectedCommandPreview,
    isRunning,
    runStatus,
    runNow
  };
}

function nodeTypeMap(nodes: WorkbenchNode[]): Record<string, string> {
  return Object.fromEntries(nodes.map((item) => [item.id, item.data.blockType]));
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

/** Reset to idle, then apply each run step's final status to its node. */
function applyRunStatuses(nodes: WorkbenchNode[], run: { steps: Array<{ blockId: string; status: 'success' | 'failed' | 'skipped' | 'running' }> }): WorkbenchNode[] {
  const byId = new Map(run.steps.map((step) => [step.blockId, nodeStatusFromStep(step.status)]));
  return nodes.map((item) => {
    const next = byId.get(item.id) ?? 'idle';
    return item.data.status === next ? item : { ...item, data: { ...item.data, status: next } };
  });
}

function upsertStep(steps: ConsoleState['steps'], next: ConsoleState['steps'][number]): ConsoleState['steps'] {
  const index = steps.findIndex((step) => step.id === next.id);
  if (index === -1) {
    return [...steps, next];
  }
  return steps.map((step, position) => (position === index ? next : step));
}

function node(
  id: string,
  blockType: string,
  label: string,
  position: { x: number; y: number },
  status: WorkbenchNode['data']['status']
): WorkbenchNode {
  return {
    id,
    type: 'workbenchBlock',
    position,
    data: {
      blockType,
      label,
      settings: getDefaultSettings(blockType),
      status
    }
  };
}
