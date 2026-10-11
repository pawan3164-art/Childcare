// White label (BRD v2.3 CUS-004): an organisation chooses a name, a colour and a logo. These helpers keep
// text readable on whatever colour it picks and keep untrusted values (logo address) from doing harm.

export const DEFAULT_THEME = { primary: '#0f766e', primaryForeground: '#ffffff', primaryMuted: '#ccfbf1' };
export const DEFAULT_BRAND_NAME = 'Next-Gen Childcare';

const NEAR_BLACK = '#1c1917';
const WHITE = '#ffffff';

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function hexToRgb(hex: string): [number, number, number] {
  if (!isHexColor(hex)) throw new Error(`Not a 6-digit hex colour: ${String(hex)}`);
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever reads better on the background. A tie goes to white. */
export function readableTextOn(background: string): '#ffffff' | '#1c1917' {
  return contrastRatio(background, NEAR_BLACK) > contrastRatio(background, WHITE) ? NEAR_BLACK : WHITE;
}

/** Mix toward white: 0 keeps the colour, 1 is white. */
export function tint(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = Number.isNaN(amount) ? 0 : Math.min(1, Math.max(0, amount));
  const mix = (c: number) =>
    Math.round(c + (255 - c) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

export function themeFor(brand: { primaryColor?: unknown } | null | undefined): typeof DEFAULT_THEME {
  const color = brand?.primaryColor;
  if (!isHexColor(color)) return { ...DEFAULT_THEME };
  const primary = color.toLowerCase();
  return { primary, primaryForeground: readableTextOn(primary), primaryMuted: tint(primary, 0.85) };
}

export function brandName(brand: { displayName?: unknown } | null | undefined, fallback: string = DEFAULT_BRAND_NAME): string {
  const name = brand?.displayName;
  return typeof name === 'string' && name.trim() ? name.trim() : fallback;
}

/** An address the app may load the logo from: our own path or an http(s) URL. Anything else (script, data, file, protocol-relative) is refused. */
export function logoSource(apiBaseUrl: string, brand: { logoUrl?: unknown } | null | undefined): string | null {
  const url = brand?.logoUrl;
  if (typeof url !== 'string') return null;
  const value = url.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/') && !value.startsWith('//')) return `${apiBaseUrl.replace(/\/+$/, '')}${value}`;
  return null;
}

/** Mix toward black: 0 keeps the colour, 1 is black. Used to make a dark-mode tint of the brand colour. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = Number.isNaN(amount) ? 0 : Math.min(1, Math.max(0, amount));
  const mix = (c: number) =>
    Math.round(c * (1 - t))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}
