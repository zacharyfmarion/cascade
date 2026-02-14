import React, { useCallback, useRef } from 'react';
import { useThemeStore } from '../store/themeStore';

export const ThemeSwitcher: React.FC = () => {
  const currentTheme = useThemeStore(s => s.currentTheme);
  const presetThemes = useThemeStore(s => s.presetThemes);
  const customThemes = useThemeStore(s => s.customThemes);
  const setThemeByName = useThemeStore(s => s.setThemeByName);
  const importVSCodeThemeJson = useThemeStore(s => s.importVSCodeThemeJson);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allThemes = [...presetThemes, ...customThemes];

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (e.target.value === '__import__') {
        fileInputRef.current?.click();
        e.target.value = currentTheme.name;
        return;
      }
      setThemeByName(e.target.value);
    },
    [setThemeByName, currentTheme.name]
  );

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
    <>
      <select
        className="toolbar__btn"
        value={currentTheme.name}
        onChange={handleChange}
        title="Switch theme"
        style={{ cursor: 'pointer' }}
      >
        {allThemes.map(t => (
          <option key={t.name} value={t.name}>
            {t.name}
          </option>
        ))}
        <option disabled>──────────</option>
        <option value="__import__">Import VS Code Theme...</option>
      </select>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.jsonc"
        onChange={handleImportFile}
        style={{ display: 'none' }}
      />
    </>
  );
};
