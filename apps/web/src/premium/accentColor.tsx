import { useLayoutEffect, type ReactElement } from "react";
import { useAppData } from "../appData";
import { defaultAccentColor, type AppTheme } from "../types/account";
import { darkenAccentForLightTheme, parseHexColorChannels, scaleColorChannels } from "./lightThemeAccent";
import { useCanCustomizeStyle } from "./styleSettings";
import { useAccountTheme } from "./theme";

export const accentPresets = [
  { name: "default", color: defaultAccentColor },
  { name: "blue", color: "#4D8DFF" },
  { name: "purple", color: "#A78BFA" },
  { name: "pink", color: "#F472B6" },
  { name: "teal", color: "#2DD4BF" },
  { name: "gold", color: "#EAB308" },
] as const;

/** The shade of an accent color shown in a theme; the saved color itself never changes. */
export function displayedAccentColor(color: string, theme: AppTheme): string {
  return theme === "light" ? darkenAccentForLightTheme(color) : color;
}

/**
 * `effectiveColor` is the color the account uses, the one to save and name; `displayedColor` is the
 * shade to paint with in the current theme.
 */
export function useAccountAccentColor(): Readonly<{
  selectedColor: string;
  effectiveColor: string;
  displayedColor: string;
  canCustomize: boolean;
}> {
  const session = useAppData().session;
  const selectedColor = session?.preferences.accentColor ?? defaultAccentColor;
  const canCustomize = useCanCustomizeStyle();
  const { effectiveTheme } = useAccountTheme();
  const effectiveColor = canCustomize ? selectedColor : defaultAccentColor;
  return { selectedColor, effectiveColor, displayedColor: displayedAccentColor(effectiveColor, effectiveTheme), canCustomize };
}

export function AccountAccentTheme(): ReactElement | null {
  const { effectiveColor, displayedColor } = useAccountAccentColor();
  const { effectiveTheme } = useAccountTheme();
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    const channels = parseHexColorChannels(displayedColor);
    style.setProperty("--accent", displayedColor);
    style.setProperty("--accent-rgb", channels.join(", "));
    // Hover moves away from the page: lighter on Dark, darker on Light.
    const hoverColor = effectiveTheme === "light"
      ? `rgb(${scaleColorChannels(channels, 0.88).join(", ")})`
      : effectiveColor === defaultAccentColor
        ? "#FF7A3D"
        : `rgb(${channels.map((channel) => Math.round(channel + (255 - channel) * 0.12)).join(", ")})`;
    style.setProperty("--accent-strong", hoverColor);
    return (): void => {
      style.removeProperty("--accent");
      style.removeProperty("--accent-rgb");
      style.removeProperty("--accent-strong");
    };
  }, [displayedColor, effectiveColor, effectiveTheme]);
  return null;
}
