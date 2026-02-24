/**
 * Robust detection of whether a text-input element is currently focused.
 *
 * Handles: native inputs, textareas, selects, contentEditable, Monaco editor,
 * and any future editor marked with data-shortcuts-text-input.
 */

const TEXT_INPUT_MARKER = 'data-shortcuts-text-input';

function isNativeTextControl(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type?.toLowerCase() ?? 'text';
    // Exclude non-text input types
    const nonText = ['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'];
    return !nonText.includes(type);
  }
  return false;
}

function isContentEditable(el: Element): boolean {
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * Returns true if any text-input element currently has focus.
 *
 * Uses both the event's composedPath (reliable for shadow DOM / Monaco)
 * and document.activeElement as a fallback.
 */
export function isTextInputFocused(e?: KeyboardEvent): boolean {
  // Check composedPath if we have an event — this is more reliable than
  // activeElement for Monaco, which manages focus through internal elements.
  if (e && typeof e.composedPath === 'function') {
    for (const node of e.composedPath()) {
      if (!(node instanceof Element)) continue;
      if (isNativeTextControl(node)) return true;
      if (isContentEditable(node)) return true;
      if (node.getAttribute('role') === 'textbox') return true;
      if (node.hasAttribute(TEXT_INPUT_MARKER)) return true;
      if (node.classList.contains('monaco-editor')) return true;
    }
  }

  // Fallback: check activeElement directly
  const el = document.activeElement;
  if (!el || el === document.body) return false;

  if (isNativeTextControl(el)) return true;
  if (isContentEditable(el)) return true;
  if (el.getAttribute('role') === 'textbox') return true;
  if (el.hasAttribute(TEXT_INPUT_MARKER)) return true;

  // Monaco: the activeElement may be a child of .monaco-editor
  if (el.closest('.monaco-editor')) return true;

  return false;
}
