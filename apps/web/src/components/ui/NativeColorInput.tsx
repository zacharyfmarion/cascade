/**
 * NativeColorInput — Correct event handling for <input type="color">.
 *
 * React's `onChange` on <input type="color"> fires continuously during drag
 * (React normalises it to the DOM `input` event). The DOM `change` event —
 * which fires only when the picker is dismissed — is never exposed by React.
 *
 * This component provides two callbacks:
 *   onLive   – fires on every color change during drag (deduped by hex value)
 *   onCommit – fires once when the user dismisses the picker
 *
 * All 5 <input type="color"> sites in the codebase should use this component
 * instead of inlining the workaround each time.
 */
import React, { useCallback, useEffect, useRef } from 'react';

interface NativeColorInputProps {
  /** Current hex color value, e.g. "#ff0000" */
  value: string;
  /** Fires on every color change during drag (deduped). */
  onLive?: (hex: string) => void;
  /** Fires once when the picker is dismissed (native DOM change event). */
  onCommit?: (hex: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const NativeColorInput: React.FC<NativeColorInputProps> = ({
  value,
  onLive,
  onCommit,
  className,
  style,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastHexRef = useRef<string>(value);

  // Live updates — deduped so identical hex values don't trigger re-renders.
  const handleInput = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    const hex = (e.target as HTMLInputElement).value;
    if (hex === lastHexRef.current) return;
    lastHexRef.current = hex;
    onLive?.(hex);
  }, [onLive]);

  // Commit — native DOM 'change' fires only when the picker is dismissed.
  // We bypass React entirely to get the real DOM event.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handleNativeChange = () => {
      onCommit?.(el.value);
    };
    el.addEventListener('change', handleNativeChange);
    return () => el.removeEventListener('change', handleNativeChange);
  }, [onCommit]);

  return (
    <input
      ref={inputRef}
      type="color"
      value={value}
      onInput={handleInput}
      className={className}
      style={style}
    />
  );
};
