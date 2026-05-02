/**
 * Cascade Theme System
 *
 * All UI colors must come from theme tokens. Direct hex/rgb values are
 * banned in component code and enforced by the `no-hardcoded-colors` ESLint rule.
 *
 * To add a new semantic color:
 *   1. Add the token to `ThemeTokens`
 *   2. Add a value for it in every preset theme JSON
 *   3. Reference it in CSS/JSX as `var(--<token-with-dashes>)` e.g. `var(--bg-primary)`
 */

/** Every token key a Cascade theme must define. */
export interface ThemeTokens {
  // ── Backgrounds ──────────────────────────────────────────────
  'bg.primary': string;
  'bg.secondary': string;
  'bg.tertiary': string;
  'bg.surface': string;
  'bg.canvas': string;
  'bg.canvasGrid': string;

  // ── Text ─────────────────────────────────────────────────────
  'text.primary': string;
  'text.secondary': string;
  'text.muted': string;
  'text.inverse': string;

  // ── Accent ───────────────────────────────────────────────────
  'accent.primary': string;
  'accent.hover': string;

  // ── Borders ──────────────────────────────────────────────────
  'border.default': string;
  'border.active': string;

  // ── Status / semantic ────────────────────────────────────────
  'status.danger': string;
  'status.success': string;
  'status.errorBg': string;

   // ── Port type colors (domain-specific) ───────────────────────
   'port.image': string;
   'port.float': string;
   'port.int': string;
   'port.bool': string;
   'port.color': string;
   'port.mask': string;
   'port.field': string;

  // ── Node chrome ──────────────────────────────────────────────
  'frame.default': string;
  'node.bg': string;
  'node.selected': string;
  'node.shadow': string;
  'node.shadowSelected': string;
  'node.header.input': string;
  'node.header.output': string;
  'node.header.color': string;
  'node.header.filter': string;
  'node.header.composite': string;
  'node.header.transform': string;
  'node.header.generator': string;
  'node.header.matte': string;
  'node.header.group': string;
  'node.header.groupInput': string;
  'node.header.groupOutput': string;
  'node.header.text': string;

  // ── Interactive / slider ─────────────────────────────────────
  'slider.fill': string;
  'slider.fillHover': string;
  'slider.bg': string;

  // ── Overlay / shadow ─────────────────────────────────────────
  'shadow.overlay': string;
  'shadow.contextMenu': string;
  'minimap.mask': string;
}

/**
 * Syntax highlighting colors for the DSL editor.
 * Maps semantic token roles to hex colors, derived from each theme's
 * VS Code origins. Used by Monaco's defineTheme to color DSL tokens.
 */
export interface SyntaxColors {
  /** Comments (#...) */
  comment: string;
  /** Keywords: @muted, true, false */
  keyword: string;
  /** Node type names: GaussianBlur, Blend */
  type: string;
  /** Handle / variable names */
  variable: string;
  /** Parameter keys (before colon) */
  parameter: string;
  /** Port names (after dot) */
  port: string;
  /** Built-in functions: rgba, palette, ramp, curve */
  function: string;
  /** Numeric literals */
  number: string;
  /** String literals */
  string: string;
  /** Operators: <-, = */
  operator: string;
  /** Escape sequences in strings */
  stringEscape: string;
  /** Default foreground for delimiters etc. */
  foreground: string;
}

/** Full theme definition. */
export interface CascadeTheme {
  /** Human-readable name shown in the theme picker. */
  name: string;
  /** Light or dark — used for scrollbar/select styling. */
  type: 'dark' | 'light';
  /** Complete color map. Every key from ThemeTokens must be present. */
  colors: ThemeTokens;
  /** Syntax highlighting colors for the code/DSL editor. */
  syntaxColors: SyntaxColors;
}

/**
 * Converts a theme token key to its CSS custom property name.
 *
 * `'bg.primary'` -> `'--bg-primary'`
 */
export function tokenToCssVar(token: string): string {
  return `--${token.replace(/\./g, '-')}`;
}

/**
 * All token keys — used for runtime validation and iteration.
 * Kept in sync with the ThemeTokens interface above.
 */
export const THEME_TOKEN_KEYS: ReadonlyArray<keyof ThemeTokens> = [
  'bg.primary',
  'bg.secondary',
  'bg.tertiary',
  'bg.surface',
  'bg.canvas',
  'bg.canvasGrid',

  'text.primary',
  'text.secondary',
  'text.muted',
  'text.inverse',

  'accent.primary',
  'accent.hover',

  'border.default',
  'border.active',

  'status.danger',
  'status.success',
  'status.errorBg',

   'port.image',
   'port.float',
   'port.int',
   'port.bool',
   'port.color',
   'port.mask',
   'port.field',

  'frame.default',
  'node.bg',
  'node.selected',
  'node.shadow',
  'node.shadowSelected',
  'node.header.input',
  'node.header.output',
  'node.header.color',
  'node.header.filter',
  'node.header.composite',
  'node.header.transform',
  'node.header.generator',
  'node.header.matte',
  'node.header.group',
  'node.header.groupInput',
  'node.header.groupOutput',
  'node.header.text',

  'slider.fill',
  'slider.fillHover',
  'slider.bg',

  'shadow.overlay',
  'shadow.contextMenu',
  'minimap.mask',
] as const;
