const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3,4}){1,2}$/;
const RGB_PATTERN = /^rgba?\s*\(/i;
const HSL_PATTERN = /^hsla?\s*\(/i;

const CSS_NAMED_COLORS = new Set([
  'aliceblue','antiquewhite','aqua','aquamarine','azure','beige','bisque','black',
  'blanchedalmond','blue','blueviolet','brown','burlywood','cadetblue','chartreuse',
  'chocolate','coral','cornflowerblue','cornsilk','crimson','cyan','darkblue',
  'darkcyan','darkgoldenrod','darkgray','darkgreen','darkgrey','darkkhaki',
  'darkmagenta','darkolivegreen','darkorange','darkorchid','darkred','darksalmon',
  'darkseagreen','darkslateblue','darkslategray','darkslategrey','darkturquoise',
  'darkviolet','deeppink','deepskyblue','dimgray','dimgrey','dodgerblue','firebrick',
  'floralwhite','forestgreen','fuchsia','gainsboro','ghostwhite','gold','goldenrod',
  'gray','green','greenyellow','grey','honeydew','hotpink','indianred','indigo',
  'ivory','khaki','lavender','lavenderblush','lawngreen','lemonchiffon','lightblue',
  'lightcoral','lightcyan','lightgoldenrodyellow','lightgray','lightgreen','lightgrey',
  'lightpink','lightsalmon','lightseagreen','lightskyblue','lightslategray',
  'lightslategrey','lightsteelblue','lightyellow','lime','limegreen','linen','magenta',
  'maroon','mediumaquamarine','mediumblue','mediumorchid','mediumpurple',
  'mediumseagreen','mediumslateblue','mediumspringgreen','mediumturquoise',
  'mediumvioletred','midnightblue','mintcream','mistyrose','moccasin','navajowhite',
  'navy','oldlace','olive','olivedrab','orange','orangered','orchid','palegoldenrod',
  'palegreen','paleturquoise','palevioletred','papayawhip','peachpuff','peru','pink',
  'plum','powderblue','purple','rebeccapurple','red','rosybrown','royalblue',
  'saddlebrown','salmon','sandybrown','seagreen','seashell','sienna','silver',
  'skyblue','slateblue','slategray','slategrey','snow','springgreen','steelblue',
  'tan','teal','thistle','tomato','turquoise','violet','wheat','white','whitesmoke',
  'yellow','yellowgreen',
]);

const SAFE_VALUES = new Set([
  'transparent', 'inherit', 'currentColor', 'currentcolor', 'none', 'initial', 'unset',
]);

const COLOR_STYLE_PROPS = new Set([
  'color', 'backgroundColor', 'background', 'borderColor', 'borderTopColor',
  'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor',
  'textDecorationColor', 'fill', 'stroke', 'stopColor', 'floodColor',
  'lightingColor', 'columnRuleColor', 'caretColor', 'accentColor',
  'boxShadow', 'textShadow',
]);

function isColorProperty(name) {
  return COLOR_STYLE_PROPS.has(name);
}

function isHardcodedColor(value) {
  if (typeof value !== 'string') return false;
  if (SAFE_VALUES.has(value.toLowerCase())) return false;
  if (value.startsWith('var(')) return false;
  if (HEX_PATTERN.test(value)) return true;
  if (RGB_PATTERN.test(value)) return true;
  if (HSL_PATTERN.test(value)) return true;
  if (CSS_NAMED_COLORS.has(value.toLowerCase())) return true;
  return false;
}

function containsHardcodedColor(value) {
  if (typeof value !== 'string') return false;
  if (SAFE_VALUES.has(value.toLowerCase())) return false;
  if (HEX_PATTERN.test(value)) return true;
  if (RGB_PATTERN.test(value)) return true;
  if (HSL_PATTERN.test(value)) return true;
  if (CSS_NAMED_COLORS.has(value.toLowerCase())) return true;

  if (/#[0-9a-fA-F]{3,8}/.test(value)) return true;
  if (/rgba?\s*\(/i.test(value)) return true;
  if (/hsla?\s*\(/i.test(value)) return true;

  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hardcoded color values in style objects. Use theme CSS variables instead.',
    },
    schema: [],
    messages: {
      noHardcodedColor:
        'Hardcoded color "{{value}}" in style property "{{prop}}". Use a CSS variable from the theme system instead, e.g. var(--bg-primary).',
    },
  },

  create(context) {
    const filename = context.filename || context.getFilename();

    if (filename.includes('/themes/') || filename.includes('/eslint-rules/')) {
      return {};
    }

    function checkPropertyValue(node, propName) {
      if (!isColorProperty(propName)) return;

      if (node.type === 'Literal' && typeof node.value === 'string') {
        if (isHardcodedColor(node.value)) {
          context.report({
            node,
            messageId: 'noHardcodedColor',
            data: { value: node.value, prop: propName },
          });
        }
      }

      if (node.type === 'TemplateLiteral') {
        for (const quasi of node.quasis) {
          if (containsHardcodedColor(quasi.value.raw)) {
            context.report({
              node,
              messageId: 'noHardcodedColor',
              data: { value: quasi.value.raw, prop: propName },
            });
          }
        }
      }
    }

    return {
      Property(node) {
        if (
          node.key &&
          (node.key.type === 'Identifier' || node.key.type === 'Literal')
        ) {
          const propName =
            node.key.type === 'Identifier' ? node.key.name : String(node.key.value);
          if (node.value) {
            checkPropertyValue(node.value, propName);
          }
        }
      },

      JSXAttribute(node) {
        if (!node.name || !node.value) return;
        const attrName = node.name.name;
        if (typeof attrName !== 'string') return;

        if (['color', 'maskColor', 'fill', 'stroke'].includes(attrName)) {
          if (node.value.type === 'Literal' && typeof node.value.value === 'string') {
            if (isHardcodedColor(node.value.value)) {
              context.report({
                node: node.value,
                messageId: 'noHardcodedColor',
                data: { value: node.value.value, prop: attrName },
              });
            }
          }
          if (
            node.value.type === 'JSXExpressionContainer' &&
            node.value.expression.type === 'Literal' &&
            typeof node.value.expression.value === 'string'
          ) {
            if (isHardcodedColor(node.value.expression.value)) {
              context.report({
                node: node.value.expression,
                messageId: 'noHardcodedColor',
                data: { value: node.value.expression.value, prop: attrName },
              });
            }
          }
        }
      },
    };
  },
};
