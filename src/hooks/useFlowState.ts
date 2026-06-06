import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge } from '@xyflow/react';
import { MarkerType, useEdgesState, useNodesState } from '@xyflow/react';
import { buildBlockCommand, getDefaultSettings, previewCommand } from '../shared/commandBuilders';
import { validateFlow } from '../shared/graph';
import { postRun, saveFlow, subscribeRunEvents, type ConsoleState } from '../api';
import { DEFAULT_FLOW_ID, DEFAULT_FLOW_NAME, type WorkbenchNode } from '../flowTypes';
import { toFlowModel, toFlowRequestBody } from '../flowSerialization';
import { runRecordToConsoleState, runStepToConsoleStep } from '../runConsole';

export type { WorkbenchNode, WorkbenchNodeData } from '../flowTypes';

const edgeDefaults = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { stroke: '#5b6576', strokeWidth: 1.6 }
};

export function createStarterNodes(): WorkbenchNode[] {
  return [
    node('search', 'reddit.searchPosts', 'Search Reddit', { x: 80, y: 90 }, 'success'),
    node('filter', 'transform.filterText', 'Filter Text', { x: 390, y: 90 }, 'success'),
    node('export-json', 'output.exportJson', 'Export JSON', { x: 710, y: 90 }, 'success'),
    node('twitter-search', 'twitter.searchTweets', 'Search Tweets', { x: 80, y: 315 }, 'success'),
    node('engagement', 'transform.engagementFilter', 'Engagement Filter', { x: 390, y: 315 }, 'success'),
    node('export-csv', 'output.exportCsv', 'Export CSV', { x: 710, y: 315 }, 'success')
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
    results: []
  };
}

export function useWorkbenchState() {
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkbenchNode>(createStarterNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(createStarterEdges());
  const [selectedNodeId, setSelectedNodeId] = useState('search');
  const [lastSavedAt, setLastSavedAt] = useState('All changes saved');
  const [validationMessage, setValidationMessage] = useState('Ready to run');
  const [isRunning, setIsRunning] = useState(false);
  const [consoleState, setConsoleState] = useState<ConsoleState>(emptyConsoleState);

  // Keep the latest nodes available to async run + SSE handlers without stale closures.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const selectedNode = useMemo(
    () => nodes.find((item) => item.id === selectedNodeId),
    [nodes, selectedNodeId]
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

  const selectedCommand = useMemo(() => {
    const selected = nodes.find((item) => item.id === selectedNodeId);
    if (!selected || !selected.data.blockType.match(/^(reddit|twitter)\./)) {
      return undefined;
    }
    return buildBlockCommand({
      blockId: selected.id,
      blockType: selected.data.blockType,
      settings: selected.data.settings
    });
  }, [nodes, selectedNodeId]);

  // Reflect the selected CLI block in the Command Trace preview.
  useEffect(() => {
    setConsoleState((current) => ({ ...current, command: selectedCommand }));
  }, [selectedCommand]);

  const selectedCommandPreview = useMemo(() => {
    return selectedCommand ? previewCommand(selectedCommand) : 'Local transform block';
  }, [selectedCommand]);

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
        const consoleStep = runStepToConsoleStep(step, nodeTypeMap(nodesRef.current)[step.blockId]);
        setConsoleState((current) => ({ ...current, steps: upsertStep(current.steps, consoleStep) }));
      },
      onComplete: ({ run }) => {
        const nodeTypeById = nodeTypeMap(nodesRef.current);
        setConsoleState((current) => runRecordToConsoleState(run, current, nodeTypeById));
      }
    });
    return unsubscribe;
  }, []);

  const runNow = useCallback(async () => {
    const model = toFlowModel(nodes, edges);
    const validation = validateFlow(model);
    if (!validation.valid) {
      const messages = validation.errors.map((error) => error.message);
      setValidationMessage(messages[0] ?? 'Flow is invalid');
      setConsoleState((current) => ({
        ...current,
        activeTab: 'Logs',
        logs: ['Run blocked: flow failed validation', ...messages.map((message) => `• ${message}`)]
      }));
      return;
    }

    setIsRunning(true);
    setValidationMessage('Running flow…');
    setConsoleState((current) => ({ ...current, activeTab: 'Logs', logs: ['Run started…'] }));

    try {
      const body = toFlowRequestBody(nodes, edges, {
        flowId: DEFAULT_FLOW_ID,
        name: DEFAULT_FLOW_NAME,
        failFast: false
      });
      await saveFlow(DEFAULT_FLOW_ID, body);
      const run = await postRun(DEFAULT_FLOW_ID);
      setConsoleState((current) => runRecordToConsoleState(run, current, nodeTypeMap(nodes)));
      setValidationMessage(run.status === 'success' ? 'Run completed' : 'Run finished with errors');
      setLastSavedAt(run.status === 'success' ? 'Run completed' : 'Run finished with errors');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected run error';
      setValidationMessage('Run failed');
      setConsoleState((current) => ({
        ...current,
        activeTab: 'Logs',
        logs: [`Run failed: ${message}`, ...current.logs]
      }));
    } finally {
      setIsRunning(false);
    }
  }, [edges, nodes]);

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
    lastSavedAt,
    validationMessage,
    setValidationMessage,
    consoleState,
    setConsoleState,
    selectedCommandPreview,
    isRunning,
    runNow
  };
}

function nodeTypeMap(nodes: WorkbenchNode[]): Record<string, string> {
  return Object.fromEntries(nodes.map((item) => [item.id, item.data.blockType]));
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
