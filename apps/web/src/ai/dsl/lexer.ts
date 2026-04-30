import { createToken, Lexer } from 'chevrotain';

export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[ \t\r\n]+/,
  group: Lexer.SKIPPED,
  line_breaks: true,
});

export const Comment = createToken({
  name: 'Comment',
  pattern: /#[^\r\n]*/,
  group: 'comments',
});

export const TripleStringLiteral = createToken({
  name: 'TripleStringLiteral',
  pattern: /"""(?:[\s\S]*?)"""/,
  line_breaks: true,
});

export const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /"(?:\\.|[^"\\])*"/,
});

export const NumberLiteral = createToken({
  name: 'NumberLiteral',
  pattern: /-?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][+-]?\d+)?/,
});

export const Identifier = createToken({
  name: 'Identifier',
  pattern: /[a-z][a-z0-9_]*/,
});

export const TypeIdentifier = createToken({
  name: 'TypeIdentifier',
  pattern: /[A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*/,
});

export const Cascade = createToken({ name: 'Cascade', pattern: /cascade/, longer_alt: Identifier });
export const Graph = createToken({ name: 'Graph', pattern: /graph/, longer_alt: Identifier });
export const Node = createToken({ name: 'Node', pattern: /node/, longer_alt: Identifier });
export const Group = createToken({ name: 'Group', pattern: /group/, longer_alt: Identifier });
export const Gpu = createToken({ name: 'Gpu', pattern: /gpu/, longer_alt: Identifier });
export const Inputs = createToken({ name: 'Inputs', pattern: /inputs/, longer_alt: Identifier });
export const Outputs = createToken({ name: 'Outputs', pattern: /outputs/, longer_alt: Identifier });
export const Params = createToken({ name: 'Params', pattern: /params/, longer_alt: Identifier });
export const Code = createToken({ name: 'Code', pattern: /code/, longer_alt: Identifier });
export const Muted = createToken({ name: 'Muted', pattern: /muted/, longer_alt: Identifier });
export const True = createToken({ name: 'True', pattern: /true/, longer_alt: Identifier });
export const False = createToken({ name: 'False', pattern: /false/, longer_alt: Identifier });
export const Min = createToken({ name: 'Min', pattern: /min/, longer_alt: Identifier });
export const Max = createToken({ name: 'Max', pattern: /max/, longer_alt: Identifier });
export const Step = createToken({ name: 'Step', pattern: /step/, longer_alt: Identifier });

export const Arrow = createToken({ name: 'Arrow', pattern: /->/ });
export const DoubleColon = createToken({ name: 'DoubleColon', pattern: /::/ });
export const LCurly = createToken({ name: 'LCurly', pattern: /\{/ });
export const RCurly = createToken({ name: 'RCurly', pattern: /\}/ });
export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const LSquare = createToken({ name: 'LSquare', pattern: /\[/ });
export const RSquare = createToken({ name: 'RSquare', pattern: /\]/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });
export const Equals = createToken({ name: 'Equals', pattern: /=/ });
export const Question = createToken({ name: 'Question', pattern: /\?/ });

export const cascadeDslTokens = [
  WhiteSpace,
  Comment,
  TripleStringLiteral,
  StringLiteral,
  Arrow,
  DoubleColon,
  LCurly,
  RCurly,
  LParen,
  RParen,
  LSquare,
  RSquare,
  Comma,
  Colon,
  Dot,
  Equals,
  Question,
  Cascade,
  Graph,
  Node,
  Group,
  Gpu,
  Inputs,
  Outputs,
  Params,
  Code,
  Muted,
  True,
  False,
  Min,
  Max,
  Step,
  NumberLiteral,
  TypeIdentifier,
  Identifier,
];

export const cascadeDslLexer = new Lexer(cascadeDslTokens, {
  ensureOptimizations: true,
  positionTracking: 'full',
});

export type CascadeDslTokenName = (typeof cascadeDslTokens)[number]['name'];

