import { useLayoutEffect, type ReactElement } from "react";
import { useAppData } from "../appData";
import { defaultAccentColor } from "../types/account";
import { hasPremiumAccess } from "./PremiumProvider";
import { useEntitlementSnapshot } from "./entitlementStore";

export const accentPresets = [
  { name: "default", color: defaultAccentColor },
  { name: "blue", color: "#4D8DFF" },
  { name: "purple", color: "#A78BFA" },
  { name: "pink", color: "#F472B6" },
  { name: "teal", color: "#2DD4BF" },
  { name: "gold", color: "#EAB308" },
] as const;

export function useAccountAccentColor(): Readonly<{ selectedColor: string; effectiveColor: string; canCustomize: boolean }> {
  const session = useAppData().session;
  const entitlement = useEntitlementSnapshot(session?.userId ?? null);
  const selectedColor = session?.preferences.accentColor ?? defaultAccentColor;
  // Unknown access follows the cosmetic fail-open policy; a known free snapshot always gates it.
  const canCustomize = entitlement === null || hasPremiumAccess(entitlement, 20);
  return { selectedColor, effectiveColor: canCustomize ? selectedColor : defaultAccentColor, canCustomize };
}

export function AccountAccentTheme(): ReactElement | null {
  const { effectiveColor } = useAccountAccentColor();
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    const channels = [1, 3, 5].map((offset) => parseInt(effectiveColor.slice(offset, offset + 2), 16));
    style.setProperty("--accent", effectiveColor);
    style.setProperty("--accent-rgb", channels.join(", "));
    const hoverColor = effectiveColor === defaultAccentColor
      ? "#D65A38"
      : `rgb(${channels.map((channel) => Math.round(channel + (255 - channel) * 0.12)).join(", ")})`;
    style.setProperty("--accent-strong", hoverColor);
    return (): void => {
      style.removeProperty("--accent");
      style.removeProperty("--accent-rgb");
      style.removeProperty("--accent-strong");
    };
  }, [effectiveColor]);
  return null;
}
