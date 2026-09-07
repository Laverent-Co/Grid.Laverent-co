import Icon from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, setToken } from "@/src/api";
import { registerForPushOnce } from "@/src/lib/push";
import { useSubscription } from "@/src/lib/revenuecat";
import { Card, Chip, ExchangeBadge, Metric } from "@/src/components/ui";
import { Sparkline } from "@/src/components/sparkline";
import { usePolling } from "@/src/usePolling";
import { colors, fonts, radius, spacing } from "@/src/theme";

type Portfolio = {
  total_equity: number;
  total_allocated: number;
  realized_pnl: number;
  unrealized_pnl: number;
  active_bots: number;
  halted_bots: number;
  kill_switch: boolean;
  equity_curve: { t: string; pnl: number }[];
};

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
};

type Trade = {
  id: string;
  strategy_name: string;
  pair: string;
  side: string;
  qty: number;
  price: number;
  pnl: number;
  executed_at: string;
};

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${money(n)}`;

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isPro, hasWalkingGrid } = useSubscription();
  const { data: portfolio } = usePolling<Portfolio>(() => api("/portfolio"), 4000);
  const { data: strategies } = usePolling<Strategy[]>(() => api("/strategies"), 4000);
  const { data: trades } = usePolling<Trade[]>(() => api("/trades?limit=8"), 6000);

  useEffect(() => {
    registerForPushOnce();
  }, []);

  const totalPnl = (portfolio?.realized_pnl || 0) + (portfolio?.unrealized_pnl || 0);
  const totalTone: any = totalPnl >= 0 ? "pos" : "neg";
  const curve = (portfolio?.equity_curve || []).map((c) => c.pnl);

  const toggleKill = async () => {
    await api("/portfolio/kill-switch", { method: "POST", body: {} });
  };

  const lock = async () => {
    try { await api("/auth/lock", { method: "POST", body: {} }); } catch {}
    await setToken(null);
    router.replace("/unlock");
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="dashboard-screen">
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>CRYPTOBOT · TERMINAL</Text>
          <Text style={styles.title}>Dashboard</Text>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable style={styles.iconBtn} testID="open-paywall-btn" onPress={() => router.push("/paywall")}>
            <Icon name={isPro ? "star" : "zap"} size={18} color={isPro ? colors.brandPrimary : colors.onSurface} />
          </Pressable>
          <Pressable style={styles.iconBtn} testID="open-vault-btn" onPress={() => router.push("/vault")}>
            <Icon name="shield" size={18} color={colors.onSurface} />
          </Pressable>
          <Pressable style={styles.iconBtn} testID="lock-btn" onPress={lock}>
            <Icon name="lock" size={18} color={colors.onSurface} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Card style={{ marginBottom: spacing.md }} testID="portfolio-card">
          <View style={styles.rowBetween}>
            <Text style={styles.cardLabel}>PORTFOLIO EQUITY</Text>
            <Chip label={portfolio?.kill_switch ? "KILL-SWITCH ON" : "LIVE"} tone={portfolio?.kill_switch ? "neg" : "pos"} />
          </View>
          <Text style={[styles.big, { marginTop: 4 }]}>{money(portfolio?.total_equity || 0)}</Text>
          <Text style={[styles.subValue, { color: totalTone === "pos" ? colors.success : colors.error }]}>
            {signed(totalPnl)} total P&L
          </Text>
          <View style={{ marginTop: spacing.md }}>
            <Sparkline data={curve.length > 1 ? curve : [0, 0.1, -0.05, 0.2, 0.3]} height={72} />
          </View>
          <View style={styles.metricRow}>
            <Metric label="Realized" value={signed(portfolio?.realized_pnl || 0)} tone={(portfolio?.realized_pnl || 0) >= 0 ? "pos" : "neg"} />
            <Metric label="Unrealized" value={signed(portfolio?.unrealized_pnl || 0)} tone={(portfolio?.unrealized_pnl || 0) >= 0 ? "pos" : "neg"} />
            <Metric label="Allocated" value={money(portfolio?.total_allocated || 0)} />
          </View>
        </Card>

        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Fleet</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
            <Chip label={isPro ? "PRO" : "FREE"} tone={isPro ? "brand" : "neutral"} />
            {hasWalkingGrid && <Chip label="WG" tone="warn" />}
            <Chip label={`${portfolio?.active_bots || 0} RUNNING`} tone="pos" />
            {(portfolio?.halted_bots || 0) > 0 && <Chip label={`${portfolio?.halted_bots} HALTED`} tone="neg" />}
            <Pressable style={styles.killBtn} onPress={toggleKill} testID="kill-switch-btn">
              <Icon name="power" size={14} color={portfolio?.kill_switch ? colors.brand : colors.error} />
              <Text style={[styles.killText, { color: portfolio?.kill_switch ? colors.brand : colors.error }]}>
                {portfolio?.kill_switch ? "RESUME" : "KILL ALL"}
              </Text>
            </Pressable>
          </View>
        </View>

        {(strategies || []).length === 0 && (
          <Card style={{ marginTop: spacing.md, alignItems: "center", paddingVertical: spacing.xl }} testID="empty-fleet">
            <Icon name="cpu" size={28} color={colors.muted} />
            <Text style={{ color: colors.muted, marginTop: spacing.sm, fontFamily: fonts.text }}>No bots deployed yet.</Text>
            <Pressable style={styles.cta} testID="deploy-first-bot" onPress={() => router.push("/strategy-new")}>
              <Text style={styles.ctaText}>Deploy first strategy</Text>
            </Pressable>
          </Card>
        )}

        {(strategies || []).map((s) => (
          <Pressable
            key={s.id}
            style={[styles.botRow]}
            onPress={() => router.push({ pathname: "/strategy/[id]", params: { id: s.id } })}
            testID={`bot-row-${s.id}`}
          >
            <ExchangeBadge exchange={s.exchange} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <View style={styles.rowBetween}>
                <Text style={styles.botName} numberOfLines={1}>{s.name}</Text>
                <Text style={[styles.botPnl, { color: (s.realized_pnl + s.unrealized_pnl) >= 0 ? colors.success : colors.error }]}>
                  {signed(s.realized_pnl + s.unrealized_pnl)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 6, marginTop: 4, alignItems: "center" }}>
                <Chip label={s.pair} />
                <Chip label={s.strategy_type.replace("_", " ")} tone="brand" />
                <Chip
                  label={s.status.toUpperCase()}
                  tone={s.status === "running" ? "pos" : s.status === "halted" ? "neg" : "warn"}
                />
                <Chip label={s.regime.toUpperCase()} />
              </View>
            </View>
          </Pressable>
        ))}

        <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>Recent executions</Text>
        {(trades || []).length === 0 && (
          <Text style={styles.emptyLine}>Awaiting bot execution…</Text>
        )}
        {(trades || []).map((t) => (
          <View key={t.id} style={styles.tradeRow}>
            <View style={[styles.sideDot, { backgroundColor: t.side === "buy" ? colors.success : colors.error }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.tradeTitle}>
                {t.side.toUpperCase()} {t.pair}
              </Text>
              <Text style={styles.tradeSub}>{t.strategy_name} · {t.qty.toFixed(6)} @ {money(t.price)}</Text>
            </View>
            <Text style={[styles.tradePnl, { color: t.pnl >= 0 ? colors.success : colors.error }]}>
              {t.side === "sell" ? signed(t.pnl) : "—"}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  brand: { fontFamily: fonts.displayBold, color: colors.brandPrimary, letterSpacing: 2, fontSize: 10 },
  title: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 24 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  cardLabel: { fontFamily: fonts.textMedium, color: colors.muted, fontSize: 10, letterSpacing: 1.2 },
  big: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 34, letterSpacing: 0.4 },
  subValue: { fontFamily: fonts.textMedium, fontSize: 13, marginTop: 2 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metricRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.md, gap: spacing.md },
  sectionTitle: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 15, marginTop: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.4, textTransform: "uppercase" },
  killBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  killText: { fontFamily: fonts.displayBold, fontSize: 11, letterSpacing: 0.6 },
  botRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  botName: { fontFamily: fonts.textMedium, color: colors.onSurface, fontSize: 14 },
  botPnl: { fontFamily: fonts.displayBold, fontSize: 14 },
  cta: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md },
  ctaText: { color: colors.onBrandPrimary, fontFamily: fonts.displayBold, letterSpacing: 0.6 },
  tradeRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  sideDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.md },
  tradeTitle: { fontFamily: fonts.textMedium, color: colors.onSurface, fontSize: 13 },
  tradeSub: { fontFamily: fonts.text, color: colors.muted, fontSize: 11, marginTop: 2 },
  tradePnl: { fontFamily: fonts.displayBold, fontSize: 13 },
  emptyLine: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, paddingVertical: spacing.md },
});
