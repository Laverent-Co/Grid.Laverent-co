import Icon from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { rcEnabled, useSubscription } from "@/src/lib/revenuecat";
import { colors, fonts, radius, spacing } from "@/src/theme";

const PRO_FEATURES = [
  "Unlimited concurrent bots",
  "Any pair on any connected exchange",
  "Advanced parameter editor",
  "Priority Claude sentiment refreshes",
  "Backtest preview on every strategy",
];

const WG_FEATURES = [
  "Dynamic band that walks with the market",
  "Idle-detection prevents dead grids",
  "Compatible with stop-loss + trailing stop",
  "Best-in-class for choppy uptrends",
];

export default function Paywall() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    offering,
    proPackage,
    walkingGridPackage,
    isPro,
    hasWalkingGrid,
    identityReady,
    identityError,
    purchase,
    restore,
    isPurchasing,
    isRestoring,
  } = useSubscription();

  const buy = async (pkg: any) => {
    if (!pkg) return;
    try {
      await purchase(pkg);
    } catch (e: any) {
      // Silently ignore user cancels.
      if (String(e?.message || "").includes("userCancelled")) return;
    }
  };

  const noOfferings = !offering || (!proPackage && !walkingGridPackage);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="paywall-screen">
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} testID="paywall-back">
          <Icon name="chevron-left" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>..::GRID::..</Text>
          <Text style={styles.brandSub}>Laverent-Co.</Text>
          <Text style={styles.title}>Unlock the fleet</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {!rcEnabled && (
          <View style={styles.notice}>
            <Icon name="alert-circle" size={16} color={colors.warning} />
            <Text style={styles.noticeText}>Purchases are only available in the mobile app.</Text>
          </View>
        )}
        {identityError && (
          <View style={[styles.notice, { backgroundColor: "rgba(255,69,58,0.14)" }]}>
            <Icon name="alert-circle" size={16} color={colors.error} />
            <Text style={[styles.noticeText, { color: colors.error }]}>{identityError}</Text>
          </View>
        )}
        {noOfferings && (
          <View style={styles.notice}>
            <Icon name="clock" size={16} color={colors.muted} />
            <Text style={styles.noticeText}>
              Subscription options are unavailable right now. Please try again later.
            </Text>
          </View>
        )}

        <View style={[styles.card, styles.cardPro]} testID="pro-card">
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.tierTag}>PRO</Text>
              <Text style={styles.tierTitle}>Grid Pro</Text>
            </View>
            {isPro && <View style={styles.ownedPill}><Text style={styles.ownedText}>ACTIVE</Text></View>}
          </View>
          <Text style={styles.price}>
            {proPackage?.product.priceString || "$19.99"}<Text style={styles.pricePer}> / month</Text>
          </Text>
          <View style={{ marginTop: spacing.md, gap: 8 }}>
            {PRO_FEATURES.map((f) => (
              <View key={f} style={styles.featRow}>
                <Icon name="check" size={14} color={colors.brandPrimary} />
                <Text style={styles.featText}>{f}</Text>
              </View>
            ))}
          </View>
          {!isPro && (
            <Pressable
              testID="buy-pro-btn"
              style={[styles.cta, (!proPackage || isPurchasing || !identityReady) && styles.ctaDisabled]}
              onPress={() => buy(proPackage)}
              disabled={!proPackage || isPurchasing || !identityReady}
            >
              <Text style={styles.ctaText}>{isPurchasing ? "Purchasing…" : `Subscribe · ${proPackage?.product.priceString || "$19.99"}`}</Text>
            </Pressable>
          )}
        </View>

        <View style={[styles.card, styles.cardWg]} testID="wg-card">
          <View style={styles.rowBetween}>
            <View>
              <Text style={[styles.tierTag, { color: colors.warning }]}>ADD-ON</Text>
              <Text style={styles.tierTitle}>Walking Grid</Text>
            </View>
            {hasWalkingGrid && <View style={styles.ownedPill}><Text style={styles.ownedText}>ACTIVE</Text></View>}
          </View>
          <Text style={styles.price}>
            {walkingGridPackage?.product.priceString || "$4.99"}<Text style={styles.pricePer}> / month</Text>
          </Text>
          <View style={{ marginTop: spacing.md, gap: 8 }}>
            {WG_FEATURES.map((f) => (
              <View key={f} style={styles.featRow}>
                <Icon name="trending-up" size={14} color={colors.warning} />
                <Text style={styles.featText}>{f}</Text>
              </View>
            ))}
          </View>
          {!hasWalkingGrid && (
            <Pressable
              testID="buy-wg-btn"
              style={[styles.cta, styles.ctaAlt, (!walkingGridPackage || isPurchasing || !identityReady) && styles.ctaDisabled]}
              onPress={() => buy(walkingGridPackage)}
              disabled={!walkingGridPackage || isPurchasing || !identityReady}
            >
              <Text style={[styles.ctaText, { color: colors.onSurface }]}>
                {isPurchasing ? "Purchasing…" : `Add · ${walkingGridPackage?.product.priceString || "$4.99"}`}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={{ alignItems: "center", marginTop: spacing.lg, gap: spacing.sm }}>
          <Pressable onPress={() => restore()} testID="restore-btn">
            <Text style={styles.restore}>{isRestoring ? "Restoring…" : "Restore purchases"}</Text>
          </Pressable>
          <Text style={styles.footer}>
            Auto-renews monthly. Cancel any time from your device account. Test purchases are simulated in Expo Go / web preview.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  back: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  brand: { fontFamily: fonts.displayBold, color: colors.brandPrimary, letterSpacing: 2, fontSize: 10 },
  brandSub: { fontFamily: fonts.text, color: colors.muted, fontSize: 9, marginTop: 1 },
  title: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 24 },
  card: { padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.md, backgroundColor: colors.surfaceSecondary },
  cardPro: { borderColor: colors.brandPrimary },
  cardWg: { borderColor: colors.warning },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tierTag: { fontFamily: fonts.displayBold, fontSize: 10, letterSpacing: 1.4, color: colors.brandPrimary },
  tierTitle: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.onSurface, marginTop: 2 },
  price: { fontFamily: fonts.displayBold, fontSize: 32, color: colors.onSurface, marginTop: spacing.sm },
  pricePer: { fontFamily: fonts.text, fontSize: 14, color: colors.muted },
  featRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  featText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 13 },
  cta: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center" },
  ctaAlt: { backgroundColor: colors.warning },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontFamily: fonts.displayBold, color: colors.onBrandPrimary, letterSpacing: 0.6, fontSize: 15 },
  ownedPill: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm },
  ownedText: { fontFamily: fonts.displayBold, color: colors.brandPrimary, fontSize: 10, letterSpacing: 1 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  noticeText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: fonts.text, fontSize: 12 },
  restore: { fontFamily: fonts.textMedium, color: colors.brandPrimary, fontSize: 13 },
  footer: { fontFamily: fonts.text, color: colors.muted, fontSize: 11, textAlign: "center", paddingHorizontal: spacing.md },
});
