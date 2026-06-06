import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Loader2 } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getBlockSpec } from '../shared/commandBuilders';
import type { NodeStatus, WorkbenchNode } from '../flowTypes';

const STATUS_META: Record<NodeStatus, { label: string; Icon: typeof CheckCircle2 }> = {
  idle: { label: 'Idle', Icon: CircleDashed },
  pending: { label: 'Pending', Icon: Clock },
  running: { label: 'Running', Icon: Loader2 },
  success: { label: 'Success', Icon: CheckCircle2 },
  error: { label: 'Error', Icon: AlertTriangle }
};

export function BlockNode({ data, selected }: NodeProps<WorkbenchNode>) {
  const spec = getBlockSpec(data.blockType);
  const status = STATUS_META[data.status] ?? STATUS_META.idle;
  const StatusIcon = status.Icon;
  return (
    <div className={`flow-node provider-${spec.provider} status-${data.status} ${selected ? 'selected' : ''}`}>
      {spec.ports.input.map((port) => (
        <Handle key={port.id} id={port.id} type="target" position={Position.Left} className="node-handle" />
      ))}
      <div className="node-header">
        <span className="node-provider">{spec.provider === 'reddit' ? 'r/' : spec.provider === 'twitter' ? 'X' : '{}'}</span>
        <strong>{data.label}</strong>
        <span className={`node-status node-status-${data.status}`} role="status" aria-label={`Status: ${status.label}`} title={status.label}>
          <StatusIcon size={16} />
          <span className="node-status-text">{status.label}</span>
        </span>
      </div>
      <dl className="node-body">
        {nodeSummary(data.blockType, data.settings).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
      {spec.ports.output.map((port) => (
        <Handle key={port.id} id={port.id} type="source" position={Position.Right} className="node-handle" />
      ))}
    </div>
  );
}

function nodeSummary(blockType: string, settings: Record<string, unknown>): Array<[string, unknown]> {
  if (blockType === 'reddit.searchPosts') {
    return [
      ['r/subreddit', settings.subreddit],
      ['Query', settings.query],
      ['Limit', settings.limit]
    ];
  }
  if (blockType === 'twitter.searchTweets') {
    return [
      ['Query', settings.query],
      ['Lang', settings.language],
      ['Limit', settings.maxCount]
    ];
  }
  if (blockType === 'transform.filterText') {
    return [
      ['Include', settings.include],
      ['Exclude', settings.exclude || 'none']
    ];
  }
  if (blockType === 'transform.engagementFilter') {
    return [
      ['Min likes', settings.minLikes],
      ['Min replies', settings.minReplies]
    ];
  }
  if (blockType === 'output.exportCsv' || blockType === 'output.exportJson') {
    return [['Path', settings.path]];
  }
  return [['Status', 'Ready']];
}

