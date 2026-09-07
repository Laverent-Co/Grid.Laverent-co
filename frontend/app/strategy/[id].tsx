import Icon from "@react-native-vector-icons/feather";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { Chip, ExchangeBadge } from "@/src/components/ui";
import { usePolling } from "@/src/usePolling";
import { colors, fonts, radius, spacing } from "@/src/theme";

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${money(n)}`;

export default function StrategyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: s, refresh } = usePolling<any>(() => api(`/strategies/${id}`), 3000, [id]);

  const toggle = async () => {
    if (!s) return;
    if (s.status === "running") await api(`/strategies/${s.id}/pause`, { method: "POST", body: {} });
    else await api(`/strategies/${s.id}/resume`, { method: "POST", body: {} });
    refresh();
  };

  const remove = async () => {
    if (!s) return;
    await api(`/strategies/${s.id}`, { method: "DELETE" });
    router.back();
  };

  if (!s) return <View style={styles.root} testID="strategy-detail-loading" />;
  const pnl = s.realized_pnl + s.unrealized_pnl;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="strategy-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="strategy-detail-back">
          <Icon name="chevron-left" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>BOT · {s.strategy_type.toUpperCase().replace("_", " ")}</Text>
          <Text style={styles.title}>{s.name}</Text>
        </View>
        <ExchangeBadge exchange={s.exchange} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.pair}>{s.pair}</Text>
            <Chip label={s.status.toUpperCase()} tone={s.status === "running" ? "pos" : s.status === "halted" ? "neg" : "warn"} />
          </View>
          <Text style={[styles.pnl, { color: pnl >= 0 ? colors.success : colors.error }]}>{signed(pnl)}</Text>
          <Text style={styles.equity}>Equity {money(s.equity)} of {money(s.allocation_usdt)}</Text>
        </View>

        <View style={styles.grid}>
          <Cell k="Realized" v={signed(s.realized_pnl)} tone={s.realized_pnl >= 0 ? "pos" : "neg"} />
          <Cell k="Unrealized" v={signed(s.unrealized_pnl)} tone={s.unrealized_pnl >= 0 ? "pos" : "neg"} />
          <Cell k="Regime" v={s.regime.toUpperCase()} />
          <Cell k="Peak equity" v={money(s.peak_equity)} />
        </View>

        <Text style={styles.section}>Parameters</Text>
        <View style={styles.paramCard}>
          {Object.entries(s.params || {}).map(([k, v]) => (
            <Row key={k} k={k} v={typeof v === "number" ? String(v) : JSON.stringify(v)} />
          ))}
        </View>

        <Text style={styles.section}>Risk</Text>
        <View style={styles.paramCard}>
          <Row k="per_trade_pct" v={`${(s.risk?.per_trade_pct * 100 || 0).toFixed(2)}%`} />
          <Row k="max_dd_pct" v={`${(s.risk?.max_dd_pct * 100 || 0).toFixed(2)}%`} />
        </View>

        <Text style={styles.section}>Open position</Text>
        <View style={styles.paramCard}>
          {s.open_position ? (
            <>
              <Row k="side" v={s.open_position.side} />
              <Row k="qty" v={String(s.open_position.qty)} />
              <Row k="entry" v={money(s.open_position.entry_price)} />
            </>
          ) : (
            <Text style={styles.emptyLine}>Flat — no open position.</Text>
          )}
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.actionBtn} onPress={toggle} testID="detail-toggle">
            <Icon name={s.status === "running" ? "pause" : "play"} size={14} color={colors.onSurface} />
            <Text style={styles.actionText}>{s.status === "running" ? "Pause" : "Resume"}</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, { borderColor: colors.error }]} onPress={remove} testID="detail-delete">
            <Icon name="trash-2" size={14} color={colors.error} />
            <Text style={[styles.actionText, { color: colors.error }]}>Delete</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? colors.success : tone === "neg" ? colors.error : colors.onSurface;
  return (
    <View style={styles.cell}>
      <Text style={styles.cellK}>{k.toUpperCase()}</Text>
      <Text style={[styles.cellV, { color }]}>{v}</Text>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowK}>{k}</Text>
      <Text style={styles.rowV}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  back: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  brand: { fontFamily: fonts.displayBold, color: colors.brandPrimary, letterSpacing: 2, fontSize: 10 },
  title: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 20 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  pair: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 16, letterSpacing: 0.6 },
  pnl: { fontFamily: fonts.displayBold, fontSize: 32, marginTop: spacing.sm },
  equity: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  cell: { flex: 1, minWidth: "45%", backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cellK: { fontFamily: fonts.text, color: colors.muted, fontSize: 10, letterSpacing: 0.6 },
  cellV: { fontFamily: fonts.displayBold, fontSize: 15, marginTop: 4 },
  section: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 13, letterSpacing: 0.6, textTransform: "uppercase", marginTop: spacing.xl, marginBottom: spacing.sm },
  paramCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  rowK: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  rowV: { fontFamily: fonts.textMedium, color: colors.onSurface, fontSize: 12 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xl },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  actionText: { fontFamily: fonts.textMedium, color: colors.onSurface, fontSize: 13 },
  emptyLine: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
});
