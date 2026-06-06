import { BlockPalette } from './components/BlockPalette';
import { Canvas } from './components/Canvas';
import { ConsolePanel } from './components/ConsolePanel';
import { Inspector } from './components/Inspector';
import { TopBar } from './components/TopBar';
import { useWorkbenchState } from './hooks/useFlowState';

export function App() {
  const workbench = useWorkbenchState();

  return (
    <main className="workbench-shell">
      <TopBar lastSavedAt={workbench.lastSavedAt} onRun={workbench.runNow} />
      <div className="workbench-grid">
        <BlockPalette />
        <Canvas
          selectedNodeId={workbench.selectedNodeId}
          onSelectNode={workbench.setSelectedNodeId}
          setValidationMessage={workbench.setValidationMessage}
        />
        <Inspector
          selectedNodeId={workbench.selectedNodeId}
          validationMessage={workbench.validationMessage}
        />
        <ConsolePanel
          state={workbench.consoleState}
          onTabChange={(activeTab) =>
            workbench.setConsoleState((state) => ({
              ...state,
              activeTab
            }))
          }
        />
      </div>
    </main>
  );
}
