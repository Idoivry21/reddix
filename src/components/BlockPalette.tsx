import { useMemo, useState } from 'react';
import { listBlockSpecs } from '../shared/commandBuilders';
import { buildPaletteGroups, iconForBlock, type AccentKey } from '../blockVisuals';
import { Icon } from '../icons';
import type { BlockSpec } from '../shared/types';

const BLOCK_DRAG_MIME = 'application/reddix-block';

interface BlockPaletteProps {
  onAddBlock: (blockType: string) => void;
  readOnly?: boolean;
  onDragType?: (blockType: string | null) => void;
}

export function BlockPalette({ onAddBlock, readOnly = false, onDragType }: BlockPaletteProps) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => buildPaletteGroups(listBlockSpecs()), []);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const normalized = query.trim().toLowerCase();

  return (
    <aside className="palette" aria-label="Block palette">
      <div className="palette-head">
        <div className="panel-eyebrow">Blocks</div>
        <label className="search" htmlFor="palette-search">
          <Icon name="search" size={15} />
          <input
            id="palette-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search blocks…"
            aria-label="Search blocks"
          />
        </label>
      </div>
      <div className="palette-scroll">
        {groups.map((group) => {
          const specs = group.specs.filter(
            (spec) =>
              !normalized ||
              spec.label.toLowerCase().includes(normalized) ||
              spec.description.toLowerCase().includes(normalized) ||
              group.label.toLowerCase().includes(normalized)
          );
          if (specs.length === 0) {
            return null;
          }
          const isOpen = !collapsed[group.accent] || Boolean(normalized);
          return (
            <section className="palette-group" key={group.accent}>
              <button
                type="button"
                className="palette-group-head"
                aria-expanded={isOpen}
                onClick={() => setCollapsed((current) => ({ ...current, [group.accent]: !current[group.accent] }))}
              >
                <span className={`gdot cat-${group.accent}`} />
                <span className="glabel">{group.label}</span>
                <span className="gcount">{specs.length}</span>
              </button>
              {isOpen
                ? specs.map((spec) => (
                    <PaletteItem
                      key={spec.type}
                      spec={spec}
                      accent={group.accent}
                      onAddBlock={onAddBlock}
                      readOnly={readOnly}
                      onDragType={onDragType}
                    />
                  ))
                : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

interface PaletteItemProps {
  spec: BlockSpec;
  accent: AccentKey;
  onAddBlock: (blockType: string) => void;
  readOnly?: boolean;
  onDragType?: (blockType: string | null) => void;
}

function PaletteItem({ spec, accent, onAddBlock, readOnly = false, onDragType }: PaletteItemProps) {
  return (
    <div
      className={`block-chip cat-${accent}`}
      role="button"
      tabIndex={readOnly ? -1 : 0}
      aria-disabled={readOnly}
      aria-label={`Add ${spec.label} block`}
      draggable={!readOnly}
      onClick={readOnly ? undefined : () => onAddBlock(spec.type)}
      onKeyDown={(event) => {
        if (readOnly) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onAddBlock(spec.type);
        }
      }}
      onDragStart={(event) => {
        if (readOnly) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData(BLOCK_DRAG_MIME, spec.type);
        event.dataTransfer.effectAllowed = 'copy';
        onDragType?.(spec.type);
      }}
      onDragEnd={() => onDragType?.(null)}
      title="Drag onto canvas, or click to add"
    >
      <div className="bicon">
        <Icon name={iconForBlock(spec.type)} size={16} />
      </div>
      <div className="bmeta">
        <div className="bname">{spec.label}</div>
        <div className="bdesc">{spec.description}</div>
      </div>
    </div>
  );
}
