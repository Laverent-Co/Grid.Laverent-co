import Icon from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ExchangeBadge } from "@/src/components/ui";
import { Sparkline } from "@/src/components/sparkline";
import { useSubscription } from "@/src/lib/revenuecat";
import { colors, fonts, radius, spacing } from "@/src/theme";

const EXCHANGES = ["binance", "coinbase", "kraken"] as const;
const FREE_PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

type StratType = "mean_reversion" | "trend_following" | "grid" | "walking_grid";
const STRATS: { key: StratType; title: string; desc: string; addon?: "walking_grid" }[] = [
  { key: "mean_reversion", title: "Mean Reversion", desc: "Bollinger z-score fade. Buys 2σ below the 20-period mean, exits toward mean." },
  { key: "trend_following", title: "Trend Following", desc: "SMA cross (9/30) filtered by VWAP. Rides trending regimes." },
  { key: "grid", title: "Grid", desc: "Buys the dip / sells the top across a fixed price band. Best in ranging regimes." },
  { key: "walking_grid", title: "Walking Grid", desc: "Dynamic grid whose band walks with the market when idle. Add-on required.", addon: "walking_grid" },
];

type BacktestOut = {
  bars: number;
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  final_equity: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  halted_early: boolean;
  equity_curve: number[];
};

export default function StrategyNew() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isPro, hasWalkingGrid } = useSubscription();

  const [name, setName] = useState("Alpha Bot");
  const [exchange, setExchange] = useState<(typeof EXCHANGES)[number]>("binance");
  const [pair, setPair] = useState<string>("BTCUSDT");
  const [strategy, setStrategy] = useState<StratType>("mean_reversion");
  const [alloc, setAlloc] = useState("1000");
  const [perTrade, setPerTrade] = useState("2");
  const [maxDd, setMaxDd] = useState("5");
  const [stopLoss, setStopLoss] = useState("3");
  const [trailingStop, setTrailingStop] = useState("2");
  const [advanced, setAdvanced] = useState(false);
  const [pairs, setPairs] = useState<string[]>(FREE_PAIRS);
  // Advanced params
  const [mrPeriod, setMrPeriod] = useState("20");
  const [mrZ, setMrZ] = useState("2");
  const [tfFast, setTfFast] = useState("9");
  const [tfSlow, setTfSlow] = useState("30");
  const [gridLower, setGridLower] = useState("");
  const [gridUpper, setGridUpper] = useState("");
  const [gridLevels, setGridLevels] = useState("6");
  const [wgDrift, setWgDrift] = useState("2");
  const [wgIdle, setWgIdle] = useState("4");

  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bt, setBt] = useState<BacktestOut | null>(null);
  const [btLoading, setBtLoading] = useState(false);

  useEffect(() => {
    api("/market/supported", { auth: false }).then((s: any) => setPairs(s.pairs || FREE_PAIRS)).catch(() => {});
  }, []);

  const availablePairs = isPro ? pairs : FREE_PAIRS;
  const walkingGridLocked = strategy === "walking_grid" && !hasWalkingGrid;
  const advancedLocked = advanced && !isPro;

  const buildParams = (): any => {
    if (!advanced) return {};
    if (strategy === "mean_reversion") return { period: parseInt(mrPeriod) || 20, z_entry: parseFloat(mrZ) || 2 };
    if (strategy === "trend_following") return { fast: parseInt(tfFast) || 9, slow: parseInt(tfSlow) || 30 };
    if (strategy === "grid" || strategy === "walking_grid") {
      const p: any = { levels: parseInt(gridLevels) || 6 };
      if (gridLower) p.lower = parseFloat(gridLower);
      if (gridUpper) p.upper = parseFloat(gridUpper);
      if (strategy === "walking_grid") {
        p.drift_pct = (parseFloat(wgDrift) || 2) / 100;
        p.idle_ticks = parseInt(wgIdle) || 4;
      }
      return p;
    }
    return {};
  };

  const buildRisk = () => ({
    per_trade_pct: Math.max(0.001, (parseFloat(perTrade) || 2) / 100),
    max_dd_pct: Math.max(0.005, (parseFloat(maxDd) || 5) / 100),
    stop_loss_pct: Math.max(0, (parseFloat(stopLoss) || 0) / 100),
    trailing_stop_pct: Math.max(0, (parseFloat(trailingStop) || 0) / 100),
  });

  const runBacktest = async () => {
    if (walkingGridLocked || advancedLocked) return;
    setBtLoading(true);
    setBt(null);
    try {
      const out = await api<BacktestOut>("/backtest", {
        body: {
          pair,
          strategy_type: strategy,
          allocation_usdt: parseFloat(alloc) || 1000,
          params: buildParams(),
          risk: buildRisk(),
        },
      });
      setBt(out);
    } catch (e: any) {
      setErr(e.message || "Backtest failed");
    } finally {
      setBtLoading(false);
    }
  };

  const deploy = async () => {
    if (walkingGridLocked) {
      router.push("/paywall");
      return;
    }
    if (advancedLocked) {
      router.push("/paywall");
      return;
    }
    if (!isPro && !FREE_PAIRS.includes(pair)) {
      router.push("/paywall");
      return;
    }
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
          params: buildParams(),
          risk: buildRisk(),
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
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>DEPLOY · PAPER MODE</Text>
          <Text style={styles.title}>New Strategy</Text>
        </View>
        {!isPro && (
          <Pressable style={styles.upgrade} onPress={() => router.push("/paywall")} testID="upgrade-btn">
            <Icon name="zap" size={12} color={colors.onBrandPrimary} />
            <Text style={styles.upgradeText}>PRO</Text>
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 180 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.section}>Strategy</Text>
          <View style={{ gap: spacing.sm }}>
            {STRATS.map((s) => {
              const isLocked = s.key === "walking_grid" && !hasWalkingGrid;
              return (
                <Pressable
                  key={s.key}
                  style={[styles.stratRow, strategy === s.key && styles.stratRowActive]}
                  onPress={() => setStrategy(s.key)}
                  testID={`strategy-${s.key}`}
                >
                  <View style={styles.radio}>{strategy === s.key && <View style={styles.radioDot} />}</View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={styles.stratTitle}>{s.title}</Text>
                      {isLocked && (
                        <View style={styles.locked}><Icon name="lock" size={10} color={colors.warning} /><Text style={styles.lockedText}>ADD-ON</Text></View>
                      )}
                    </View>
                    <Text style={styles.stratDesc}>{s.desc}</Text>
                  </View>
                </Pressable>
              );
            })}
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

          <View style={styles.rowBetween}>
            <Text style={styles.section}>Pair</Text>
            {!isPro && <Text style={styles.mutedSm}>Free: BTC · ETH · SOL</Text>}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}>
            {(isPro ? pairs : FREE_PAIRS).map((p) => (
              <Pressable key={p} style={[styles.pairChip, pair === p && styles.segActive]} onPress={() => setPair(p)} testID={`pair-${p}`}>
                <Text style={[styles.segText, pair === p && { color: colors.onSurface }]}>{p.replace("USDT", "")}</Text>
              </Pressable>
            ))}
            {!isPro && pairs.filter((p) => !FREE_PAIRS.includes(p)).slice(0, 6).map((p) => (
              <Pressable key={p} style={[styles.pairChip, styles.pairChipLocked]} onPress={() => router.push("/paywall")} testID={`pair-locked-${p}`}>
                <Icon name="lock" size={10} color={colors.warning} />
                <Text style={[styles.segText, { color: colors.muted }]}>{p.replace("USDT", "")}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.section}>Risk (all tiers)</Text>
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
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Field label="Stop-loss (%)" keyboardType="numeric" value={stopLoss} onChangeText={setStopLoss} testID="input-stop-loss" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Trailing stop (%)" keyboardType="numeric" value={trailingStop} onChangeText={setTrailingStop} testID="input-trailing" />
              </View>
            </View>
          </View>

          <Pressable
            style={[styles.advancedToggle, advancedLocked && { opacity: 0.6 }]}
            onPress={() => {
              if (!isPro) { router.push("/paywall"); return; }
              setAdvanced((v) => !v);
            }}
            testID="advanced-toggle"
          >
            <Icon name={advanced ? "chevron-down" : "chevron-right"} size={16} color={colors.brandPrimary} />
            <Text style={styles.advancedText}>Advanced parameters</Text>
            {!isPro && <View style={styles.locked}><Icon name="lock" size={10} color={colors.warning} /><Text style={styles.lockedText}>PRO</Text></View>}
          </Pressable>

          {advanced && isPro && (
            <View style={styles.advancedBox}>
              {strategy === "mean_reversion" && (
                <View style={{ gap: spacing.sm }}>
                  <Field label="Period" keyboardType="numeric" value={mrPeriod} onChangeText={setMrPeriod} testID="adv-period" />
                  <Field label="Entry Z" keyboardType="numeric" value={mrZ} onChangeText={setMrZ} testID="adv-z" />
                </View>
              )}
              {strategy === "trend_following" && (
                <View style={{ gap: spacing.sm }}>
                  <Field label="Fast SMA" keyboardType="numeric" value={tfFast} onChangeText={setTfFast} testID="adv-fast" />
                  <Field label="Slow SMA" keyboardType="numeric" value={tfSlow} onChangeText={setTfSlow} testID="adv-slow" />
                </View>
              )}
              {(strategy === "grid" || strategy === "walking_grid") && (
                <View style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}><Field label="Lower price" keyboardType="numeric" value={gridLower} onChangeText={setGridLower} testID="adv-lower" /></View>
                    <View style={{ flex: 1 }}><Field label="Upper price" keyboardType="numeric" value={gridUpper} onChangeText={setGridUpper} testID="adv-upper" /></View>
                  </View>
                  <Field label="Levels" keyboardType="numeric" value={gridLevels} onChangeText={setGridLevels} testID="adv-levels" />
                  {strategy === "walking_grid" && (
                    <View style={{ flexDirection: "row", gap: spacing.sm }}>
                      <View style={{ flex: 1 }}><Field label="Drift (%)" keyboardType="numeric" value={wgDrift} onChangeText={setWgDrift} testID="adv-drift" /></View>
                      <View style={{ flex: 1 }}><Field label="Idle ticks" keyboardType="numeric" value={wgIdle} onChangeText={setWgIdle} testID="adv-idle" /></View>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          <View style={styles.rowBetween}>
            <Text style={styles.section}>Backtest preview</Text>
            <Pressable style={styles.smallBtn} onPress={runBacktest} disabled={btLoading || walkingGridLocked} testID="run-backtest-btn">
              <Icon name="play" size={12} color={colors.onSurface} />
              <Text style={styles.smallBtnText}>{btLoading ? "Running…" : "Run"}</Text>
            </Pressable>
          </View>
          <View style={styles.btCard} testID="backtest-card">
            {!bt && <Text style={styles.mutedSm}>Run a backtest against the last ~7d of hourly data before you deploy.</Text>}
            {bt && (
              <View style={{ gap: 8 }}>
                <Sparkline data={bt.equity_curve.length > 1 ? bt.equity_curve : [1000, 1000]} height={70} />
                <View style={styles.btMetrics}>
                  <BtCell k="Return" v={`${bt.total_return_pct.toFixed(2)}%`} tone={bt.total_return_pct >= 0 ? "pos" : "neg"} />
                  <BtCell k="Trades" v={String(bt.trades)} />
                  <BtCell k="Win rate" v={`${bt.win_rate_pct.toFixed(0)}%`} tone={bt.win_rate_pct >= 50 ? "pos" : "neg"} />
                  <BtCell k="Max DD" v={`${bt.max_drawdown_pct.toFixed(2)}%`} tone="neg" />
                </View>
                {bt.halted_early && <Text style={[styles.mutedSm, { color: colors.error }]}>Simulation halted early by max drawdown.</Text>}
              </View>
            )}
          </View>

          {err && <Text style={styles.err} testID="strategy-error">{err}</Text>}
        </ScrollView>

        <View style={[styles.sticky, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable
            style={[styles.deployBtn, (saving || walkingGridLocked) && { opacity: 0.6 }]}
            onPress={deploy}
            disabled={saving}
            testID="deploy-btn"
          >
            <Icon name="zap" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.deployText}>
              {walkingGridLocked ? "Unlock Walking Grid" : saving ? "Deploying…" : "Deploy Bot"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function BtCell({ k, v, tone }: { k: string; v: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? colors.success : tone === "neg" ? colors.error : colors.onSurface;
  return (
    <View style={styles.btCell}>
      <Text style={styles.btK}>{k}</Text>
      <Text style={[styles.btV, { color }]}>{v}</Text>
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
  upgrade: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm },
  upgradeText: { fontFamily: fonts.displayBold, color: colors.onBrandPrimary, fontSize: 11, letterSpacing: 1 },
  section: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 13, letterSpacing: 0.6, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: spacing.sm },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mutedSm: { fontFamily: fonts.text, color: colors.muted, fontSize: 11 },
  stratRow: { flexDirection: "row", padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, gap: spacing.md },
  stratRowActive: { borderColor: colors.brandPrimary, backgroundColor: colors.surfaceTertiary },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  stratTitle: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 15 },
  stratDesc: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, marginTop: 4 },
  locked: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,214,10,0.15)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  lockedText: { fontFamily: fonts.displayBold, color: colors.warning, fontSize: 9, letterSpacing: 0.8 },
  rowSeg: { flexDirection: "row", gap: spacing.sm },
  seg: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  pairChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  pairChipLocked: { opacity: 0.55 },
  segActive: { borderColor: colors.brandPrimary, backgroundColor: colors.surfaceTertiary },
  segText: { fontFamily: fonts.textMedium, color: colors.muted, fontSize: 12 },
  fieldLabel: { fontFamily: fonts.text, color: colors.muted, fontSize: 10, letterSpacing: 0.8, marginBottom: 6 },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.onSurface, fontFamily: fonts.text, fontSize: 14 },
  advancedToggle: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.lg, paddingVertical: 8 },
  advancedText: { fontFamily: fonts.displayBold, color: colors.brandPrimary, letterSpacing: 0.6, fontSize: 13 },
  advancedBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.sm },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  smallBtnText: { fontFamily: fonts.textMedium, color: colors.onSurface, fontSize: 12 },
  btCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.sm },
  btMetrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  btCell: { flex: 1, minWidth: "45%", backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, padding: spacing.sm },
  btK: { fontFamily: fonts.text, color: colors.muted, fontSize: 10, letterSpacing: 0.6 },
  btV: { fontFamily: fonts.displayBold, fontSize: 14, marginTop: 2 },
  err: { color: colors.error, fontFamily: fonts.textMedium, fontSize: 12, marginTop: spacing.md },
  sticky: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, padding: spacing.lg },
  deployBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md },
  deployText: { fontFamily: fonts.displayBold, color: colors.onBrandPrimary, letterSpacing: 0.6, fontSize: 15 },
});
