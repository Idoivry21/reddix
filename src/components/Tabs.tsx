interface TabsProps {
  tabs: readonly string[];
  active: string;
  onChange: (tab: string) => void;
  label: string;
  idPrefix?: string;
}

const slug = (value: string): string => value.toLowerCase().replace(/\s+/g, '-');

export const tabId = (prefix: string, tab: string): string => `${prefix}-tab-${slug(tab)}`;
export const tabPanelId = (prefix: string, tab: string): string => `${prefix}-panel-${slug(tab)}`;

/**
 * WAI-ARIA tabs with roving tabindex and arrow-key navigation. Only the active
 * tab is in the tab order; Arrow/Home/End move focus and selection together.
 */
export function Tabs({ tabs, active, onChange, label, idPrefix = 'tabs' }: TabsProps) {
  const move = (event: React.KeyboardEvent, index: number): void => {
    let nextIndex = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    onChange(nextTab);
    document.getElementById(tabId(idPrefix, nextTab))?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="tablist">
      {tabs.map((tab, index) => (
        <button
          key={tab}
          id={tabId(idPrefix, tab)}
          role="tab"
          type="button"
          aria-selected={tab === active}
          aria-controls={tabPanelId(idPrefix, tab)}
          tabIndex={tab === active ? 0 : -1}
          className={tab === active ? 'active' : ''}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => move(event, index)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
