import Icon from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ExchangeBadge } from "@/src/components/ui";
import { colors, fonts, radius, spacing } from "@/src/theme";

const EXCHANGES = ["binance", "coinbase", "kraken"] as const;
const PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;

type StratType = "mean_reversion" | "trend_following" | "grid";
const STRATS: { key: StratType; title: string; desc: string }[] = [
  { key: "mean_reversion", title: "Mean Reversion", desc: "Bollinger z-score fade. Buys 2σ below the 20-period mean, exits toward mean." },
  { key: "trend_following", title: "Trend Following", desc: "SMA cross (9/30) filtered by VWAP. Rides trending regimes." },
  { key: "grid", title: "Grid", desc: "Buys the dip / sells the top across a fixed price band. Best in ranging regimes." },
];

export default function StrategyNew() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [name, setName] = useState("Alpha Bot");
  const [exchange, setExchange] = useState<(typeof EXCHANGES)[number]>("binance");
  const [pair, setPair] = useState<(typeof PAIRS)[number]>("BTCUSDT");
  const [strategy, setStrategy] = useState<StratType>("mean_reversion");
  const [alloc, setAlloc] = useState("1000");
  const [perTrade, setPerTrade] = useState("2");
  const [maxDd, setMaxDd] = useState("5");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const deploy = async () => {
    const a = parseFloat(alloc);
    if (!isFinite(a) || a <= 0) {
      setErr("Allocation must be a positive number");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api("/strategies", {
        body: {
          name: name || `${strategy}-${pair}`,
          exchange,
          pair,
          strategy_type: strategy,
          allocation_usdt: a,
          risk: {
            per_trade_pct: Math.max(0.001, parseFloat(perTrade) / 100),
            max_dd_pct: Math.max(0.005, parseFloat(maxDd) / 100),
          },
        },
      });
      router.replace("/(tabs)/strategies");
    } catch (e: any) {
      setErr(e.message || "Deploy failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="strategy-new-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="strategy-new-back">
          <Icon name="chevron-left" size={20} color={colors.onSurface} />
        </Pressable>
        <View>
          <Text style={styles.brand}>DEPLOY · PAPER MODE</Text>
          <Text style={styles.title}>New Strategy</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.section}>Strategy</Text>
          <View style={{ gap: spacing.sm }}>
            {STRATS.map((s) => (
              <Pressable
                key={s.key}
                style={[styles.stratRow, strategy === s.key && styles.stratRowActive]}
                onPress={() => setStrategy(s.key)}
                testID={`strategy-${s.key}`}
              >
                <View style={styles.radio}>{strategy === s.key && <View style={styles.radioDot} />}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stratTitle}>{s.title}</Text>
                  <Text style={styles.stratDesc}>{s.desc}</Text>
                </View>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>Venue</Text>
          <View style={styles.rowSeg}>
            {EXCHANGES.map((ex) => (
              <Pressable key={ex} style={[styles.seg, exchange === ex && styles.segActive]} onPress={() => setExchange(ex)} testID={`venue-${ex}`}>
                <ExchangeBadge exchange={ex} />
                <Text style={[styles.segText, exchange === ex && { color: colors.onSurface }]}>{ex.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>Pair</Text>
          <View style={styles.rowSeg}>
            {PAIRS.map((p) => (
              <Pressable key={p} style={[styles.segSlim, pair === p && styles.segActive]} onPress={() => setPair(p)} testID={`pair-${p}`}>
                <Text style={[styles.segText, pair === p && { color: colors.onSurface }]}>{p.replace("USDT", "/USDT")}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>Configuration</Text>
          <View style={{ gap: spacing.md }}>
            <Field label="Bot name" value={name} onChangeText={setName} testID="input-name" />
            <Field label="Allocation (USDT)" keyboardType="numeric" value={alloc} onChangeText={setAlloc} testID="input-alloc" />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Field label="Per-trade risk (%)" keyboardType="numeric" value={perTrade} onChangeText={setPerTrade} testID="input-per-trade" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Max drawdown (%)" keyboardType="numeric" value={maxDd} onChangeText={setMaxDd} testID="input-max-dd" />
              </View>
            </View>
          </View>

          {err && <Text style={styles.err} testID="strategy-error">{err}</Text>}
        </ScrollView>

        <View style={[styles.sticky, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable style={[styles.deployBtn, saving && { opacity: 0.6 }]} onPress={deploy} disabled={saving} testID="deploy-btn">
            <Icon name="zap" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.deployText}>{saving ? "Deploying…" : "Deploy Bot"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, testID, ...props }: any) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        testID={testID}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  back: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  brand: { fontFamily: fonts.displayBold, color: colors.brandPrimary, letterSpacing: 2, fontSize: 10 },
  title: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 24 },
  section: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 13, letterSpacing: 0.6, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: spacing.sm },
  stratRow: { flexDirection: "row", padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, gap: spacing.md },
  stratRowActive: { borderColor: colors.brandPrimary, backgroundColor: colors.surfaceTertiary },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  stratTitle: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 15 },
  stratDesc: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, marginTop: 4 },
  rowSeg: { flexDirection: "row", gap: spacing.sm },
  seg: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  segSlim: { flex: 1, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, alignItems: "center" },
  segActive: { borderColor: colors.brandPrimary, backgroundColor: colors.surfaceTertiary },
  segText: { fontFamily: fonts.textMedium, color: colors.muted, fontSize: 12 },
  fieldLabel: { fontFamily: fonts.text, color: colors.muted, fontSize: 10, letterSpacing: 0.8, marginBottom: 6 },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.onSurface, fontFamily: fonts.text, fontSize: 14 },
  err: { color: colors.error, fontFamily: fonts.textMedium, fontSize: 12, marginTop: spacing.md },
  sticky: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, padding: spacing.lg },
  deployBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md },
  deployText: { fontFamily: fonts.displayBold, color: colors.onBrandPrimary, letterSpacing: 0.6, fontSize: 15 },
});
