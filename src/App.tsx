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
      <TopBar lastSavedAt={workbench.lastSavedAt} onRun={workbench.runNow} isRunning={workbench.isRunning} />
      <div className="workbench-grid">
        <BlockPalette />
        <Canvas
          nodes={workbench.nodes}
          edges={workbench.edges}
          setNodes={workbench.setNodes}
          setEdges={workbench.setEdges}
          onNodesChange={workbench.onNodesChange}
          onEdgesChange={workbench.onEdgesChange}
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
