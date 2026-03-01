export const linearToSrgbChannel = (v: number): number => {
  const val = Math.max(0, Math.min(1, v));
  return val <= 0.0031308 ? val * 12.92 : 1.055 * Math.pow(val, 1 / 2.4) - 0.055;
};

export const srgbToLinearChannel = (v: number): number => {
  const val = Math.max(0, Math.min(1, v));
  return val <= 0.04045 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
};

export const floatToByte = (v: number): number => Math.min(255, Math.max(0, Math.round(v * 255)));

export const linearToHex = (r: number, g: number, b: number): string => {
  const sr = floatToByte(linearToSrgbChannel(r));
  const sg = floatToByte(linearToSrgbChannel(g));
  const sb = floatToByte(linearToSrgbChannel(b));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(sr)}${toHex(sg)}${toHex(sb)}`;
};

export const hexToLinear = (hex: string): [number, number, number] => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [srgbToLinearChannel(r), srgbToLinearChannel(g), srgbToLinearChannel(b)];
};

/**
 * Convert a linear-space float to an sRGB byte (0-255).
 * Use this for CSS rgba() display values when working with linear color data.
 */
export const linearToSrgbByte = (v: number): number => floatToByte(linearToSrgbChannel(v));
