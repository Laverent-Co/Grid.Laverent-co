import Icon from "@react-native-vector-icons/feather";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { Chip } from "@/src/components/ui";
import { Sparkline } from "@/src/components/sparkline";
import { usePolling } from "@/src/usePolling";
import { colors, fonts, radius, spacing } from "@/src/theme";

type PairSnap = { pair: string; price: number; change_24h: number; history: number[]; regime: string };
type PairDetail = PairSnap & { vwap: number; bollinger: { mean: number; upper: number; lower: number } | null };
type Book = { pair: string; bids: [number, number][]; asks: [number, number][]; mid: number };
type Sentiment = { pair: string; score: number; label: string; confidence: number; drivers: string[]; headlines: string[]; generated_at: string };

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const TABS = ["Chart", "Order Book", "Sentiment"] as const;

export default function Market() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<string>("BTCUSDT");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Chart");
  const { data: pairs } = usePolling<PairSnap[]>(() => api("/market/pairs", { auth: false }), 4000);
  const { data: detail } = usePolling<PairDetail>(() => api(`/market/${selected}`, { auth: false }), 4000, [selected]);
  const { data: book } = usePolling<Book>(() => api(`/market/${selected}/orderbook`, { auth: false }), 3000, [selected, tab]);
  const { data: sentiment, refresh: refreshSent } = usePolling<Sentiment>(() => api(`/sentiment/${selected}`), 60000, [selected]);
  const [refreshing, setRefreshing] = useState(false);

  const doRefreshSentiment = async () => {
    setRefreshing(true);
    try {
      await api("/sentiment", { body: { pair: selected, headlines: [] } });
      refreshSent();
    } finally {
      setRefreshing(false);
    }
  };

  const active = (pairs || []).find((p) => p.pair === selected) || detail;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="market-screen">
      <View style={styles.header}>
        <Text style={styles.brand}>LIVE FEED</Text>
        <Text style={styles.title}>Market</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm }}
      >
        {(pairs || []).map((p) => (
          <Pressable
            key={p.pair}
            style={[styles.chip, selected === p.pair && styles.chipActive]}
            onPress={() => setSelected(p.pair)}
            testID={`pair-chip-${p.pair}`}
          >
            <Text style={[styles.chipTitle, selected === p.pair && { color: colors.onBrandPrimary }]}>{p.pair.replace("USDT", "")}</Text>
            <Text style={[styles.chipPrice, selected === p.pair && { color: colors.onBrandPrimary }]}>{money(p.price)}</Text>
            <Text style={[styles.chipChange, { color: p.change_24h >= 0 ? colors.success : colors.error }]}>{pct(p.change_24h)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.tabsRow}>
        {TABS.map((t) => (
          <Pressable key={t} style={[styles.tabBtn, tab === t && styles.tabActive]} onPress={() => setTab(t)} testID={`tab-${t}`}>
            <Text style={[styles.tabText, tab === t && { color: colors.onSurface }]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {active && (
          <View style={styles.priceRow}>
            <View>
              <Text style={styles.priceLabel}>{active.pair}</Text>
              <Text style={styles.price}>{money(active.price)}</Text>
              <Text style={[styles.change, { color: active.change_24h >= 0 ? colors.success : colors.error }]}>{pct(active.change_24h)} · 24h</Text>
            </View>
            <Chip label={active.regime.toUpperCase()} tone={active.regime === "trending" ? "pos" : active.regime === "volatile" ? "warn" : "neutral"} />
          </View>
        )}

        {tab === "Chart" && (
          <View style={styles.card} testID="chart-panel">
            <Sparkline data={detail?.history || []} height={180} />
            {detail?.bollinger && (
              <View style={styles.metricsRow}>
                <View style={styles.mCell}><Text style={styles.mLabel}>VWAP</Text><Text style={styles.mVal}>{money(detail.vwap)}</Text></View>
                <View style={styles.mCell}><Text style={styles.mLabel}>BB Mean</Text><Text style={styles.mVal}>{money(detail.bollinger.mean)}</Text></View>
                <View style={styles.mCell}><Text style={styles.mLabel}>BB Upper</Text><Text style={styles.mVal}>{money(detail.bollinger.upper)}</Text></View>
                <View style={styles.mCell}><Text style={styles.mLabel}>BB Lower</Text><Text style={styles.mVal}>{money(detail.bollinger.lower)}</Text></View>
              </View>
            )}
          </View>
        )}

        {tab === "Order Book" && (
          <View style={styles.card} testID="book-panel">
            <View style={styles.bookHeader}>
              <Text style={styles.bookHead}>PRICE</Text>
              <Text style={styles.bookHead}>SIZE</Text>
            </View>
            {(book?.asks || []).slice().reverse().map(([p, s], i) => (
              <View key={`a${i}`} style={styles.bookRow}>
                <Text style={[styles.bookPrice, { color: colors.error }]}>{money(p)}</Text>
                <View style={styles.depthBg}>
                  <View style={[styles.depthFill, { backgroundColor: "rgba(255,69,58,0.16)", width: `${Math.min(100, s * 20)}%` }]} />
                  <Text style={styles.bookQty}>{s.toFixed(3)}</Text>
                </View>
              </View>
            ))}
            {book && (
              <View style={styles.mid}><Text style={styles.midText}>MID {money(book.mid)}</Text></View>
            )}
            {(book?.bids || []).map(([p, s], i) => (
              <View key={`b${i}`} style={styles.bookRow}>
                <Text style={[styles.bookPrice, { color: colors.success }]}>{money(p)}</Text>
                <View style={styles.depthBg}>
                  <View style={[styles.depthFill, { backgroundColor: "rgba(50,215,75,0.16)", width: `${Math.min(100, s * 20)}%` }]} />
                  <Text style={styles.bookQty}>{s.toFixed(3)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {tab === "Sentiment" && (
          <View style={styles.card} testID="sentiment-panel">
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.sentLabel}>LLM SIGNAL · Claude Sonnet 4.6</Text>
                {sentiment && (
                  <Text style={[styles.sentScore, { color: sentiment.label === "bullish" ? colors.success : sentiment.label === "bearish" ? colors.error : colors.muted }]}>
                    {sentiment.label.toUpperCase()} {sentiment.score >= 0 ? "+" : ""}{sentiment.score.toFixed(2)}
                  </Text>
                )}
                {sentiment && <Text style={styles.sentConf}>Confidence {(sentiment.confidence * 100).toFixed(0)}%</Text>}
              </View>
              <Pressable style={styles.refreshBtn} onPress={doRefreshSentiment} disabled={refreshing} testID="refresh-sentiment-btn">
                <Icon name="refresh-cw" size={14} color={colors.onSurface} />
                <Text style={styles.refreshText}>{refreshing ? "Analyzing…" : "Re-analyze"}</Text>
              </Pressable>
            </View>
            {sentiment && sentiment.drivers.length > 0 && (
              <View style={{ marginTop: spacing.md, gap: 6 }}>
                <Text style={styles.driversTitle}>DRIVERS</Text>
                {sentiment.drivers.map((d, i) => (
                  <Text key={i} style={styles.driver}>▸ {d}</Text>
                ))}
              </View>
            )}
            {sentiment && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.driversTitle}>HEADLINES</Text>
                {(sentiment.headlines || []).map((h, i) => (
                  <Text key={i} style={styles.headline}>· {h}</Text>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  brand: { fontFamily: fonts.displayBold, color: colors.brandPrimary, letterSpacing: 2, fontSize: 10 },
  title: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 24 },
  chip: { flexShrink: 0, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 8, minWidth: 110 },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipTitle: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 13, letterSpacing: 0.6 },
  chipPrice: { fontFamily: fonts.textMedium, color: colors.onSurface, fontSize: 12, marginTop: 2 },
  chipChange: { fontFamily: fonts.textMedium, fontSize: 11, marginTop: 2 },
  tabsRow: { flexDirection: "row", paddingHorizontal: spacing.lg, gap: spacing.sm, marginTop: spacing.sm },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  tabActive: { borderColor: colors.brandPrimary, backgroundColor: colors.surfaceTertiary },
  tabText: { fontFamily: fonts.textMedium, color: colors.muted, fontSize: 12, letterSpacing: 0.4 },
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  priceLabel: { fontFamily: fonts.textMedium, color: colors.muted, fontSize: 11, letterSpacing: 0.8 },
  price: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 30, marginTop: 2 },
  change: { fontFamily: fonts.textMedium, fontSize: 13, marginTop: 2 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  metricsRow: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md, gap: spacing.sm },
  mCell: { flex: 1, minWidth: "45%", backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, padding: spacing.sm },
  mLabel: { fontFamily: fonts.text, color: colors.muted, fontSize: 10, letterSpacing: 0.6 },
  mVal: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 14, marginTop: 2 },
  bookHeader: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.sm, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  bookHead: { fontFamily: fonts.text, color: colors.muted, fontSize: 10, letterSpacing: 0.8 },
  bookRow: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
  bookPrice: { fontFamily: fonts.displayBold, fontSize: 12, width: 100, paddingLeft: spacing.sm },
  depthBg: { flex: 1, height: 20, justifyContent: "center", paddingRight: spacing.sm, position: "relative" },
  depthFill: { position: "absolute", right: 0, top: 0, bottom: 0, borderRadius: 2 },
  bookQty: { fontFamily: fonts.text, color: colors.onSurfaceTertiary, fontSize: 11, textAlign: "right" },
  mid: { paddingVertical: 6, alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.brandPrimary },
  midText: { fontFamily: fonts.displayBold, color: colors.brandPrimary, fontSize: 12, letterSpacing: 0.6 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sentLabel: { fontFamily: fonts.textMedium, color: colors.muted, fontSize: 10, letterSpacing: 1.2 },
  sentScore: { fontFamily: fonts.displayBold, fontSize: 24, marginTop: 4 },
  sentConf: { fontFamily: fonts.text, color: colors.muted, fontSize: 11, marginTop: 2 },
  refreshBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary },
  refreshText: { fontFamily: fonts.textMedium, color: colors.onSurface, fontSize: 12 },
  driversTitle: { fontFamily: fonts.textMedium, color: colors.muted, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  driver: { fontFamily: fonts.text, color: colors.onSurface, fontSize: 13 },
  headline: { fontFamily: fonts.text, color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
});
