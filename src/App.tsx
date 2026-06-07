import { useEffect } from 'react';
import { BlockPalette } from './components/BlockPalette';
import { Canvas } from './components/Canvas';
import { ConsolePanel } from './components/ConsolePanel';
import { Inspector } from './components/Inspector';
import { TopBar } from './components/TopBar';
import { ScheduleModal } from './components/ScheduleModal';
import { Dashboard } from './components/Dashboard';
import { ToastViewport } from './components/ToastViewport';
import { WelcomeOverlay } from './components/WelcomeOverlay';
import { useWorkbenchState } from './hooks/useFlowState';
import { useProviderHealth } from './hooks/useProviderHealth';
import { useIsMobile } from './hooks/useIsMobile';
import { useTheme } from './hooks/useTheme';
import { useOnboarding } from './hooks/useOnboarding';

export function App() {
  const workbench = useWorkbenchState();
  const health = useProviderHealth();
  const readOnly = useIsMobile();
  const { theme, toggleTheme } = useTheme();
  const { showWelcome, dismissOnboarding } = useOnboarding();

  const { selectedNodeId, selectedEdgeId, deleteNode, deleteEdge, runNow } = workbench;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          document.getElementById('palette-search')?.focus();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('palette-search')?.focus();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        if (!readOnly) {
          void runNow();
        }
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !readOnly) {
        if (selectedNodeId) {
          event.preventDefault();
          deleteNode(selectedNodeId);
        } else if (selectedEdgeId) {
          event.preventDefault();
          deleteEdge(selectedEdgeId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteEdge, deleteNode, readOnly, runNow, selectedEdgeId, selectedNodeId]);

  const showInspector = !readOnly;

  return (
    <div className={`app ${readOnly ? 'read-only' : ''}`} data-inspect={showInspector ? 'shown' : 'hidden'}>
      <TopBar
        flowName={workbench.flowName}
        onRename={workbench.setFlowName}
        runStatus={workbench.runStatus}
        onRun={workbench.runNow}
        onStop={workbench.stopRun}
        isRunning={workbench.isRunning}
        onOpenDashboard={workbench.openDashboard}
        onOpenSchedule={() => workbench.setShowSchedule(true)}
        providers={health.providers}
        healthLoading={health.loading}
        healthError={health.error}
        theme={theme}
        onToggleTheme={toggleTheme}
        readOnly={readOnly}
      />

      {readOnly ? (
        <div className="mobile-readonly-banner" role="note">
          Read-only on mobile — authoring is disabled. View runs and history only.
        </div>
      ) : null}

      <BlockPalette onAddBlock={workbench.addBlock} onDragType={workbench.setDragType} readOnly={readOnly} />

      <Canvas
        nodes={workbench.nodes}
        edges={workbench.edges}
        view={workbench.view}
        setView={workbench.setView}
        sizes={workbench.sizes}
        onMeasure={workbench.onMeasure}
        selectedNodeId={workbench.selectedNodeId}
        selectedEdgeId={workbench.selectedEdgeId}
        onSelectNode={workbench.selectNode}
        onSelectEdge={workbench.selectEdge}
        onMoveNode={workbench.moveNode}
        onConnect={workbench.connect}
        onDeleteEdge={workbench.deleteEdge}
        onDropBlock={workbench.dropBlock}
        onPaneClick={workbench.clearSelection}
        onFit={workbench.fitView}
        onAddBlock={workbench.addBlock}
        dragType={workbench.dragType}
        readOnly={readOnly}
      />

      {showInspector ? (
        <Inspector
          node={workbench.selectedNode}
          onSettingChange={(key, value) =>
            workbench.selectedNode && workbench.updateNodeSettings(workbench.selectedNode.id, key, value)
          }
          onDelete={() => workbench.selectedNode && workbench.deleteNode(workbench.selectedNode.id)}
          onDuplicate={() => workbench.selectedNode && workbench.duplicateNode(workbench.selectedNode.id)}
          readOnly={readOnly}
        />
      ) : null}

      <ConsolePanel
        state={workbench.consoleState}
        onTabChange={(activeTab) => workbench.setConsoleState((state) => ({ ...state, activeTab }))}
        height={workbench.consoleHeight}
        setHeight={workbench.setConsoleHeight}
        collapsed={workbench.consoleCollapsed}
        setCollapsed={workbench.setConsoleCollapsed}
        onClear={workbench.clearConsole}
        runState={workbench.runStatus.kind}
        progress={workbench.runProgress}
      />

      {workbench.showSchedule ? (
        <ScheduleModal
          schedule={workbench.schedule}
          onClose={() => workbench.setShowSchedule(false)}
          onSave={workbench.saveSchedule}
        />
      ) : null}

      {workbench.showDashboard ? (
        <Dashboard
          flows={workbench.dashboardFlows}
          currentId={workbench.activeFlowId}
          onOpen={(id) => workbench.openFlow(id)}
          onClose={() => workbench.setShowDashboard(false)}
          onNew={workbench.newFlow}
        />
      ) : null}

      {showWelcome && !readOnly ? (
        <WelcomeOverlay
          onRun={() => {
            dismissOnboarding();
            void workbench.runNow();
          }}
          onDismiss={dismissOnboarding}
        />
      ) : null}

      <ToastViewport toasts={workbench.toasts} onDismiss={workbench.dismissToast} />
    </div>
  );
}
