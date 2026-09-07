import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { Chip, ExchangeBadge } from "@/src/components/ui";
import { usePolling } from "@/src/usePolling";
import { colors, fonts, radius, spacing } from "@/src/theme";

type Trade = {
  id: string;
  strategy_name: string;
  strategy_id: string;
  pair: string;
  exchange: string;
  side: string;
  qty: number;
  price: number;
  fee: number;
  pnl: number;
  reason: string;
  regime: string;
  executed_at: string;
};

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${money(n)}`;

export default function Journal() {
  const insets = useSafeAreaInsets();
  const { data } = usePolling<Trade[]>(() => api("/trades?limit=100"), 5000);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="journal-screen">
      <View style={styles.header}>
        <Text style={styles.brand}>AUDIT · IMMUTABLE</Text>
        <Text style={styles.title}>Trade Journal</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {(!data || data.length === 0) && (
          <Text style={styles.empty}>No executions yet. Deploy a bot to fill the journal.</Text>
        )}
        {(data || []).map((t) => {
          const isOpen = expanded === t.id;
          const dt = new Date(t.executed_at);
          return (
            <Pressable
              key={t.id}
              style={styles.row}
              onPress={() => setExpanded(isOpen ? null : t.id)}
              testID={`journal-row-${t.id}`}
            >
              <View style={styles.left}>
                <ExchangeBadge exchange={t.exchange} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.pair}>{t.side.toUpperCase()} · {t.pair}</Text>
                  <Text style={[styles.pnl, { color: t.pnl >= 0 ? colors.success : colors.error }]}>
                    {t.side === "sell" ? signed(t.pnl) : "—"}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
                  <Chip label={t.strategy_name} tone="brand" />
                  <Chip label={t.regime.toUpperCase()} />
                  <Text style={styles.time}>{dt.toLocaleString()}</Text>
                </View>
                {isOpen && (
                  <View style={styles.details}>
                    <Detail k="Qty" v={t.qty.toFixed(8)} />
                    <Detail k="Price" v={money(t.price)} />
                    <Detail k="Fee" v={money(t.fee)} />
                    <Detail k="Notional" v={money(t.qty * t.price)} />
                    <Detail k="Reason" v={t.reason} full />
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Detail({ k, v, full }: { k: string; v: string; full?: boolean }) {
  return (
    <View style={[styles.detailRow, full && { flexDirection: "column", alignItems: "flex-start", gap: 2 }]}>
      <Text style={styles.detailK}>{k}</Text>
      <Text style={styles.detailV} numberOfLines={full ? 4 : 1}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  brand: { fontFamily: fonts.displayBold, color: colors.brandPrimary, letterSpacing: 2, fontSize: 10 },
  title: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 24 },
  row: { flexDirection: "row", paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  left: { marginRight: spacing.md },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pair: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 14, letterSpacing: 0.4 },
  pnl: { fontFamily: fonts.displayBold, fontSize: 14 },
  time: { fontFamily: fonts.text, color: colors.muted, fontSize: 10 },
  details: { marginTop: spacing.sm, padding: spacing.sm, backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, gap: 4 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailK: { fontFamily: fonts.text, color: colors.muted, fontSize: 11 },
  detailV: { fontFamily: fonts.textMedium, color: colors.onSurface, fontSize: 11 },
  empty: { fontFamily: fonts.text, color: colors.muted, textAlign: "center", marginTop: spacing["2xl"] },
});
