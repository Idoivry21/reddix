import { useCallback, useMemo, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import { buildBlockCommand, getDefaultSettings, previewCommand } from '../shared/commandBuilders';
import type { ConsoleState } from '../api';

export interface WorkbenchNodeData extends Record<string, unknown> {
  blockType: string;
  label: string;
  settings: Record<string, unknown>;
  status: 'idle' | 'success' | 'warning';
}

export type WorkbenchNode = Node<WorkbenchNodeData, 'workbenchBlock'>;

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

export function useWorkbenchState() {
  const [selectedNodeId, setSelectedNodeId] = useState('search');
  const [lastSavedAt, setLastSavedAt] = useState('All changes saved');
  const [validationMessage, setValidationMessage] = useState('Ready to run');
  const [consoleState, setConsoleState] = useState<ConsoleState>(() => ({
    activeTab: 'Command Trace',
    command: buildBlockCommand({
      blockId: 'search',
      blockType: 'reddit.searchPosts',
      settings: getDefaultSettings('reddit.searchPosts')
    }),
    runLabel: 'Run 2026-06-06 15:00',
    steps: [
      { id: 'search', label: 'Search Reddit', sublabel: 'rdt search', status: 'success', duration: '1.23s' },
      { id: 'filter', label: 'Filter Text', sublabel: 'local filter', status: 'success', duration: '0.48s' },
      { id: 'export-json', label: 'Export JSON', sublabel: 'write file', status: 'success', duration: '0.31s' },
      { id: 'twitter-search', label: 'Search Tweets', sublabel: 'twitter search', status: 'success', duration: '1.56s' },
      { id: 'engagement', label: 'Engagement Filter', sublabel: 'local filter', status: 'success', duration: '0.39s' },
      { id: 'export-csv', label: 'Export CSV', sublabel: 'write file', status: 'success', duration: '0.42s' }
    ],
    logs: [
      'Validated graph: 6 nodes, 4 edges',
      'Generated argv arrays for reddit and twitter providers',
      'Retrieved 87 Reddit results and 61 X/Twitter results',
      'Wrote outputs/reddit-20260606-150000.json and outputs/tweets-20260606-150000.csv'
    ],
    results: [
      {
        kind: 'post',
        title: 'Best open source CLI tools for automating local research',
        author: 'devops_dave',
        score: 42,
        created: '2026-06-01'
      },
      {
        kind: 'tweet',
        title: 'Local CLI automation is easier to audit than hosted scraping',
        author: 'public_cli',
        score: 31,
        created: '2026-06-01'
      }
    ]
  }));

  const selectedCommandPreview = useMemo(() => {
    return consoleState.command ? previewCommand(consoleState.command) : 'Local transform block';
  }, [consoleState.command]);

  const runNow = useCallback(() => {
    setConsoleState((current) => ({
      ...current,
      activeTab: 'Logs',
      runLabel: `Run ${new Date().toLocaleString()}`,
      logs: ['Manual run started', ...current.logs]
    }));
    setLastSavedAt('Run completed locally');
  }, []);

  return {
    selectedNodeId,
    setSelectedNodeId,
    lastSavedAt,
    validationMessage,
    setValidationMessage,
    consoleState,
    setConsoleState,
    selectedCommandPreview,
    runNow
  };
}

function node(
  id: string,
  blockType: string,
  label: string,
  position: { x: number; y: number },
  status: WorkbenchNodeData['status']
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

