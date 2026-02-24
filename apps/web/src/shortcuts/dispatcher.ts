import type { KeyCombo, ShortcutDefinition, ShortcutHandler } from './types';
import { isTextInputFocused } from './focusDetection';

// ── Key normalisation ───────────────────────────────────────────

function normalizeEvent(e: KeyboardEvent): KeyCombo {
  return {
    key: e.key.toLowerCase(),
    mod: e.metaKey || e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
  };
}

function combosMatch(combo: KeyCombo, event: KeyCombo): boolean {
  return (
    combo.key === event.key &&
    combo.mod === event.mod &&
    combo.shift === event.shift &&
    combo.alt === event.alt
  );
}

// ── Dispatcher ──────────────────────────────────────────────────

class ShortcutDispatcher {
  private registry: ShortcutDefinition[] = [];
  private handlers = new Map<string, ShortcutHandler>();
  private detach: (() => void) | null = null;

  /** Set the shortcut definitions. Called once at startup. */
  setRegistry(definitions: ShortcutDefinition[]): void {
    this.registry = definitions;
  }

  /** Register an action handler for a shortcut id. Returns unregister fn. */
  register(id: string, handler: ShortcutHandler): () => void {
    this.handlers.set(id, handler);
    return () => this.handlers.delete(id);
  }

  /** Attach the single window keydown listener. Returns detach fn. */
  attach(): () => void {
    if (this.detach) return this.detach;

    const listener = (e: KeyboardEvent) => {
      // Skip if another handler already consumed this event
      if (e.defaultPrevented) return;

      const eventCombo = normalizeEvent(e);
      const textFocused = isTextInputFocused(e);

      for (const def of this.registry) {
        // Check key match
        const matched = def.keys.some(k => combosMatch(k, eventCombo));
        if (!matched) continue;

        // Context gate: 'app' shortcuts are suppressed when text input is focused
        if (def.context === 'app' && textFocused) continue;

        // Repeat gate: ignore held-down key events unless explicitly allowed
        if (e.repeat && !def.repeat) continue;

        // Runtime guard
        if (def.when && !def.when()) continue;

        // Find registered handler
        const handler = this.handlers.get(def.id);
        if (!handler) continue;

        e.preventDefault();
        e.stopPropagation();
        handler(e);
        return; // First match wins
      }
    };

    window.addEventListener('keydown', listener);
    this.detach = () => {
      window.removeEventListener('keydown', listener);
      this.detach = null;
    };
    return this.detach;
  }
}

/** Singleton dispatcher instance. */
export const shortcutDispatcher = new ShortcutDispatcher();
