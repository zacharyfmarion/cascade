import type { CascadeTheme, ThemeTokens, SyntaxColors } from './types';

interface VSCodeTokenColor {
  name?: string;
  scope?: string | string[];
  settings?: {
    foreground?: string;
    fontStyle?: string;
  };
}

interface VSCodeThemeJson {
  name?: string;
  type?: string;
  colors?: Record<string, string>;
  tokenColors?: VSCodeTokenColor[];
  [key: string]: unknown;
}

type TokenMapping = [vscodeKey: string, cascadeToken: keyof ThemeTokens];

const VSCODE_TO_CASCADE: TokenMapping[] = [
  ['editor.background', 'bg.primary'],
  ['sideBar.background', 'bg.secondary'],
  ['editorGroupHeader.tabsBackground', 'bg.tertiary'],
  ['editorWidget.background', 'bg.surface'],
  ['editor.background', 'bg.canvas'],

  ['editor.foreground', 'text.primary'],
  ['sideBar.foreground', 'text.secondary'],
  ['editorLineNumber.foreground', 'text.muted'],

  ['focusBorder', 'accent.primary'],
  ['button.background', 'accent.primary'],
  ['button.hoverBackground', 'accent.hover'],

  ['sideBar.border', 'border.default'],
  ['panel.border', 'border.default'],
  ['focusBorder', 'border.active'],

  ['errorForeground', 'status.danger'],
  ['testing.iconPassed', 'status.success'],
];

function darken(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  const r = Math.max(0, ((num >> 16) & 0xff) - Math.round(amount * 255));
  const g = Math.max(0, ((num >> 8) & 0xff) - Math.round(amount * 255));
  const b = Math.max(0, (num & 0xff) - Math.round(amount * 255));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function lighten(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(amount * 255));
  const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(amount * 255));
  const b = Math.min(255, (num & 0xff) + Math.round(amount * 255));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const num = parseInt(clean.substring(0, 6), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(value);
}

export function importVSCodeTheme(json: VSCodeThemeJson): CascadeTheme {
  const colors = json.colors ?? {};
  const isDark = (json.type ?? 'dark') !== 'light';
  const name = json.name ?? 'Imported Theme';

  const bg = colors['editor.background'] ?? (isDark ? '#1e1e1e' : '#ffffff');
  const fg = colors['editor.foreground'] ?? (isDark ? '#d4d4d4' : '#333333');
  const accent = colors['button.background'] ?? colors['focusBorder'] ?? (isDark ? '#007acc' : '#007acc');
  const danger = colors['errorForeground'] ?? '#e74c3c';
  const success = colors['testing.iconPassed'] ?? (isDark ? '#2ecc71' : '#859900');

  const result: Partial<ThemeTokens> = {};

  for (const [vscodeKey, cascadeToken] of VSCODE_TO_CASCADE) {
    const value = colors[vscodeKey];
    if (value && isValidHex(value) && !(cascadeToken in result)) {
      result[cascadeToken] = value;
    }
  }

  const sidebarBg = result['bg.secondary'] ?? (isDark ? darken(bg, 0.03) : lighten(bg, 0.03));
  const surfaceBg = result['bg.surface'] ?? (isDark ? lighten(bg, 0.02) : darken(bg, 0.02));

  const defaults: ThemeTokens = {
    'bg.primary': result['bg.primary'] ?? bg,
    'bg.secondary': sidebarBg,
    'bg.tertiary': result['bg.tertiary'] ?? (isDark ? lighten(bg, 0.08) : darken(bg, 0.08)),
    'bg.surface': surfaceBg,
    'bg.canvas': result['bg.canvas'] ?? (isDark ? darken(bg, 0.04) : bg),
    'bg.canvasGrid': isDark ? lighten(bg, 0.06) : darken(bg, 0.06),

    'text.primary': result['text.primary'] ?? fg,
    'text.secondary': result['text.secondary'] ?? (isDark ? lighten(fg, -0.15) : darken(fg, 0.15)),
    'text.muted': result['text.muted'] ?? (isDark ? '#606080' : '#93a1a1'),

    'accent.primary': result['accent.primary'] ?? accent,
    'accent.hover': result['accent.hover'] ?? lighten(accent, 0.08),

    'border.default': result['border.default'] ?? (isDark ? lighten(bg, 0.1) : darken(bg, 0.1)),
    'border.active': result['border.active'] ?? accent,

    'status.danger': danger,
    'status.success': success,
    'status.errorBg': hexToRgba(danger, 0.9),

    'port.image': colors['terminal.ansiCyan'] ?? (isDark ? '#00d4aa' : '#2aa198'),
    'port.float': isDark ? '#a0a0a0' : '#586e75',
    'port.int': colors['terminal.ansiGreen'] ?? (isDark ? '#4ca04c' : '#859900'),
    'port.bool': colors['terminal.ansiMagenta'] ?? (isDark ? '#cc66cc' : '#d33682'),
    'port.color': colors['terminal.ansiYellow'] ?? (isDark ? '#cccc00' : '#b58900'),
    'port.mask': isDark ? '#ffffff' : '#073642',
    'port.field': isDark ? '#9b59b6' : '#7d3c98',

    'frame.default': isDark ? 'rgba(108, 92, 231, 0.08)' : 'rgba(108, 92, 231, 0.12)',

    'node.bg': surfaceBg,
    'node.selected': isDark ? lighten(surfaceBg, 0.08) : darken(surfaceBg, 0.08),
    'node.shadow': isDark ? '0 2px 8px rgba(0,0,0,0.35)' : '0 2px 8px rgba(0,0,0,0.1)',
    'node.shadowSelected': `0 0 0 2px ${accent}, 0 4px 12px rgba(0,0,0,${isDark ? '0.45' : '0.15'})`,
    'node.header.input': hexToRgba(colors['terminal.ansiCyan'] ?? '#00d4aa', 0.18),
    'node.header.output': hexToRgba(danger, 0.18),
    'node.header.color': hexToRgba(colors['terminal.ansiMagenta'] ?? '#cc66cc', 0.18),
    'node.header.filter': hexToRgba(accent, 0.18),
    'node.header.composite': hexToRgba(colors['terminal.ansiYellow'] ?? '#cccc00', 0.18),
    'node.header.transform': hexToRgba(colors['terminal.ansiCyan'] ?? '#00d4aa', 0.18),
    'node.header.generator': hexToRgba(colors['terminal.ansiGreen'] ?? '#4ca04c', 0.18),
    'node.header.matte': hexToRgba(fg, 0.15),
    'node.header.group': hexToRgba(accent, 0.22),
    'node.header.groupInput': hexToRgba(colors['terminal.ansiGreen'] ?? (isDark ? '#4ca04c' : '#859900'), 0.22),
    'node.header.groupOutput': hexToRgba(colors['terminal.ansiRed'] ?? danger, 0.22),
    'node.header.text': isDark ? '#ffffff' : '#1a1a1a',

    'slider.fill': hexToRgba(accent, 0.3),
    'slider.fillHover': hexToRgba(accent, 0.45),
    'slider.bg': 'rgba(0, 0, 0, 0.3)',

    'shadow.overlay': isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.25)',
    'shadow.contextMenu': isDark ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.15)',
    'minimap.mask': isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.5)',
  };

  const syntaxColors = extractSyntaxColors(json.tokenColors, fg, isDark);

  return {
    name,
    type: isDark ? 'dark' : 'light',
    colors: defaults,
    syntaxColors,
  };
}

/**
 * Extract syntax highlighting colors from VS Code tokenColors.
 * Maps TextMate scopes to our SyntaxColors interface.
 * Falls back to sensible defaults when scopes aren't found.
 */
function extractSyntaxColors(
  tokenColors: VSCodeTokenColor[] | undefined,
  fg: string,
  isDark: boolean,
): SyntaxColors {
  const defaults: SyntaxColors = isDark
    ? {
        comment: '#6A9955',
        keyword: '#C586C0',
        type: '#4EC9B0',
        variable: '#9CDCFE',
        parameter: '#DCDCAA',
        port: '#CE9178',
        function: '#DCDCAA',
        number: '#B5CEA8',
        string: '#CE9178',
        operator: '#C586C0',
        stringEscape: '#D7BA7D',
        foreground: '#D4D4D4',
      }
    : {
        comment: '#6E7781',
        keyword: '#CF222E',
        type: '#953800',
        variable: '#24292F',
        parameter: '#0550AE',
        port: '#116329',
        function: '#8250DF',
        number: '#0550AE',
        string: '#0A3069',
        operator: '#CF222E',
        stringEscape: '#953800',
        foreground: '#24292F',
      };

  if (!tokenColors || tokenColors.length === 0) {
    return { ...defaults, foreground: fg };
  }

  // Build a scope→foreground lookup from tokenColors
  const scopeMap = new Map<string, string>();
  for (const tc of tokenColors) {
    const color = tc.settings?.foreground;
    if (!color || !isValidHex(color)) continue;
    const scopes = Array.isArray(tc.scope)
      ? tc.scope
      : tc.scope
        ? tc.scope.split(',').map((s) => s.trim())
        : [];
    for (const scope of scopes) {
      if (!scopeMap.has(scope)) {
        scopeMap.set(scope, color);
      }
    }
  }

  /** Find the first matching color for a list of scope candidates. */
  function find(...candidates: string[]): string | undefined {
    for (const c of candidates) {
      const color = scopeMap.get(c);
      if (color) return color;
    }
    return undefined;
  }

  return {
    comment:
      find('comment', 'comment.line', 'comment.block') ?? defaults.comment,
    keyword:
      find(
        'keyword',
        'keyword.control',
        'keyword.operator',
        'storage.type',
      ) ?? defaults.keyword,
    type:
      find(
        'entity.name.type',
        'support.type',
        'support.class',
        'entity.name.class',
      ) ?? defaults.type,
    variable:
      find('variable', 'variable.other', 'variable.other.readwrite') ??
      defaults.variable,
    parameter:
      find(
        'variable.parameter',
        'entity.other.attribute-name',
        'support.function',
      ) ?? defaults.parameter,
    port:
      find(
        'entity.name.tag',
        'meta.object-literal.key',
        'support.type.property-name',
      ) ?? defaults.port,
    function:
      find(
        'entity.name.function',
        'support.function',
        'meta.function-call',
      ) ?? defaults.function,
    number:
      find('constant.numeric', 'constant.other', 'constant.language') ??
      defaults.number,
    string:
      find('string', 'string.quoted', 'string.quoted.double') ??
      defaults.string,
    operator:
      find('keyword.operator', 'punctuation', 'keyword') ??
      defaults.operator,
    stringEscape:
      find(
        'constant.character.escape',
        'constant.character',
        'string.regexp',
      ) ?? defaults.stringEscape,
    foreground: fg,
  };
}
