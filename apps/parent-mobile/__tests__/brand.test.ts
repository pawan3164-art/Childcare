import {
  DEFAULT_THEME,
  DEFAULT_BRAND_NAME,
  isHexColor,
  hexToRgb,
  contrastRatio,
  readableTextOn,
  tint,
  themeFor,
  brandName,
  logoSource,
} from '@/lib/brand';

const WHITE = '#ffffff';
const DARK = '#1c1917';

describe('defaults', () => {
  it('DEFAULT_THEME matches the contract', () => {
    expect(DEFAULT_THEME).toEqual({ primary: '#0f766e', primaryForeground: '#ffffff', primaryMuted: '#ccfbf1' });
  });
  it('DEFAULT_BRAND_NAME matches the contract', () => expect(DEFAULT_BRAND_NAME).toBe('Next-Gen Childcare'));
});

describe('isHexColor', () => {
  it.each(['#000000', '#ffffff', '#0f766e', '#ABCDEF', '#aBc123'])('accepts %s', (v) => {
    expect(isHexColor(v)).toBe(true);
  });
  it.each([
    ['3-digit', '#fff'],
    ['missing hash', '0f766e'],
    ['8-digit', '#0f766eff'],
    ['leading space', ' #0f766e'],
    ['trailing space', '#0f766e '],
    ['trailing newline', '#0f766e\n'],
    ['non-hex chars', '#0g766e'],
    ['empty', ''],
    ['hash only', '#'],
    ['5 digits', '#0f766'],
    ['7 digits', '#0f766e1'],
    ['named colour', 'red'],
    ['rgb()', 'rgb(0,0,0)'],
  ])('rejects %s', (_n, v) => {
    expect(isHexColor(v)).toBe(false);
  });
  it.each([[null], [undefined], [123], [0x0f766e], [{}], [[]], [true]])('rejects non-string %p', (v) => {
    expect(isHexColor(v)).toBe(false);
  });
});

describe('hexToRgb', () => {
  it('parses black and white', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
  });
  it('parses channels in order', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0]);
    expect(hexToRgb('#00ff00')).toEqual([0, 255, 0]);
    expect(hexToRgb('#0000ff')).toEqual([0, 0, 255]);
    expect(hexToRgb('#0f766e')).toEqual([15, 118, 110]);
  });
  it('is case-insensitive', () => {
    expect(hexToRgb('#ABCDEF')).toEqual(hexToRgb('#abcdef'));
    expect(hexToRgb('#ABCDEF')).toEqual([171, 205, 239]);
  });
  it.each(['#fff', 'fff', '0f766e', '#0f766eff', '', ' #0f766e', '#zzzzzz'])('throws for %p', (v) => {
    expect(() => hexToRgb(v)).toThrow();
  });
  it('throws for non-string input', () => {
    expect(() => hexToRgb(null as unknown as string)).toThrow();
    expect(() => hexToRgb(undefined as unknown as string)).toThrow();
    expect(() => hexToRgb(123 as unknown as string)).toThrow();
  });
});

describe('contrastRatio', () => {
  it('white vs black is 21', () => expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5));
  it('is symmetric', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#0f766e', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#0f766e'), 10);
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(contrastRatio('#abcdef', '#123456'), 10);
  });
  it('a colour against itself is 1', () => {
    expect(contrastRatio('#0f766e', '#0f766e')).toBeCloseTo(1, 10);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 10);
  });
  it('matches known values', () => {
    expect(contrastRatio('#0f766e', '#ffffff')).toBeCloseTo(5.47, 1);
    expect(contrastRatio('#ffff00', '#ffffff')).toBeCloseTo(1.07, 1);
  });
  it('is case-insensitive', () => {
    expect(contrastRatio('#0F766E', '#FFFFFF')).toBeCloseTo(contrastRatio('#0f766e', '#ffffff'), 10);
  });
  it('is always >= 1', () => {
    expect(contrastRatio('#336699', '#339966')).toBeGreaterThanOrEqual(1);
  });
  it('mid-grey against white and black matches the WCAG formula', () => {
    // #808080 -> linear ~0.2159 -> L; ratio vs white = 1.05 / (L + 0.05)
    const c = 128 / 255;
    const lin = Math.pow((c + 0.055) / 1.055, 2.4);
    expect(contrastRatio('#808080', '#ffffff')).toBeCloseTo(1.05 / (lin + 0.05), 6);
    expect(contrastRatio('#808080', '#000000')).toBeCloseTo((lin + 0.05) / 0.05, 6);
  });
  it('uses the low-value linear branch (c <= 0.03928 divides by 12.92)', () => {
    // #0a0a0a: 10/255 = 0.0392157 <= 0.03928 -> linear = c/12.92
    const lin = 10 / 255 / 12.92;
    expect(contrastRatio('#0a0a0a', '#000000')).toBeCloseTo((lin + 0.05) / 0.05, 6);
  });
  it('throws for invalid colours', () => {
    expect(() => contrastRatio('#fff', '#000000')).toThrow();
    expect(() => contrastRatio('#000000', 'nope')).toThrow();
  });
});

describe('readableTextOn', () => {
  it('picks white on the default teal', () => expect(readableTextOn('#0f766e')).toBe(WHITE));
  it('picks dark on yellow', () => expect(readableTextOn('#ffff00')).toBe(DARK));
  it('picks white on black', () => expect(readableTextOn('#000000')).toBe(WHITE));
  it('picks dark on white', () => expect(readableTextOn('#ffffff')).toBe(DARK));
  it('picks white on a navy', () => expect(readableTextOn('#1b3a5c')).toBe(WHITE));
  it('picks dark on pale tints', () => {
    expect(readableTextOn('#ccfbf1')).toBe(DARK);
    expect(readableTextOn('#f0f0f0')).toBe(DARK);
  });
  it('mid grey picks whichever has the higher contrast', () => {
    const w = contrastRatio('#808080', WHITE);
    const d = contrastRatio('#808080', DARK);
    expect(readableTextOn('#808080')).toBe(w >= d ? WHITE : DARK);
  });
  it('always returns the higher-contrast option across a colour sweep', () => {
    for (let v = 0; v <= 255; v += 5) {
      const h = v.toString(16).padStart(2, '0');
      for (const bg of [`#${h}${h}${h}`, `#${h}0000`, `#00${h}00`, `#0000${h}`, `#${h}${h}00`]) {
        const w = contrastRatio(bg, WHITE);
        const d = contrastRatio(bg, DARK);
        const expected = w >= d ? WHITE : DARK;
        expect(readableTextOn(bg)).toBe(expected);
        // the chosen colour is never worse than the other
        expect(contrastRatio(bg, readableTextOn(bg))).toBeGreaterThanOrEqual(Math.min(w, d));
      }
    }
  });
  it('is case-insensitive', () => {
    expect(readableTextOn('#FFFF00')).toBe(DARK);
    expect(readableTextOn('#0F766E')).toBe(WHITE);
  });
  it.each(['#fff', 'red', '', '#12345'])('throws for invalid input %p', (v) => {
    expect(() => readableTextOn(v)).toThrow();
  });
  it('throws for non-string input', () => {
    expect(() => readableTextOn(null as unknown as string)).toThrow();
    expect(() => readableTextOn(undefined as unknown as string)).toThrow();
  });
});

describe('tint', () => {
  it('amount 0 returns the same colour lower-cased', () => {
    expect(tint('#0f766e', 0)).toBe('#0f766e');
    expect(tint('#ABCDEF', 0)).toBe('#abcdef');
  });
  it('amount 1 returns white', () => {
    expect(tint('#0f766e', 1)).toBe('#ffffff');
    expect(tint('#000000', 1)).toBe('#ffffff');
  });
  it('0.5 on black is #808080 (round half up)', () => expect(tint('#000000', 0.5)).toBe('#808080'));
  it('mixes each channel toward white', () => {
    // 15 + (255-15)*0.5 = 135 (0x87); 118 + 137*0.5 = 186.5 -> 187 (0xbb); 110 + 145*.5 = 182.5 -> 183 (0xb7)
    expect(tint('#0f766e', 0.5)).toBe('#87bbb7');
  });
  it('white stays white at any amount', () => {
    expect(tint('#ffffff', 0)).toBe('#ffffff');
    expect(tint('#ffffff', 0.37)).toBe('#ffffff');
  });
  it('clamps amounts below 0 to 0', () => {
    expect(tint('#0f766e', -1)).toBe('#0f766e');
    expect(tint('#0f766e', -Infinity)).toBe('#0f766e');
  });
  it('clamps amounts above 1 to 1', () => {
    expect(tint('#0f766e', 2)).toBe('#ffffff');
    expect(tint('#0f766e', Infinity)).toBe('#ffffff');
  });
  it('treats NaN as 0', () => expect(tint('#0f766e', NaN)).toBe('#0f766e'));
  it('pads single-digit channels with a zero', () => {
    expect(tint('#000000', 0.02)).toBe('#050505'); // 255*0.02 = 5.1 -> 5
    expect(tint('#000000', 0)).toBe('#000000');
  });
  it('always outputs lowercase #rrggbb', () => {
    for (const a of [0, 0.1, 0.25, 0.5, 0.85, 0.99, 1]) {
      expect(tint('#1B3A5C', a)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it('0.85 on the default teal is a very light tint', () => {
    const out = tint('#0f766e', 0.85);
    expect(readableTextOn(out)).toBe(DARK);
    expect(contrastRatio(out, WHITE)).toBeLessThan(1.5);
  });
  it('is monotonic towards white', () => {
    const lum = (h: string) => contrastRatio(h, '#000000');
    expect(lum(tint('#0f766e', 0.2))).toBeLessThan(lum(tint('#0f766e', 0.6)));
  });
  it.each(['#fff', 'blue', '', '0f766e'])('throws for invalid hex %p', (v) => {
    expect(() => tint(v, 0.5)).toThrow();
  });
});

describe('themeFor', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['undefined colour', { primaryColor: undefined }],
    ['null colour', { primaryColor: null }],
    ['3-digit colour', { primaryColor: '#fff' }],
    ['no hash', { primaryColor: '0f766e' }],
    ['non-string colour', { primaryColor: 123 }],
    ['named colour', { primaryColor: 'red' }],
    ['padded colour', { primaryColor: ' #0f766e ' }],
    ['empty string', { primaryColor: '' }],
  ])('returns the default theme for %s', (_n, brand) => {
    expect(themeFor(brand as any)).toEqual(DEFAULT_THEME);
  });
  it('returns a copy of the default, not the same object', () => {
    const t = themeFor(null);
    expect(t).not.toBe(DEFAULT_THEME);
    t.primary = '#000000';
    expect(DEFAULT_THEME.primary).toBe('#0f766e');
    expect(themeFor(undefined)).toEqual(DEFAULT_THEME);
    expect(themeFor(null)).not.toBe(themeFor(null));
  });
  it('derives a theme from a valid colour', () => {
    const t = themeFor({ primaryColor: '#1B3A5C' });
    expect(t.primary).toBe('#1b3a5c');
    expect(t.primaryForeground).toBe(WHITE);
    expect(t.primaryMuted).toBe(tint('#1b3a5c', 0.85));
    expect(contrastRatio(t.primaryMuted, t.primary)).toBeGreaterThan(3);
  });
  it('uses a dark foreground on a very light colour', () => {
    const t = themeFor({ primaryColor: '#ffff00' });
    expect(t.primary).toBe('#ffff00');
    expect(t.primaryForeground).toBe(DARK);
    expect(t.primaryMuted).toBe(tint('#ffff00', 0.85));
  });
  it('foreground always has the better contrast with the primary', () => {
    for (const c of ['#000000', '#ffffff', '#808080', '#ff6600', '#0f766e', '#ffe4e1', '#7f00ff']) {
      const t = themeFor({ primaryColor: c });
      const other = t.primaryForeground === WHITE ? DARK : WHITE;
      expect(contrastRatio(t.primary, t.primaryForeground)).toBeGreaterThanOrEqual(contrastRatio(t.primary, other));
    }
  });
  it('lower-cases an upper-case colour', () => {
    expect(themeFor({ primaryColor: '#ABCDEF' }).primary).toBe('#abcdef');
  });
  it('ignores extra brand fields', () => {
    expect(themeFor({ primaryColor: '#1b3a5c', displayName: 'x' } as any).primary).toBe('#1b3a5c');
  });
});

describe('brandName', () => {
  it('returns the trimmed display name', () => {
    expect(brandName({ displayName: 'Little Stars' })).toBe('Little Stars');
    expect(brandName({ displayName: '  Little Stars \n' })).toBe('Little Stars');
  });
  it('keeps inner whitespace', () => expect(brandName({ displayName: 'Little  Stars' })).toBe('Little  Stars'));
  it.each([
    ['null brand', null],
    ['undefined brand', undefined],
    ['empty object', {}],
    ['empty name', { displayName: '' }],
    ['whitespace name', { displayName: '   \t\n' }],
    ['null name', { displayName: null }],
    ['number name', { displayName: 42 }],
    ['object name', { displayName: {} }],
    ['array name', { displayName: ['x'] }],
    ['boolean name', { displayName: true }],
  ])('falls back to the default for %s', (_n, brand) => {
    expect(brandName(brand as any)).toBe(DEFAULT_BRAND_NAME);
  });
  it('uses a custom fallback', () => {
    expect(brandName(null, 'My Centre')).toBe('My Centre');
    expect(brandName({ displayName: ' ' }, 'My Centre')).toBe('My Centre');
    expect(brandName({ displayName: 'Real' }, 'My Centre')).toBe('Real');
  });
});

describe('logoSource', () => {
  const base = 'https://api.example.com';
  it.each([
    ['null brand', null],
    ['undefined brand', undefined],
    ['empty object', {}],
    ['null logo', { logoUrl: null }],
    ['undefined logo', { logoUrl: undefined }],
    ['empty logo', { logoUrl: '' }],
    ['whitespace logo', { logoUrl: '   ' }],
    ['number logo', { logoUrl: 5 }],
    ['object logo', { logoUrl: {} }],
  ])('returns null for %s', (_n, brand) => {
    expect(logoSource(base, brand as any)).toBeNull();
  });
  it('returns absolute http and https URLs unchanged', () => {
    expect(logoSource(base, { logoUrl: 'https://cdn.example.com/a.png' })).toBe('https://cdn.example.com/a.png');
    expect(logoSource(base, { logoUrl: 'http://cdn.example.com/a.png?x=1' })).toBe('http://cdn.example.com/a.png?x=1');
  });
  it('joins a root-relative path to the base URL', () => {
    expect(logoSource('https://api.example.com', { logoUrl: '/media/logo.png' })).toBe(
      'https://api.example.com/media/logo.png',
    );
  });
  it('does not double the slash when the base ends with one', () => {
    expect(logoSource('https://api.example.com/', { logoUrl: '/media/logo.png' })).toBe(
      'https://api.example.com/media/logo.png',
    );
  });
  it('keeps a base path prefix', () => {
    expect(logoSource('https://api.example.com/v1', { logoUrl: '/media/logo.png' })).toBe(
      'https://api.example.com/v1/media/logo.png',
    );
  });
  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:image/png;base64,AAAA',
    'file:///etc/passwd',
    'ftp://example.com/a.png',
    '//evil.com/x',
    'logo.png',
    'media/logo.png',
    'blob:https://example.com/abc',
  ])('rejects unsafe or non-absolute value %p', (v) => {
    expect(logoSource(base, { logoUrl: v })).toBeNull();
  });
});
