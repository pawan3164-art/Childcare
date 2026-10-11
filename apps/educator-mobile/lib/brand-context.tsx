import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import { brandName, DEFAULT_BRAND_NAME, DEFAULT_THEME, logoSource, themeFor } from './brand';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

interface BrandContextValue {
  primary: string;
  primaryForeground: string;
  primaryMuted: string;
  /** What to call the product: the organisation's chosen name, or ours. */
  name: string;
  /** A logo address the app may load, or null. */
  logoUri: string | null;
  welcomeMessage: string | null;
  philosophy: string | null;
}

const DEFAULT_VALUE: BrandContextValue = { ...DEFAULT_THEME, name: DEFAULT_BRAND_NAME, logoUri: null, welcomeMessage: null, philosophy: null };

const BrandContext = createContext<BrandContextValue>(DEFAULT_VALUE);

/**
 * White label level 1: after sign-in the organisation's brand arrives with the profile and is applied
 * everywhere. This app has no on-device storage yet (OI-22), so the sign-in screen shows the default brand.
 */
export function BrandProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const brand = user?.brand ?? null;
  const value = useMemo<BrandContextValue>(
    () => ({
      ...themeFor(brand),
      name: brandName(brand),
      logoUri: logoSource(API_BASE_URL, brand),
      welcomeMessage: typeof brand?.welcomeMessage === 'string' ? brand.welcomeMessage : null,
      philosophy: typeof brand?.philosophy === 'string' ? brand.philosophy : null,
    }),
    [brand],
  );
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}
