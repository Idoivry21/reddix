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
}

export function BlockPalette({ onAddBlock }: BlockPaletteProps) {
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
                <PaletteItem key={spec.type} spec={spec} onAddBlock={onAddBlock} />
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
}

function PaletteItem({ spec, onAddBlock }: PaletteItemProps) {
  return (
    <div
      className={`palette-item provider-${spec.provider}`}
      role="button"
      tabIndex={0}
      aria-label={`Add ${spec.label} block`}
      draggable
      onClick={() => onAddBlock(spec.type)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onAddBlock(spec.type);
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/reddix-block', spec.type);
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <span className="palette-icon">{spec.provider === 'reddit' ? 'r/' : spec.provider === 'twitter' ? 'X' : '{}'}</span>
      <span>{spec.label}</span>
    </div>
  );
}

