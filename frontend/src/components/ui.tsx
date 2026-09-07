import { StyleSheet, Text, View } from "react-native";

import { colors, fonts, radius, spacing } from "@/src/theme";

export function Card({ children, style, testID }: any) {
  return <View testID={testID} style={[styles.card, style]}>{children}</View>;
}

export function Metric({ label, value, tone, testID }: { label: string; value: string; tone?: "pos" | "neg" | "neutral"; testID?: string }) {
  const color = tone === "pos" ? colors.success : tone === "neg" ? colors.error : colors.onSurface;
  return (
    <View style={styles.metric} testID={testID}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

export function Chip({ label, tone = "neutral" }: { label: string; tone?: "pos" | "neg" | "brand" | "neutral" | "warn" }) {
  const map = {
    pos: { bg: "rgba(50, 215, 75, 0.14)", fg: colors.success },
    neg: { bg: "rgba(255, 69, 58, 0.14)", fg: colors.error },
    brand: { bg: colors.brandTertiary, fg: colors.onBrandTertiary },
    warn: { bg: "rgba(255, 214, 10, 0.15)", fg: colors.warning },
    neutral: { bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary },
  } as const;
  const c = map[tone];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={[styles.chipText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function ExchangeBadge({ exchange }: { exchange: string }) {
  const map: Record<string, { initials: string; bg: string; fg: string }> = {
    binance: { initials: "BN", bg: colors.brandPrimary, fg: colors.onBrandPrimary },
    coinbase: { initials: "CB", bg: "#0052FF", fg: "#FFFFFF" },
    kraken: { initials: "KR", bg: "#5741D9", fg: "#FFFFFF" },
  };
  const c = map[exchange] || { initials: exchange.slice(0, 2).toUpperCase(), bg: colors.surfaceTertiary, fg: colors.onSurface };
  return (
    <View style={[styles.exBadge, { backgroundColor: c.bg }]}>
      <Text style={[styles.exBadgeText, { color: c.fg }]}>{c.initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  metric: { gap: 2 },
  metricLabel: { fontFamily: fonts.text, color: colors.muted, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },
  metricValue: { fontFamily: fonts.displayBold, fontSize: 22, letterSpacing: 0.4 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  chipText: { fontFamily: fonts.textMedium, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" },
  exBadge: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  exBadgeText: { fontFamily: fonts.displayBold, fontSize: 12, letterSpacing: 0.5 },
});
