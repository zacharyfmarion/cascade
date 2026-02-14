import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';
import { useLayoutStore } from '../store/layoutStore';

type Tab = 'appearance' | 'canvas' | 'performance' | 'playback';

const TAB_LABELS: { key: Tab; label: string }[] = [
  { key: 'appearance', label: 'Appearance' },
  { key: 'canvas', label: 'Canvas' },
  { key: 'performance', label: 'Performance' },
  { key: 'playback', label: 'Playback' },
];

const sectionDescriptions: Record<Tab, string> = {
  appearance: 'Customize the look and feel of the application.',
  canvas: 'Configure node canvas behavior and display options.',
  performance: 'Tune preview rendering performance for your hardware.',
  playback: 'Set default playback behavior for image sequences.',
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

function AppearanceTab() {
  const currentTheme = useThemeStore(s => s.currentTheme);
  const presetThemes = useThemeStore(s => s.presetThemes);
  const customThemes = useThemeStore(s => s.customThemes);
  const setThemeByName = useThemeStore(s => s.setThemeByName);
  const importVSCodeThemeJson = useThemeStore(s => s.importVSCodeThemeJson);
  const resetLayout = useLayoutStore(s => s.resetLayout);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allThemes = [...presetThemes, ...customThemes];

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      file.text().then(text => {
        try {
          importVSCodeThemeJson(text);
        } catch (err) {
          console.error('Failed to import VS Code theme:', err);
        }
      });
      e.target.value = '';
    },
    [importVSCodeThemeJson]
  );

  return (
    <div>
      <label style={rowStyle}>
        <span style={{ color: 'var(--text-secondary)' }}>Theme</span>
        <select
          value={currentTheme.name}
          onChange={e => setThemeByName(e.target.value)}
          style={selectStyle}
        >
          {allThemes.map(t => (
            <option key={t.name} value={t.name}>{t.name}</option>
          ))}
        </select>
      </label>
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

const TAB_COMPONENTS: Record<Tab, React.FC> = {
  appearance: AppearanceTab,
  canvas: CanvasTab,
  performance: PerformanceTab,
  playback: PlaybackTab,
};

export const SettingsModal: React.FC = () => {
  const isOpen = useSettingsStore(s => s.isSettingsOpen);
  const closeSettings = useSettingsStore(s => s.closeSettings);
  const [activeTab, setActiveTab] = useState<Tab>('appearance');

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeSettings();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isOpen, closeSettings]);

  if (!isOpen) return null;

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
        background: 'var(--shadow-overlay)',
      }}
      onClick={closeSettings}
      onKeyDown={e => { if (e.key === 'Escape') closeSettings(); }}
    >
      <div
        role="document"
        style={{
          width: 600,
          minHeight: 400,
          maxHeight: 450,
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
            padding: '12px 0',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: '0 16px 12px',
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
                padding: '8px 16px',
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
              padding: '12px 16px',
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

          <div style={{ padding: '16px', overflowY: 'auto', flex: 1 }}>
            <ActiveTabComponent />
          </div>
        </div>
      </div>
    </div>
  );
};
