import { getDefaultSettings } from './shared/commandBuilders';
import type { WorkbenchEdge, WorkbenchNode } from './flowTypes';

function node(id: string, blockType: string, label: string, x: number, y: number): WorkbenchNode {
  return { id, blockType, label, x, y, settings: getDefaultSettings(blockType), status: 'idle' };
}

function edge(source: string, target: string): WorkbenchEdge {
  return { id: `e-${source}-${target}`, source, target, sourcePortId: 'items', targetPortId: 'items' };
}

/**
 * Starter "weekly market digest" flow, laid out left-to-right like the design's
 * sample: two sources → per-stream filters → merge → sort → limit → CSV + JSON +
 * a self-contained HTML report (the showcase terminal). All ports are
 * SocialItem[] so the flow validates and runs end to end.
 */
export function createSampleNodes(): WorkbenchNode[] {
  return [
    node('reddit-search', 'reddit.searchPosts', 'Search Reddit', 60, 150),
    node('twitter-search', 'twitter.searchTweets', 'Search Tweets', 60, 440),
    node('reddit-filter', 'transform.filterText', 'Filter Text', 360, 150),
    node('twitter-filter', 'transform.engagementFilter', 'Engagement Filter', 360, 440),
    node('merge', 'transform.mergeStreams', 'Merge Streams', 660, 300),
    node('sort', 'transform.sortLocal', 'Sort Local', 940, 300),
    node('limit', 'transform.limit', 'Limit', 1220, 300),
    node('export-html', 'output.exportHtml', 'Export HTML Report', 1500, 120),
    node('export-csv', 'output.exportCsv', 'Export CSV', 1500, 300),
    node('export-json', 'output.exportJson', 'Export JSON', 1500, 480)
  ];
}

export function createSampleEdges(): WorkbenchEdge[] {
  return [
    edge('reddit-search', 'reddit-filter'),
    edge('twitter-search', 'twitter-filter'),
    edge('reddit-filter', 'merge'),
    edge('twitter-filter', 'merge'),
    edge('merge', 'sort'),
    edge('sort', 'limit'),
    edge('limit', 'export-html'),
    edge('limit', 'export-csv'),
    edge('limit', 'export-json')
  ];
}

export const SAMPLE_FLOW_NAME = 'Weekly market digest';
