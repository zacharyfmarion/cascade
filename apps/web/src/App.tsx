import { useEffect, useState } from 'react';
import { Settings, HelpCircle } from 'lucide-react';
import { TbBrandGithub, TbDownload } from 'react-icons/tb';
import { IconButton } from './components/ui/IconButton';
import { useMacDownloadUrl } from './components/AboutModal';
import { REPOSITORY_URL } from './constants/release';
import { DockviewReact } from 'dockview';
import type { DockviewReadyEvent } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { SettingsModal } from './components/SettingsModal';
import { AboutModal } from './components/AboutModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { MenuBar } from './components/MenuBar';
import { ToastHost } from './components/ui/ToastHost';
import { TooltipProvider } from './components/ui/Tooltip';
import { useGraphStore } from './store/graphStore';

import { useSettingsStore } from './store/settingsStore';
import { useLayoutStore, applyDefaultLayout } from './store/layoutStore';
import { useTauriMenuListener } from './menus/menuListener';
import { useShortcuts } from './shortcuts/useShortcuts';
import { panelComponents, tabComponents, EditorTab } from './components/panels/PanelComponents';
import './store/themeStore';
import './styles/theme.css';
import './App.css';

// Install test harness in development mode for E2E tests
if (import.meta.env.DEV) {
  import('./testing/testHarness').then(({ installTestHarness }) => {
    installTestHarness();
  });
}

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


function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function Toolbar() {
  const openSettings = useSettingsStore(s => s.openSettings);
  const openShortcuts = useSettingsStore(s => s.openShortcuts);
  const isTauriApp = isTauri();
  const downloadUrl = useMacDownloadUrl();

  return (
    <div className="toolbar">
      {isTauriApp ? (
        <span className="toolbar__title">Cascade</span>
      ) : (
        <MenuBar />
      )}
      <div className="toolbar__actions">
        <IconButton size="sm" title="View on GitHub" tooltipSide="bottom" onClick={() => window.open(REPOSITORY_URL, '_blank', 'noreferrer')}>
          <TbBrandGithub size={14} />
        </IconButton>
        <IconButton size="sm" title="Download Cascade for Mac" tooltipSide="bottom" onClick={() => window.open(downloadUrl, '_blank', 'noreferrer')}>
          <TbDownload size={14} />
        </IconButton>
        <IconButton size="sm" title="Keyboard Shortcuts" tooltipSide="bottom" onClick={openShortcuts}>
          <HelpCircle size={14} />
        </IconButton>
        <IconButton size="sm" title="Settings" tooltipSide="bottom" onClick={() => openSettings()}>
          <Settings size={14} />
        </IconButton>
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
  useShortcuts();
  useTauriMenuListener();

  useEffect(() => {
    const suppress = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', suppress);
    return () => document.removeEventListener('contextmenu', suppress);
  }, []);


  // Prevent Chrome's trackpad back/forward navigation gesture.
  // Chrome on macOS interprets horizontal two-finger swipes as history navigation.
  // We must use a non-passive wheel listener to call preventDefault on these events.
  useEffect(() => {
    const preventNavGesture = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > 0) {
        e.preventDefault();
      }
    };
    document.addEventListener('wheel', preventNavGesture, { passive: false });
    return () => document.removeEventListener('wheel', preventNavGesture);
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
        localStorage.removeItem('cascade-layout');
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
        data-testid="app-loading"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--text-secondary)',
        }}
      >
        Loading Cascade engine...
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="app-layout" data-testid="app-ready">
        <Toolbar />
        <DockviewReact
          components={panelComponents}
          tabComponents={tabComponents}
          defaultTabComponent={EditorTab}
          onReady={onReady}
          className="dockview-theme-cascade"
          disableFloatingGroups={true}
        />
      </div>
      <SettingsModal />
      <ShortcutsModal />
      <AboutModal />
      <ToastHost />
    </TooltipProvider>
  );
}


export default App;
