import { BlockPalette } from './components/BlockPalette';
import { Canvas } from './components/Canvas';
import { ConsolePanel } from './components/ConsolePanel';
import { Inspector } from './components/Inspector';
import { TopBar } from './components/TopBar';
import { useWorkbenchState } from './hooks/useFlowState';
import { useProviderHealth } from './hooks/useProviderHealth';

export function App() {
  const workbench = useWorkbenchState();
  const health = useProviderHealth();

  return (
    <main className="workbench-shell">
      <TopBar
        lastSavedAt={workbench.lastSavedAt}
        onRun={workbench.runNow}
        isRunning={workbench.isRunning}
        providers={health.providers}
        healthLoading={health.loading}
        healthError={health.error}
      />
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
          node={workbench.selectedNode}
          validationMessage={workbench.validationMessage}
          onSettingChange={(key, value) =>
            workbench.selectedNode && workbench.updateNodeSettings(workbench.selectedNode.id, key, value)
          }
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
