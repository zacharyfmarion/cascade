import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { DockviewReact } from 'dockview';
import type { DockviewReadyEvent } from 'dockview';
import 'dockview/dist/styles/dockview.css';

import { SettingsModal } from './components/SettingsModal';
import { useGraphStore } from './store/graphStore';
import { useSettingsStore } from './store/settingsStore';
import { useLayoutStore, applyDefaultLayout } from './store/layoutStore';
import { panelComponents, tabComponents, EditorTab } from './components/panels/PanelComponents';
import './store/themeStore';
import './styles/theme.css';
import './App.css';

function useUndoRedoShortcuts() {
  const undo = useGraphStore(s => s.undo);
  const redo = useGraphStore(s => s.redo);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);
}

function usePlaybackShortcuts() {
  const togglePlayback = useGraphStore(s => s.togglePlayback);
  const stepForward = useGraphStore(s => s.stepForward);
  const stepBackward = useGraphStore(s => s.stepBackward);
  const goToStart = useGraphStore(s => s.goToStart);
  const goToEnd = useGraphStore(s => s.goToEnd);
  const hasSequenceNodes = useGraphStore(s => s.hasSequenceNodes);
  const loopPlayback = useGraphStore(s => s.loopPlayback);
  const setLoopPlayback = useGraphStore(s => s.setLoopPlayback);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!hasSequenceNodes) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlayback();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepForward();
          break;
        case 'Home':
          e.preventDefault();
          goToStart();
          break;
        case 'End':
          e.preventDefault();
          goToEnd();
          break;
        case 'l':
        case 'L':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setLoopPlayback(!loopPlayback);
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasSequenceNodes, togglePlayback, stepForward, stepBackward, goToStart, goToEnd, loopPlayback, setLoopPlayback]);
}

function Toolbar() {
  const saveProject = useGraphStore(s => s.saveProject);
  const loadProject = useGraphStore(s => s.loadProject);
  const undo = useGraphStore(s => s.undo);
  const redo = useGraphStore(s => s.redo);
  const canUndo = useGraphStore(s => s.canUndo);
  const canRedo = useGraphStore(s => s.canRedo);
  const openSettings = useSettingsStore(s => s.openSettings);
  const applyWorkspacePreset = useLayoutStore(s => s.applyWorkspacePreset);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLoad = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        loadProject(file);
        e.target.value = '';
      }
    },
    [loadProject]
  );

  return (
    <div className="toolbar">
      <span className="toolbar__title">Compositor</span>
      <div className="toolbar__actions">
        <button
          type="button"
          className="toolbar__btn"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          className="toolbar__btn"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo
        </button>
        <div className="toolbar__separator" />
        <button type="button" className="toolbar__btn" onClick={saveProject}>
          Save
        </button>
        <button type="button" className="toolbar__btn" onClick={handleLoad}>
          Load
        </button>
        <div className="toolbar__separator" />
        <select
          className="toolbar__btn"
          onChange={(e) => {
            if (e.target.value) {
              applyWorkspacePreset(e.target.value as 'compositing' | 'viewing' | 'minimal');
              e.target.value = '';
            }
          }}
          value=""
          title="Workspace presets"
          style={{ cursor: 'pointer' }}
        >
          <option value="" disabled>Workspace</option>
          <option value="compositing">Compositing</option>
          <option value="viewing">Viewing</option>
          <option value="minimal">Minimal</option>
        </select>
        <div className="toolbar__separator" />
        <button type="button" className="toolbar__btn" onClick={openSettings} title="Settings">
          <Settings size={14} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}

function App() {
  const initEngine = useGraphStore(s => s.initEngine);
  const engineReady = useGraphStore(s => s.engineReady);
  const [error, setError] = useState<string | null>(null);
  
  const setDockviewApi = useLayoutStore(s => s.setDockviewApi);
  const loadLayout = useLayoutStore(s => s.loadLayout);
  const saveLayout = useLayoutStore(s => s.saveLayout);

  useUndoRedoShortcuts();
  usePlaybackShortcuts();

  useEffect(() => {
    const suppress = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', suppress);
    return () => document.removeEventListener('contextmenu', suppress);
  }, []);

  useEffect(() => {
    initEngine().catch(e => setError(String(e)));
  }, [initEngine]);

  const onReady = (event: DockviewReadyEvent) => {
    const { api } = event;
    setDockviewApi(api);

    let loaded = false;
    const saved = loadLayout();
    if (saved) {
      try {
        api.fromJSON(saved);
        loaded = true;
      } catch (e) {
        console.error('Failed to load saved layout', e);
        localStorage.removeItem('compositor-layout');
      }
    }

    if (!loaded) {
      applyDefaultLayout(api);
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    api.onDidLayoutChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        saveLayout();
      }, 300);
    });
  };

  if (error) {
    return <div style={{ padding: 40, color: 'var(--status-danger)' }}>Failed to load engine: {error}</div>;
  }

  if (!engineReady) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--text-secondary)',
        }}
      >
        Loading compositor engine...
      </div>
    );
  }

  return (
    <>
      <div className="app-layout">
        <Toolbar />
        <DockviewReact
          components={panelComponents}
          tabComponents={tabComponents}
          defaultTabComponent={EditorTab}
          onReady={onReady}
          className="dockview-theme-compositor"
          disableFloatingGroups={true}
        />
      </div>
      <SettingsModal />
    </>
  );
}

export default App;
