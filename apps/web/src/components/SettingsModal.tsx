import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isDesktopRuntime } from '../platform/runtime';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';
import { useLayoutStore } from '../store/layoutStore';
import { useGraphStore } from '../store/graphStore';
import type { CascadeTheme } from '../themes/types';

type Tab = 'project' | 'appearance' | 'canvas' | 'performance' | 'playback' | 'privacy' | 'color' | 'ai';

const ALL_TAB_LABELS: { key: Tab; label: string; tauriOnly?: boolean }[] = [
  { key: 'project', label: 'Project' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'canvas', label: 'Canvas' },
  { key: 'performance', label: 'Performance' },
  { key: 'playback', label: 'Playback' },
  { key: 'privacy', label: 'Privacy' },
  { key: 'color', label: 'Color', tauriOnly: true },
  { key: 'ai', label: 'AI' },
];

const TAB_LABELS = ALL_TAB_LABELS.filter(t => !t.tauriOnly || isDesktopRuntime());

const sectionDescriptions: Record<Tab, string> = {
  project: 'Set project resolution and format.',
  appearance: 'Customize the look and feel of the application.',
  canvas: 'Configure node canvas behavior and display options.',
  performance: 'Tune preview rendering performance for your hardware.',
  playback: 'Set default playback behavior for image sequences.',
  privacy: 'Control anonymous product analytics collection for this device.',
  color: 'Configure display color space and view transform for the viewer.',
  ai: 'Configure API keys for AI-powered nodes and the AI assistant.',
};

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: '3px',
  fontSize: '0.8rem',
  padding: '2px 6px',
  cursor: 'pointer',
};

const numberInputStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: '3px',
  fontSize: '0.8rem',
  padding: '2px 6px',
  width: '80px',
  textAlign: 'right',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '0.8rem',
  padding: '6px 0',
};

const ThemeCard = ({ theme, isSelected, onClick }: { theme: CascadeTheme; isSelected: boolean; onClick: () => void }) => {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      aria-pressed={isSelected}
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
        borderRadius: '4px',
        cursor: 'pointer',
        padding: '8px',
        background: 'var(--bg-surface)',
        transition: 'all 0.15s ease',
        boxShadow: isSelected ? '0 0 0 1px var(--accent-primary)' : isHovered ? '0 2px 4px var(--shadow-overlay)' : 'none',
        transform: isHovered ? 'translateY(-1px)' : 'none',
        opacity: isHovered ? 1 : 0.9,
        textAlign: 'left',
      }}
    >
      <div style={{ 
        fontSize: '0.8rem', 
        fontWeight: isSelected ? 600 : 400, 
        color: 'var(--text-primary)', 
        marginBottom: '6px',
        whiteSpace: 'nowrap', 
        overflow: 'hidden', 
        textOverflow: 'ellipsis' 
      }}>
        {theme.name}
      </div>
      <div style={{ display: 'flex', height: '12px', borderRadius: '2px', overflow: 'hidden', width: '100%' }}>
         <div style={{ flex: 1, background: theme.colors['bg.primary'] }} />
         <div style={{ flex: 1, background: theme.colors['accent.primary'] }} />
         <div style={{ flex: 1, background: theme.colors['text.primary'] }} />
         <div style={{ flex: 1, background: theme.colors['bg.secondary'] }} />
         <div style={{ flex: 1, background: theme.colors['status.danger'] }} />
         <div style={{ flex: 1, background: theme.colors['status.success'] }} />
      </div>
    </button>
  );
};

function AppearanceTab() {
  const currentTheme = useThemeStore(s => s.currentTheme);
  const presetThemes = useThemeStore(s => s.presetThemes);
  const customThemes = useThemeStore(s => s.customThemes);
  const setTheme = useThemeStore(s => s.setTheme);
  const importVSCodeThemeJson = useThemeStore(s => s.importVSCodeThemeJson);
  const resetLayout = useLayoutStore(s => s.resetLayout);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allThemes = [...presetThemes, ...customThemes];

  const themesByCategory = allThemes.reduce<Record<string, CascadeTheme[]>>((acc, theme) => {
    const cat = theme.type === 'light' ? 'Light' : 'Dark';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(theme);
    return acc;
  }, {});
  const categoryOrder = ['Dark', 'Light'];
  const themeCategories = categoryOrder
    .filter(cat => themesByCategory[cat]?.length)
    .map(cat => ({ category: cat, themes: themesByCategory[cat] }));

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      file.text().then(text => {
        try {
          importVSCodeThemeJson(text);
        } catch (err) {
          console.error('Failed to import VS Code theme:', err);
          useGraphStore.getState().pushToast('error', 'Theme import failed', err instanceof Error ? err.message : String(err));
        }
      });
      e.target.value = '';
    },
    [importVSCodeThemeJson]
  );

  return (
    <div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Select a theme to customize the look and feel.
      </div>

      {themeCategories.map(section => (
        <div key={section.category} style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '8px',
          }}>
            {section.category}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '8px',
          }}>
            {section.themes.map(theme => (
              <ThemeCard
                key={theme.name}
                theme={theme}
                isSelected={currentTheme.name === theme.name}
                onClick={() => setTheme(theme)}
              />
            ))}
          </div>
        </div>
      ))}

      <div style={{ paddingTop: '8px' }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            borderRadius: '3px',
            fontSize: '0.8rem',
            padding: '6px 12px',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Import VS Code Theme...
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.jsonc"
          onChange={handleImportFile}
          style={{ display: 'none' }}
        />
      </div>

      <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-default)', paddingTop: '16px' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Layout</div>
        <button
          type="button"
          onClick={() => {
            if (confirm('Reset layout to default? This will refresh the page.')) {
              resetLayout();
            }
          }}
          style={{
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            borderRadius: '3px',
            fontSize: '0.8rem',
            padding: '6px 12px',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Reset Layout
        </button>
      </div>
    </div>
  );
}

function CanvasTab() {
  const snapToGrid = useSettingsStore(s => s.snapToGrid);
  const setSnapToGrid = useSettingsStore(s => s.setSnapToGrid);
  const gridSize = useSettingsStore(s => s.gridSize);
  const setGridSize = useSettingsStore(s => s.setGridSize);
  const showMinimap = useSettingsStore(s => s.showMinimap);
  const setShowMinimap = useSettingsStore(s => s.setShowMinimap);
  const showTimings = useSettingsStore(s => s.showTimings);
  const setShowTimings = useSettingsStore(s => s.setShowTimings);

  return (
    <div>
      <label style={rowStyle}>
        <span style={{ color: 'var(--text-secondary)' }}>Snap to Grid</span>
        <input
          type="checkbox"
          checked={snapToGrid}
          onChange={e => setSnapToGrid(e.target.checked)}
          style={{ accentColor: 'var(--accent-primary)' }}
        />
      </label>
      <label style={rowStyle}>
        <span style={{ color: 'var(--text-secondary)' }}>Grid Size</span>
        <input
          type="number"
          value={gridSize}
          onChange={e => setGridSize(Number(e.target.value))}
          min={5}
          max={50}
          step={5}
          style={numberInputStyle}
        />
      </label>
      <label style={rowStyle}>
        <span style={{ color: 'var(--text-secondary)' }}>Show Minimap</span>
        <input
          type="checkbox"
          checked={showMinimap}
          onChange={e => setShowMinimap(e.target.checked)}
          style={{ accentColor: 'var(--accent-primary)' }}
        />
      </label>
      <label style={rowStyle}>
        <span style={{ color: 'var(--text-secondary)' }}>Show Node Timings</span>
        <input
          type="checkbox"
          checked={showTimings}
          onChange={e => setShowTimings(e.target.checked)}
          style={{ accentColor: 'var(--accent-primary)' }}
        />
      </label>
    </div>
  );
}

function PerformanceTab() {
  const livePreviewScale = useSettingsStore(s => s.livePreviewScale);
  const setLivePreviewScale = useSettingsStore(s => s.setLivePreviewScale);
  const previewIdleDelay = useSettingsStore(s => s.previewIdleDelay);
  const setPreviewIdleDelay = useSettingsStore(s => s.setPreviewIdleDelay);
  const maxUndoSteps = useSettingsStore(s => s.maxUndoSteps);
  const setMaxUndoSteps = useSettingsStore(s => s.setMaxUndoSteps);

  return (
    <div>
      <label style={rowStyle}>
        <span style={{ color: 'var(--text-secondary)' }}>Live Preview Scale</span>
        <select
          value={livePreviewScale}
          onChange={e => setLivePreviewScale(Number(e.target.value))}
          style={selectStyle}
        >
          <option value={0.25}>25%</option>
          <option value={0.5}>50%</option>
          <option value={0.75}>75%</option>
          <option value={1}>100%</option>
        </select>
      </label>
      <label style={rowStyle}>
        <span style={{ color: 'var(--text-secondary)' }}>Preview Idle Delay (ms)</span>
        <input
          type="number"
          value={previewIdleDelay}
          onChange={e => setPreviewIdleDelay(Number(e.target.value))}
          min={100}
          max={2000}
          step={50}
          style={numberInputStyle}
        />
      </label>
      <label style={rowStyle}>
        <span style={{ color: 'var(--text-secondary)' }}>Max Undo Steps</span>
        <input
          type="number"
          value={maxUndoSteps}
          onChange={e => setMaxUndoSteps(Math.max(1, Math.min(200, Number(e.target.value))))}
          min={1}
          max={200}
          step={1}
          style={numberInputStyle}
        />
      </label>
    </div>
  );
}

function PlaybackTab() {
  const defaultFps = useSettingsStore(s => s.defaultFps);
  const setDefaultFps = useSettingsStore(s => s.setDefaultFps);
  const loopPlayback = useSettingsStore(s => s.loopPlayback);
  const setLoopPlayback = useSettingsStore(s => s.setLoopPlayback);

  return (
    <div>
      <label style={rowStyle}>
        <span style={{ color: 'var(--text-secondary)' }}>Default FPS</span>
        <input
          type="number"
          value={defaultFps}
          onChange={e => setDefaultFps(Number(e.target.value))}
          min={1}
          max={120}
          style={numberInputStyle}
        />
      </label>
      <label style={rowStyle}>
        <span style={{ color: 'var(--text-secondary)' }}>Loop Playback</span>
        <input
          type="checkbox"
          checked={loopPlayback}
          onChange={e => setLoopPlayback(e.target.checked)}
          style={{ accentColor: 'var(--accent-primary)' }}
        />
      </label>
    </div>
  );
}

function PrivacyTab() {
  const analyticsEnabled = useSettingsStore(s => s.analyticsEnabled);
  const setAnalyticsEnabled = useSettingsStore(s => s.setAnalyticsEnabled);

  return (
    <div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Cascade can send anonymous product analytics to PostHog so we can understand DAUs, core workflow usage, and graph-building behavior without collecting graph parameter values, prompts, keys, or file paths.
      </div>
      <label style={rowStyle}>
        <span style={{ color: 'var(--text-secondary)' }}>Enable Anonymous Analytics</span>
        <input
          type="checkbox"
          checked={analyticsEnabled}
          onChange={e => setAnalyticsEnabled(e.target.checked)}
          style={{ accentColor: 'var(--accent-primary)' }}
        />
      </label>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '12px', lineHeight: 1.5 }}>
        Current high-signal events include app open plus structural node graph actions such as adding nodes, removing nodes, connecting nodes, disconnecting nodes, muting nodes, and linking nodes to the viewer.
      </div>
    </div>
  );
}

function ColorTab() {
  const colorManagement = useGraphStore(s => s.colorManagement);
  const setDisplayView = useGraphStore(s => s.setDisplayView);
  const getViewsForDisplay = useGraphStore(s => s.getViewsForDisplay);
  const loadColorManagementInfo = useGraphStore(s => s.loadColorManagementInfo);
  const loadOcioConfig = useGraphStore(s => s.loadOcioConfig);
  const loadOcioFromEnv = useGraphStore(s => s.loadOcioFromEnv);
  const resetColorManagement = useGraphStore(s => s.resetColorManagement);

  const ocioEnabled = useSettingsStore(s => s.ocioEnabled);
  const setOcioEnabled = useSettingsStore(s => s.setOcioEnabled);
  const ocioConfigSource = useSettingsStore(s => s.ocioConfigSource);
  const setOcioConfigSource = useSettingsStore(s => s.setOcioConfigSource);
  const ocioConfigPath = useSettingsStore(s => s.ocioConfigPath);
  const setOcioConfigPath = useSettingsStore(s => s.setOcioConfigPath);
  const setOcioActiveDisplay = useSettingsStore(s => s.setOcioActiveDisplay);
  const setOcioActiveView = useSettingsStore(s => s.setOcioActiveView);

  const [availableViews, setAvailableViews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadColorManagementInfo();
  }, [loadColorManagementInfo]);

  useEffect(() => {
    if (!colorManagement) return;
    getViewsForDisplay(colorManagement.activeDisplay).then(setAvailableViews);
  }, [colorManagement?.activeDisplay, getViewsForDisplay, colorManagement]);

  const isOcioLoaded = Boolean(colorManagement && colorManagement.displays.length > 1);

  const statusLine = isOcioLoaded
    ? `OCIO${ocioConfigSource === 'file' && ocioConfigPath ? `: ${ocioConfigPath.split('/').pop()}` : ' (env)'}`
    : 'Builtin (linear sRGB)';

  const applyOcio = async (source: 'env' | 'file', path?: string) => {
    setLoading(true);
    setError(null);
    try {
      if (source === 'env') {
        await loadOcioFromEnv();
      } else if (path) {
        await loadOcioConfig(path);
      }
      setOcioEnabled(true);
    } catch (e) {
      setError(String(e));
      setOcioEnabled(false);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (checked: boolean) => {
    if (!checked) {
      setLoading(true);
      setError(null);
      try {
        await resetColorManagement();
        setOcioEnabled(false);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
      return;
    }
    // Enabling: only proceed if we have what we need
    if (ocioConfigSource === 'file' && !ocioConfigPath) {
      // No path yet — don't check the box, let user browse first
      return;
    }
    await applyOcio(ocioConfigSource, ocioConfigPath);
  };

  const handleSourceChange = async (source: 'env' | 'file') => {
    setOcioConfigSource(source);
    // If OCIO is already enabled, re-apply with the new source immediately
    // (but for 'file' with no path yet, wait for user to browse)
    if (ocioEnabled) {
      if (source === 'env') {
        await applyOcio('env');
      } else if (ocioConfigPath) {
        await applyOcio('file', ocioConfigPath);
      } else {
        // Switching to file with no path — disable until they browse
        await resetColorManagement();
        setOcioEnabled(false);
      }
    }
  };

  const handleBrowse = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      title: 'Select OCIO Config',
      filters: [{ name: 'OCIO Config', extensions: ['ocio'] }],
    });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    setOcioConfigPath(path);
    // Apply immediately — browsing is an explicit user action
    await applyOcio('file', path);
  };

  const handleDisplayChange = async (display: string) => {
    const views = await getViewsForDisplay(display);
    setAvailableViews(views);
    const view = views.length > 0 ? views[0] : '';
    await setDisplayView(display, view);
    setOcioActiveDisplay(display);
    setOcioActiveView(view);
  };

  const handleViewChange = async (view: string) => {
    if (!colorManagement) return;
    await setDisplayView(colorManagement.activeDisplay, view);
    setOcioActiveDisplay(colorManagement.activeDisplay);
    setOcioActiveView(view);
  };

  const smallButtonStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
    borderRadius: '3px',
    fontSize: '0.75rem',
    padding: '3px 8px',
    cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.6 : 1,
  };

  return (
    <div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
        Color Management:{' '}
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{statusLine}</span>
      </div>

      <label style={{ ...rowStyle, cursor: loading ? 'not-allowed' : 'pointer' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Enable OCIO</span>
        <input
          type="checkbox"
          checked={ocioEnabled && isOcioLoaded}
          disabled={loading || (ocioConfigSource === 'file' && !ocioConfigPath && !ocioEnabled)}
          onChange={e => handleToggle(e.target.checked)}
        />
      </label>

      <label style={rowStyle}>
        <span style={{ color: 'var(--text-secondary)' }}>Source</span>
        <select
          value={ocioConfigSource}
          onChange={e => handleSourceChange(e.target.value as 'env' | 'file')}
          style={selectStyle}
          disabled={loading}
        >
          <option value="env">$OCIO environment variable</option>
          <option value="file">Config file</option>
        </select>
      </label>

      {ocioConfigSource === 'file' && (
        <div style={{ ...rowStyle, gap: '8px' }}>
          <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>Config</span>
          <span style={{
            flex: 1,
            fontSize: '0.75rem',
            color: ocioConfigPath ? 'var(--text-primary)' : 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            marginRight: '8px',
          }}>
            {ocioConfigPath ? ocioConfigPath.split('/').pop() : 'No file selected'}
          </span>
          <button type="button" style={smallButtonStyle} disabled={loading} onClick={handleBrowse}>
            Browse…
          </button>
        </div>
      )}

      {isOcioLoaded && colorManagement && (
        <>
          <label style={rowStyle}>
            <span style={{ color: 'var(--text-secondary)' }}>Display</span>
            <select
              value={colorManagement.activeDisplay}
              onChange={e => handleDisplayChange(e.target.value)}
              style={selectStyle}
            >
              {colorManagement.displays.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label style={rowStyle}>
            <span style={{ color: 'var(--text-secondary)' }}>View</span>
            <select
              value={colorManagement.activeView}
              onChange={e => handleViewChange(e.target.value)}
              style={selectStyle}
            >
              {availableViews.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
        </>
      )}

      {error && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-error, red)', marginTop: '8px' }}>
          {error}
        </div>
      )}
    </div>
  );
}

const AI_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
];

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '8px',
  paddingBottom: '4px',
  borderBottom: '1px solid var(--border-default)',
};

function AiTab() {
  const aiApiKey = useSettingsStore(s => s.aiApiKey);
  const setAiApiKey = useSettingsStore(s => s.setAiApiKey);
  const setEngineAiKey = useGraphStore(s => s.setAiApiKey);
  const [localKey, setLocalKey] = useState(aiApiKey);
  const [saved, setSaved] = useState(false);

  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const setAnthropicApiKey = useSettingsStore(s => s.setAnthropicApiKey);
  const aiAssistantModel = useSettingsStore(s => s.aiAssistantModel);
  const setAiAssistantModel = useSettingsStore(s => s.setAiAssistantModel);
  const [localAnthropicKey, setLocalAnthropicKey] = useState(anthropicApiKey);
  const [assistantSaved, setAssistantSaved] = useState(false);

  const handleSave = useCallback(() => {
    setAiApiKey(localKey);
    setEngineAiKey('replicate', localKey).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }, [localKey, setAiApiKey, setEngineAiKey]);

  const handleAssistantSave = useCallback(() => {
    setAnthropicApiKey(localAnthropicKey);
    setAssistantSaved(true);
    setTimeout(() => setAssistantSaved(false), 2000);
  }, [localAnthropicKey, setAnthropicApiKey]);

  const pasteKeyHandler = useCallback((
    e: React.KeyboardEvent<HTMLInputElement>,
    currentValue: string,
    setter: (v: string) => void,
    savedSetter: (v: boolean) => void,
  ) => {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      navigator.clipboard.readText().then(text => {
        if (text) {
          const input = e.currentTarget;
          const start = input.selectionStart ?? 0;
          const end = input.selectionEnd ?? currentValue.length;
          setter(currentValue.slice(0, start) + text + currentValue.slice(end));
          savedSetter(false);
        }
      });
    }
  }, []);

  const keyInputStyle: React.CSSProperties = {
    ...numberInputStyle,
    width: '100%',
    textAlign: 'left',
    fontFamily: 'monospace',
  };

  const saveButtonStyle = (isSaved: boolean): React.CSSProperties => ({
    background: isSaved ? 'var(--accent-primary)' : 'var(--bg-surface)',
    color: isSaved ? 'var(--bg-primary)' : 'var(--text-secondary)',
    border: '1px solid var(--border-default)',
    borderRadius: '3px',
    fontSize: '0.8rem',
    padding: '6px 12px',
    cursor: 'pointer',
    width: '100%',
  });

  return (
    <div>
      <div style={sectionHeaderStyle}>AI Nodes</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Enter your Replicate API token to enable AI-powered nodes like Depth Estimate and Inpaint.
      </div>
      <label style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Replicate API Token</span>
        <input
          type="password"
          value={localKey}
          onChange={e => { setLocalKey(e.target.value); setSaved(false); }}
          onKeyDown={e => pasteKeyHandler(e, localKey, setLocalKey, setSaved)}
          placeholder="r8_..."
          style={keyInputStyle}
        />
      </label>
      <div style={{ marginTop: '12px' }}>
        <button type="button" onClick={handleSave} style={saveButtonStyle(saved)}>
          {saved ? 'Saved' : 'Save API Key'}
        </button>
      </div>

      <div style={{ ...sectionHeaderStyle, marginTop: '24px' }}>AI Assistant</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Enter your Anthropic API key to enable the AI assistant (⌘L) that can build and modify node graphs from natural language.
      </div>
      <label style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Anthropic API Key</span>
        <input
          type="password"
          value={localAnthropicKey}
          onChange={e => { setLocalAnthropicKey(e.target.value); setAssistantSaved(false); }}
          onKeyDown={e => pasteKeyHandler(e, localAnthropicKey, setLocalAnthropicKey, setAssistantSaved)}
          placeholder="sk-ant-..."
          style={keyInputStyle}
        />
      </label>
      <div style={{ ...rowStyle, marginTop: '8px' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Model</span>
        <select
          value={aiAssistantModel}
          onChange={e => setAiAssistantModel(e.target.value)}
          style={selectStyle}
        >
          {AI_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
      <div style={{ marginTop: '12px' }}>
        <button type="button" onClick={handleAssistantSave} style={saveButtonStyle(assistantSaved)}>
          {assistantSaved ? 'Saved' : 'Save API Key'}
        </button>
      </div>
    </div>
  );
}

const RESOLUTION_PRESETS = [
  { label: '720p (HD)', width: 1280, height: 720 },
  { label: '1080p (Full HD)', width: 1920, height: 1080 },
  { label: '1440p (2K)', width: 2560, height: 1440 },
  { label: '2160p (4K UHD)', width: 3840, height: 2160 },
  { label: '2K DCI', width: 2048, height: 1080 },
  { label: '4K DCI', width: 4096, height: 2160 },
  { label: 'Square 1K', width: 1024, height: 1024 },
  { label: 'Square 2K', width: 2048, height: 2048 },
];

function ProjectTab() {
  const projectWidth = useSettingsStore(s => s.projectWidth);
  const projectHeight = useSettingsStore(s => s.projectHeight);
  const setProjectFormat = useGraphStore(s => s.setProjectFormat);
  const [localWidth, setLocalWidth] = useState(projectWidth);
  const [localHeight, setLocalHeight] = useState(projectHeight);

  const isCustom = !RESOLUTION_PRESETS.some(p => p.width === projectWidth && p.height === projectHeight);
  const activePreset = RESOLUTION_PRESETS.find(p => p.width === projectWidth && p.height === projectHeight);

  const applyResolution = useCallback((w: number, h: number) => {
    const clampedW = Math.max(1, Math.min(8192, Math.round(w)));
    const clampedH = Math.max(1, Math.min(8192, Math.round(h)));
    setLocalWidth(clampedW);
    setLocalHeight(clampedH);
    setProjectFormat(clampedW, clampedH);
  }, [setProjectFormat]);

  return (
    <div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        The project resolution determines the canvas size for generator nodes (Solid Color, Noise, Gradient, etc.) and the display window for compositing.
      </div>

      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Presets
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px', marginBottom: '16px' }}>
        {RESOLUTION_PRESETS.map(preset => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyResolution(preset.width, preset.height)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 10px',
              fontSize: '0.75rem',
              color: activePreset === preset ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: activePreset === preset ? 'var(--bg-surface)' : 'transparent',
              border: activePreset === preset ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
              borderRadius: '3px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <div style={{ fontWeight: activePreset === preset ? 600 : 400 }}>{preset.label}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '1px' }}>{preset.width} × {preset.height}</div>
          </button>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: '12px' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Custom{isCustom ? ` (${projectWidth} × ${projectHeight})` : ''}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            W
            <input
              type="number"
              value={localWidth}
              min={1}
              max={8192}
              onChange={e => setLocalWidth(Number(e.target.value))}
              onBlur={() => applyResolution(localWidth, localHeight)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') applyResolution(localWidth, localHeight); }}
              style={{ ...numberInputStyle, width: '70px' }}
            />
          </label>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>×</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            H
            <input
              type="number"
              value={localHeight}
              min={1}
              max={8192}
              onChange={e => setLocalHeight(Number(e.target.value))}
              onBlur={() => applyResolution(localWidth, localHeight)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') applyResolution(localWidth, localHeight); }}
              style={{ ...numberInputStyle, width: '70px' }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

const TAB_COMPONENTS: Record<Tab, React.FC> = {
  project: ProjectTab,
  appearance: AppearanceTab,
  canvas: CanvasTab,
  performance: PerformanceTab,
  playback: PlaybackTab,
  privacy: PrivacyTab,
  color: ColorTab,
  ai: AiTab,
};

const resolveInitialTab = (initialTab: string | null): Tab => {
  if (initialTab && TAB_LABELS.some(t => t.key === initialTab)) {
    return initialTab as Tab;
  }
  return 'project';
};

const SettingsModalContent: React.FC<{ initialTab: Tab; closeSettings: () => void }> = ({ initialTab, closeSettings }) => {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeSettings();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [closeSettings]);

  const ActiveTabComponent = TAB_COMPONENTS[activeTab];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--overlay-dim)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={closeSettings}
      onKeyDown={e => { if (e.key === 'Escape') closeSettings(); }}
    >
      <div
        role="document"
        style={{
          width: 600,
          height: 500,
          display: 'flex',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-default)',
          borderRadius: '6px',
          boxShadow: '0 8px 32px var(--shadow-contextMenu)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
      >
        <div
          style={{
            width: 160,
            background: 'var(--bg-primary)',
            borderRight: '1px solid var(--border-default)',
            display: 'flex',
            flexDirection: 'column',
            padding: '16px 0',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: '0 20px 16px',
              fontSize: '0.9rem',
              fontWeight: 700,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Settings
          </div>
          {TAB_LABELS.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 20px',
                fontSize: '0.8rem',
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: activeTab === tab.key ? 'var(--bg-surface)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                borderLeft: activeTab === tab.key ? '2px solid var(--accent-primary)' : '2px solid transparent',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 24px',
              borderBottom: '1px solid var(--border-default)',
            }}
          >
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {TAB_LABELS.find(t => t.key === activeTab)?.label}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {sectionDescriptions[activeTab]}
              </div>
            </div>
            <button
              type="button"
              onClick={closeSettings}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '1.1rem',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '3px',
                lineHeight: 1,
                fontFamily: 'inherit',
              }}
              title="Close settings"
            >
              &times;
            </button>
          </div>

          <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
            <ActiveTabComponent />
          </div>
        </div>
      </div>
    </div>
  );
};

export const SettingsModal: React.FC = () => {
  const isOpen = useSettingsStore(s => s.isSettingsOpen);
  const initialTab = useSettingsStore(s => s.settingsInitialTab);
  const closeSettings = useSettingsStore(s => s.closeSettings);

  if (!isOpen) return null;

  const resolvedInitialTab = resolveInitialTab(initialTab);

  return (
    <SettingsModalContent
      key={resolvedInitialTab}
      initialTab={resolvedInitialTab}
      closeSettings={closeSettings}
    />
  );
};
