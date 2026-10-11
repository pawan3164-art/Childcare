'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import { brandName, DEFAULT_BRAND_NAME, DEFAULT_THEME, isHexColor, logoSource, readableTextOn, shade, themeFor, tint } from './brand';
import type { BrandView } from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
const STYLE_ID = 'org-brand-theme';

interface BrandContextValue {
  primary: string;
  primaryForeground: string;
  primaryMuted: string;
  name: string;
  logoUri: string | null;
  welcomeMessage: string | null;
  philosophy: string | null;
  isCustom: boolean;
}

const DEFAULT_VALUE: BrandContextValue = { ...DEFAULT_THEME, name: DEFAULT_BRAND_NAME, logoUri: null, welcomeMessage: null, philosophy: null, isCustom: false };
const BrandContext = createContext<BrandContextValue>(DEFAULT_VALUE);

/**
 * White label levels 1 and 2. Before sign-in the brand comes from the address the portal is opened on, so
 * a custom domain looks like the organisation's own. After sign-in it comes from the profile. The colours are
 * applied as CSS variables (with a lighter variant for dark mode) so every existing component picks them up.
 */
export function BrandProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [publicBrand, setPublicBrand] = useState<BrandView | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/branding/public?host=${encodeURIComponent(window.location.host)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setPublicBrand(b))
      .catch(() => {
        /* the default brand is fine */
      });
  }, []);

  const brand = user?.brand ?? publicBrand;
  const value = useMemo<BrandContextValue>(
    () => ({
      ...themeFor(brand),
      name: brandName(brand),
      logoUri: logoSource(API_BASE_URL, brand),
      welcomeMessage: typeof brand?.welcomeMessage === 'string' ? brand.welcomeMessage : null,
      philosophy: typeof brand?.philosophy === 'string' ? brand.philosophy : null,
      isCustom: brand?.isCustom === true && isHexColor(brand.primaryColor),
    }),
    [brand],
  );

  useEffect(() => {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!value.isCustom) {
      el?.remove();
    } else {
      if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ID;
        document.head.appendChild(el);
      }
      const darkPrimary = tint(value.primary, 0.45);
      el.textContent =
        `:root{--color-primary:${value.primary};--color-primary-foreground:${value.primaryForeground};--color-primary-muted:${value.primaryMuted}}` +
        `@media (prefers-color-scheme:dark){:root{--color-primary:${darkPrimary};--color-primary-foreground:${readableTextOn(darkPrimary)};--color-primary-muted:${shade(value.primary, 0.6)}}}`;
    }
    document.title = `${value.name} — Centre Portal`;
  }, [value]);

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}
