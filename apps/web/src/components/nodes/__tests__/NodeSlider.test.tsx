// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeSlider } from '../NodeSlider';

describe('NodeSlider', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('selects the full value when a click opens text editing', () => {
    render(
      <NodeSlider
        label="Exposure"
        value={2.14}
        min={-5}
        max={5}
        step={0.01}
        onChange={vi.fn()}
        onChangeCommit={vi.fn()}
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Exposure' });

    fireEvent.pointerDown(slider, { button: 0, clientX: 20, pointerId: 1 });
    fireEvent.pointerUp(slider, { button: 0, clientX: 20, pointerId: 1 });

    const input = screen.getByRole('textbox') as HTMLInputElement;

    expect(input.value).toBe('2.14');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});
