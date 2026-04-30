// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UnsavedChangesModal } from '../UnsavedChangesModal';
import { useGraphStore } from '../../store/graphStore';

vi.mock('../../engine/wasmEngine', () => ({
  initWasmEngine: vi.fn(),
  wasmEngine: null,
}));

describe('UnsavedChangesModal', () => {
  afterEach(() => {
    cleanup();
    useGraphStore.setState({
      unsavedChangesPrompt: null,
      currentProjectName: 'Untitled',
    });
  });

  it('renders Save, Discard, and Cancel choices for dirty project actions', () => {
    useGraphStore.setState({
      currentProjectName: 'Shot 01',
      unsavedChangesPrompt: { kind: 'new' },
    });

    render(React.createElement(UnsavedChangesModal));

    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeTruthy();
    expect(screen.getByText('Save changes to Shot 01?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('dispatches the selected modal choice', () => {
    const resolve = vi.fn();
    useGraphStore.setState({
      unsavedChangesPrompt: { kind: 'open' },
      resolveUnsavedChanges: resolve,
    });

    render(React.createElement(UnsavedChangesModal));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(resolve).toHaveBeenCalledWith('discard');
  });
});
