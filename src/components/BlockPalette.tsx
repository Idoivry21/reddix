import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { listBlockSpecs } from '../shared/commandBuilders';
import type { BlockSpec } from '../shared/types';

const groups = [
  { title: 'Reddit Sources', provider: 'reddit', category: 'Sources' },
  { title: 'X/Twitter Sources', provider: 'twitter', category: 'Sources' },
  { title: 'Transform', provider: 'local', category: 'Transform' },
  { title: 'Output', provider: 'local', category: 'Output' }
];

interface BlockPaletteProps {
  onAddBlock: (blockType: string) => void;
  readOnly?: boolean;
}

export function BlockPalette({ onAddBlock, readOnly = false }: BlockPaletteProps) {
  const [query, setQuery] = useState('');
  const specs = useMemo(() => listBlockSpecs(), []);

  return (
    <aside className="palette" aria-label="Block palette">
      <label className="search-box" htmlFor="palette-search">
        <Search size={15} />
        <input
          id="palette-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search blocks..."
          aria-label="Search blocks"
        />
        <kbd>⌘K</kbd>
      </label>
      <div className="palette-scroll">
        {groups.map((group) => {
          const items = specs.filter(
            (spec) =>
              spec.provider === group.provider &&
              spec.category === group.category &&
              spec.label.toLowerCase().includes(query.toLowerCase())
          );
          return (
            <section className="palette-group" key={group.title}>
              <h2>{group.title}</h2>
              {items.map((spec) => (
                <PaletteItem key={spec.type} spec={spec} onAddBlock={onAddBlock} readOnly={readOnly} />
              ))}
            </section>
          );
        })}
      </div>
      <div className="palette-foot">Drag blocks to canvas</div>
    </aside>
  );
}

interface PaletteItemProps {
  spec: BlockSpec;
  onAddBlock: (blockType: string) => void;
  readOnly?: boolean;
}

function PaletteItem({ spec, onAddBlock, readOnly = false }: PaletteItemProps) {
  return (
    <div
      className={`palette-item provider-${spec.provider}`}
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
        event.dataTransfer.setData('application/reddix-block', spec.type);
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <span className="palette-icon">{spec.provider === 'reddit' ? 'r/' : spec.provider === 'twitter' ? 'X' : '{}'}</span>
      <span>{spec.label}</span>
    </div>
  );
}

