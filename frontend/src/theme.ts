// Design tokens for CryptoBot Terminal — dark-first institutional trading terminal.
// Values come from /app/design_guidelines.json. Dark scheme only; the app forces
// dark to keep the terminal aesthetic on every device.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  surface: "#0B0E11",
  onSurface: "#F0F2F5",
  surfaceSecondary: "#141620",
  onSurfaceSecondary: "#E1E4E8",
  surfaceTertiary: "#1E202B",
  onSurfaceTertiary: "#A0A5AD",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#0B0E11",

  brand: "#FF9F0A",
  onBrand: "#000000",
  brandPrimary: "#FF9F0A",
  onBrandPrimary: "#000000",
  brandSecondary: "#E58600",
  onBrandSecondary: "#000000",
  brandTertiary: "#332002",
  onBrandTertiary: "#FF9F0A",

  success: "#32D74B",
  onSuccess: "#000000",
  warning: "#FFD60A",
  onWarning: "#000000",
  error: "#FF453A",
  onError: "#FFFFFF",
  info: "#E1E4E8",
  onInfo: "#000000",

  border: "#2B3139",
  borderStrong: "#FF9F0A",
  divider: "#1F242C",
  muted: "#787E87",
};

export type ThemeColors = typeof dark;
export const colors: ThemeColors = dark;
export const defaultScheme = "dark" satisfies ColorScheme;
export const themes: { light?: ThemeColors; dark: ThemeColors } = { dark };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
export const fonts = {
  display: "Rajdhani_500Medium",
  displayBold: "Rajdhani_600SemiBold",
  text: "IBMPlexSans_400Regular",
  textMedium: "IBMPlexSans_500Medium",
};

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}
// Force dark to keep the terminal aesthetic uniform.
setColorScheme?.("dark");

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  useColorScheme();
  return { scheme: "dark", colors: dark };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors: c } = useTheme();
    return useMemo(() => StyleSheet.create(factory(c)), [c]);
  };
}
