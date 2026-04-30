import { describe, expect, it } from 'vitest';
import { cascadeDslLexer } from '../lexer';

const tokenNames = (input: string): string[] => {
  const result = cascadeDslLexer.tokenize(input);
  expect(result.errors).toEqual([]);
  return result.tokens.map(token => token.tokenType.name);
};

describe('cascadeDslLexer', () => {
  it('tokenizes root graph statements and arrow connections', () => {
    expect(tokenNames([
      'cascade 1',
      'graph {',
      '  load1 = LoadImage(path: image("file:///a.png"))',
      '  load1.image -> viewer1.value',
      '}',
    ].join('\n'))).toEqual([
      'Cascade',
      'NumberLiteral',
      'Graph',
      'LCurly',
      'Identifier',
      'Equals',
      'TypeIdentifier',
      'LParen',
      'Identifier',
      'Colon',
      'Identifier',
      'LParen',
      'StringLiteral',
      'RParen',
      'RParen',
      'Identifier',
      'Dot',
      'Identifier',
      'Arrow',
      'Identifier',
      'Dot',
      'Identifier',
      'RCurly',
    ]);
  });

  it('tokenizes group and gpu definitions with declarations and code blocks', () => {
    expect(tokenNames([
      'node FilmGlow = gpu {',
      '  inputs {',
      '    image image',
      '    mask mask?',
      '    float gain = 1.2 min 0.0 max 4.0 step 0.01',
      '  }',
      '',
      '  outputs {',
      '    image image',
      '  }',
      '',
      '  code """',
      '  return color * gain;',
      '  """',
      '}',
    ].join('\n'))).toContain('TripleStringLiteral');
  });

  it('captures comments separately without exposing them as parser tokens', () => {
    const result = cascadeDslLexer.tokenize([
      '# leading comment',
      'graph {',
      '  viewer1 = Viewer() # trailing comment',
      '}',
    ].join('\n'));

    expect(result.errors).toEqual([]);
    expect(result.tokens.map(token => token.tokenType.name)).not.toContain('Comment');
    expect(result.groups.comments).toHaveLength(2);
  });
});

