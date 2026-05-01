// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsModal } from '../SettingsModal';
import { useGraphStore } from '../../store/graphStore';
import { useSettingsStore } from '../../store/settingsStore';

const setTauriMode = (enabled: boolean) => {
  if (enabled) {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
};

describe('SettingsModal project assets', () => {
  beforeEach(() => {
    setTauriMode(false);
    useSettingsStore.setState({ isSettingsOpen: true, settingsInitialTab: 'project' });
    useGraphStore.setState({
      currentProjectAssetStorage: null,
      projectAssets: {},
    });
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState({ isSettingsOpen: false, settingsInitialTab: null });
    setTauriMode(false);
  });

  it('shows read-only browser asset storage status on web', () => {
    useGraphStore.setState({
      projectAssets: {
        load1: {
          type: 'image',
          source: 'embedded',
          data: 'AQID',
        },
      },
    });

    render(React.createElement(SettingsModal));

    expect(screen.getByText('Assets are included in saved project files')).toBeTruthy();
    expect(screen.getByText(/Browsers cannot save durable references to local files/)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('keeps the asset storage dropdown on desktop', () => {
    setTauriMode(true);
    render(React.createElement(SettingsModal));

    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(screen.getByText('Reference external files')).toBeTruthy();
    expect(screen.getByText('Bundle with project')).toBeTruthy();
  });
});
