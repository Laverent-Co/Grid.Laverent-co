import Icon from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { Card, Chip, ExchangeBadge } from "@/src/components/ui";
import { usePolling } from "@/src/usePolling";
import { colors, fonts, radius, spacing } from "@/src/theme";

type Strategy = {
  id: string;
  name: string;
  exchange: string;
  pair: string;
  strategy_type: string;
  status: string;
  regime: string;
  equity: number;
  allocation_usdt: number;
  realized_pnl: number;
  unrealized_pnl: number;
  open_position: any;
};

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${money(n)}`;

export default function Strategies() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, refresh } = usePolling<Strategy[]>(() => api("/strategies"), 4000);

  const toggle = async (s: Strategy) => {
    if (s.status === "running") await api(`/strategies/${s.id}/pause`, { method: "POST", body: {} });
    else await api(`/strategies/${s.id}/resume`, { method: "POST", body: {} });
    refresh();
  };

  const remove = async (s: Strategy) => {
    await api(`/strategies/${s.id}`, { method: "DELETE" });
    refresh();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="strategies-screen">
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>FLEET · BOTS</Text>
          <Text style={styles.title}>Strategies</Text>
        </View>
        <Pressable
          style={styles.newBtn}
          onPress={() => router.push("/strategy-new")}
          testID="new-strategy-btn"
        >
          <Icon name="plus" size={14} color={colors.onBrandPrimary} />
          <Text style={styles.newBtnText}>New</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {(!data || data.length === 0) && (
          <Card style={{ alignItems: "center", paddingVertical: spacing["2xl"] }} testID="strategies-empty">
            <Icon name="cpu" size={28} color={colors.muted} />
            <Text style={styles.emptyLine}>Deploy a Mean Reversion, Trend Following or Grid bot to begin.</Text>
          </Card>
        )}
        {(data || []).map((s) => {
          const pnl = s.realized_pnl + s.unrealized_pnl;
          const equityPct = ((s.equity - s.allocation_usdt) / s.allocation_usdt) * 100;
          return (
            <Card key={s.id} style={{ marginBottom: spacing.md }} testID={`strategy-card-${s.id}`}>
              <View style={styles.rowBetween}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 }}>
                  <ExchangeBadge exchange={s.exchange} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                    <Text style={styles.sub}>{s.pair} · {s.strategy_type.replace("_", " ")}</Text>
                  </View>
                </View>
                <Chip
                  label={s.status.toUpperCase()}
                  tone={s.status === "running" ? "pos" : s.status === "halted" ? "neg" : "warn"}
                />
              </View>
              <View style={styles.grid}>
                <View style={styles.gridCell}>
                  <Text style={styles.gridLabel}>EQUITY</Text>
                  <Text style={styles.gridValue}>{money(s.equity)}</Text>
                  <Text style={[styles.gridDelta, { color: equityPct >= 0 ? colors.success : colors.error }]}>
                    {equityPct >= 0 ? "+" : ""}{equityPct.toFixed(2)}%
                  </Text>
                </View>
                <View style={styles.gridCell}>
                  <Text style={styles.gridLabel}>P&L</Text>
                  <Text style={[styles.gridValue, { color: pnl >= 0 ? colors.success : colors.error }]}>{signed(pnl)}</Text>
                  <Text style={styles.gridDelta}>Realized {signed(s.realized_pnl)}</Text>
                </View>
                <View style={styles.gridCell}>
                  <Text style={styles.gridLabel}>REGIME</Text>
                  <Text style={styles.gridValue}>{s.regime.toUpperCase()}</Text>
                  <Text style={styles.gridDelta}>{s.open_position ? "IN POSITION" : "FLAT"}</Text>
                </View>
              </View>
              <View style={styles.actions}>
                <Pressable style={styles.actionBtn} onPress={() => toggle(s)} testID={`toggle-${s.id}`}>
                  <Icon name={s.status === "running" ? "pause" : "play"} size={14} color={colors.onSurface} />
                  <Text style={styles.actionText}>{s.status === "running" ? "Pause" : "Resume"}</Text>
                </Pressable>
                <Pressable style={[styles.actionBtn, { borderColor: colors.error }]} onPress={() => remove(s)} testID={`delete-${s.id}`}>
                  <Icon name="trash-2" size={14} color={colors.error} />
                  <Text style={[styles.actionText, { color: colors.error }]}>Delete</Text>
                </Pressable>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  brand: { fontFamily: fonts.displayBold, color: colors.brandPrimary, letterSpacing: 2, fontSize: 10 },
  title: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 24 },
  newBtn: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.sm },
  newBtnText: { fontFamily: fonts.displayBold, color: colors.onBrandPrimary, letterSpacing: 0.6, fontSize: 13 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { fontFamily: fonts.textMedium, color: colors.onSurface, fontSize: 15 },
  sub: { fontFamily: fonts.text, color: colors.muted, fontSize: 11, marginTop: 2 },
  grid: { flexDirection: "row", marginTop: spacing.md, gap: spacing.md },
  gridCell: { flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, padding: spacing.sm },
  gridLabel: { fontFamily: fonts.text, color: colors.muted, fontSize: 9, letterSpacing: 0.8 },
  gridValue: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 14, marginTop: 2 },
  gridDelta: { fontFamily: fonts.text, color: colors.muted, fontSize: 10, marginTop: 2 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary },
  actionText: { fontFamily: fonts.textMedium, color: colors.onSurface, fontSize: 12 },
  emptyLine: { fontFamily: fonts.text, color: colors.muted, textAlign: "center", marginTop: spacing.sm, paddingHorizontal: spacing.lg, fontSize: 13 },
});
