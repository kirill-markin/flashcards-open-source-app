import { useLayoutEffect, useSyncExternalStore, type ReactElement } from "react";
import { useAppData } from "../appData";
import { defaultAppTheme, type AppTheme, type AppThemeSelection } from "../types/account";
import { useCanCustomizeStyle } from "./styleSettings";
import { readThemeSelection } from "./themeSelection";

const systemDarkQuery = "(prefers-color-scheme: dark)";

function subscribeToSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia(systemDarkQuery);
  media.addEventListener("change", onChange);
  return (): void => media.removeEventListener("change", onChange);
}

function readSystemTheme(): AppTheme {
  return window.matchMedia(systemDarkQuery).matches ? "dark" : "light";
}

function subscribeToNothing(): () => void {
  return (): void => {};
}

function readDefaultTheme(): AppTheme {
  return defaultAppTheme;
}

export function useAccountTheme(): Readonly<{ effectiveSelection: AppThemeSelection; effectiveTheme: AppTheme; canCustomize: boolean }> {
  const preferences = useAppData().session?.preferences ?? null;
  const canCustomize = useCanCustomizeStyle();
  const effectiveSelection = canCustomize && preferences !== null ? readThemeSelection(preferences) : defaultAppTheme;
  const isFollowingSystem = effectiveSelection === "system";
  // The browser's scheme is read and listened to only while it decides the theme.
  const systemTheme = useSyncExternalStore(
    isFollowingSystem ? subscribeToSystemTheme : subscribeToNothing,
    isFollowingSystem ? readSystemTheme : readDefaultTheme,
  );
  const effectiveTheme = effectiveSelection === "system" ? systemTheme : effectiveSelection;
  return { effectiveSelection, effectiveTheme, canCustomize };
}

export function AccountThemeAttribute(): ReactElement | null {
  const { effectiveTheme } = useAccountTheme();
  useLayoutEffect(() => {
    const dataset = document.documentElement.dataset;
    dataset.theme = effectiveTheme;
    return (): void => {
      delete dataset.theme;
    };
  }, [effectiveTheme]);
  return null;
}

function subscribeToDocumentTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return (): void => observer.disconnect();
}

/** The theme painted on the page, for code that renders outside the account providers. */
export function useDocumentTheme(): string | undefined {
  return useSyncExternalStore(subscribeToDocumentTheme, () => document.documentElement.dataset.theme);
}
