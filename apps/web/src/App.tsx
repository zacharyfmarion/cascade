import { useEffect, useState } from 'react';
import { Settings, HelpCircle } from 'lucide-react';
import { DockviewReact } from 'dockview';
import type { DockviewReadyEvent } from 'dockview';
import 'dockview/dist/styles/dockview.css';

import { SettingsModal } from './components/SettingsModal';
import { AboutModal } from './components/AboutModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { MenuBar } from './components/MenuBar';
import { useGraphStore } from './store/graphStore';
import { useSettingsStore } from './store/settingsStore';
import { useLayoutStore, applyDefaultLayout } from './store/layoutStore';
import { useTauriMenuListener } from './menus/menuListener';
import { handleMenuAction } from './menus/menuDefinition';
import { panelComponents, tabComponents, EditorTab } from './components/panels/PanelComponents';
import './store/themeStore';
import './styles/theme.css';
import './App.css';

function useBeforeUnload() {
  const dirty = useGraphStore(s => s.dirty);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

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

function useMenuShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        useSettingsStore.getState().openShortcuts();
        return;
      }

      if (!(e.metaKey || e.ctrlKey)) return;

      switch (e.key.toLowerCase()) {
        case 's':
          e.preventDefault();
          handleMenuAction('file.save');
          break;
        case 'o':
          e.preventDefault();
          handleMenuAction('file.open');
          break;
        case ',':
          e.preventDefault();
          handleMenuAction('file.settings');
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
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

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function Toolbar() {
  const openSettings = useSettingsStore(s => s.openSettings);
  const openShortcuts = useSettingsStore(s => s.openShortcuts);
  const isTauriApp = isTauri();

  return (
    <div className="toolbar">
      {isTauriApp ? (
        <span className="toolbar__title">Compositor</span>
      ) : (
        <MenuBar />
      )}
      <div className="toolbar__actions">
        <button type="button" className="toolbar__btn" onClick={openShortcuts} title="Keyboard Shortcuts">
          <HelpCircle size={14} />
        </button>
        <button type="button" className="toolbar__btn" onClick={() => openSettings()} title="Settings">
          <Settings size={14} />
        </button>
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

  useBeforeUnload();
  useUndoRedoShortcuts();
  useMenuShortcuts();
  usePlaybackShortcuts();
  useTauriMenuListener();

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
      <ShortcutsModal />
      <AboutModal />
    </>
  );
}

export default App;
