import { useEffect, useRef } from 'react';
import { getBlockSpec } from '../shared/commandBuilders';
import { accentForBlock, eyebrowForAccent, iconForBlock, summaryForBlock } from '../blockVisuals';
import { Icon } from '../icons';
import { portFrac } from '../canvasGeometry';
import type { NodeIoPreview, NodeStatus, WorkbenchNode } from '../flowTypes';

interface NodeCardProps {
  node: WorkbenchNode;
  isSelected: boolean;
  onMeasure: (id: string, w: number, h: number) => void;
  onSelect: (id: string) => void;
  /** Per-node I/O from the latest run; when present the foot shows count badges. */
  preview?: NodeIoPreview;
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: 'Idle',
  pending: 'Pending',
  running: 'Running',
  success: 'Success',
  error: 'Error'
};

export function NodeCard({ node, isSelected, onMeasure, onSelect, preview }: NodeCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const spec = getBlockSpec(node.blockType);
  const accent = accentForBlock(spec.provider, spec.category);
  const summary = summaryForBlock(node.blockType, node.settings);
  const inN = spec.ports.input.length;
  const outN = spec.ports.output.length;
  const isSource = inN === 0;
  const isSink = outN === 0;
  const settingsKey = JSON.stringify(node.settings);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const measure = (): void => onMeasure(node.id, el.offsetWidth, el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
    // Re-measure when the rendered content (settings summary) changes height —
    // settingsKey stands in for node.settings to keep the dep list primitive.
  }, [node.id, settingsKey, onMeasure]);

  return (
    <div
      ref={ref}
      className={`node cat-${accent} status-${node.status} ${isSelected ? 'selected' : ''} ${
        node.status === 'running' ? 'running' : ''
      }`}
      data-role="node"
      data-id={node.id}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${node.label} block — ${STATUS_LABEL[node.status]}`}
      style={{ left: node.x, top: node.y }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      {spec.ports.input.map((port, index) => (
        <div
          key={`in-${port.id}`}
          className="port in"
          data-role="port-in"
          data-node={node.id}
          data-port={port.id}
          tabIndex={0}
          aria-label={`${node.label} input port: ${port.label}`}
          style={{ top: `${portFrac(index, inN) * 100}%` }}
        />
      ))}
      {spec.ports.output.map((port, index) => (
        <div
          key={`out-${port.id}`}
          className="port out"
          data-role="port-out"
          data-node={node.id}
          data-port={port.id}
          tabIndex={0}
          aria-label={`${node.label} output port: ${port.label}`}
          style={{ top: `${portFrac(index, outN) * 100}%` }}
        />
      ))}

      <div className="node-head" data-role="drag" data-id={node.id}>
        <div className="node-icon">
          <Icon name={iconForBlock(node.blockType)} size={15} />
        </div>
        <div className="node-titles">
          <div className="node-cat">{eyebrowForAccent(accent)}</div>
          <div className="node-title">{node.label}</div>
        </div>
        <span className="node-status" role="status" aria-label={`Status: ${STATUS_LABEL[node.status]}`} title={STATUS_LABEL[node.status]}>
          {node.status === 'running' ? <span className="spin" /> : null}
          {node.status === 'success' ? (
            <svg className="check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : null}
          {node.status === 'error' ? (
            <svg className="err" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 8v5M12 16.5v.5" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          ) : null}
          <span className="sr-only">{STATUS_LABEL[node.status]}</span>
        </span>
      </div>

      {summary.length > 0 ? (
        <div className="node-body">
          {summary.map((item) => (
            <div className="node-field" key={item.key}>
              <span className="fk">{item.key}</span>
              <span className={`fv ${item.accent ? 'accent' : ''}`}>{item.value || '—'}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="node-foot">
        <span>{isSource ? 'source' : `${inN} in`}</span>
        {preview ? (
          <span
            className="node-io"
            aria-label={`Last run: ${preview.outputCount} out${
              preview.skippedCount > 0 ? `, ${preview.skippedCount} skipped` : ''
            }`}
          >
            <span className={`io-badge io-out status-${preview.status}`}>{preview.outputCount} out</span>
            {preview.skippedCount > 0 ? <span className="io-badge io-skip">{preview.skippedCount} skipped</span> : null}
          </span>
        ) : (
          <span className="out-count">{isSink ? 'sink' : `${outN} out`}</span>
        )}
      </div>
    </div>
  );
}
