import { useLayoutEffect, useSyncExternalStore, type ReactElement } from "react";
import { useAppData } from "../appData";
import { defaultAppTheme, type AppTheme } from "../types/account";
import { useCanCustomizeStyle } from "./styleSettings";

export const appThemes: ReadonlyArray<AppTheme> = ["dark", "light"];

export function useAccountTheme(): Readonly<{ selectedTheme: AppTheme; effectiveTheme: AppTheme; canCustomize: boolean }> {
  const session = useAppData().session;
  const selectedTheme = session?.preferences.theme ?? defaultAppTheme;
  const canCustomize = useCanCustomizeStyle();
  return { selectedTheme, effectiveTheme: canCustomize ? selectedTheme : defaultAppTheme, canCustomize };
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
