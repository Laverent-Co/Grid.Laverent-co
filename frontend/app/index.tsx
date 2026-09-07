import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { api, getToken } from "@/src/api";
import { colors, fonts, spacing } from "@/src/theme";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const state = await api<{ pin_configured: boolean }>("/auth/state", { auth: false });
        if (!state.pin_configured) {
          router.replace("/setup-pin");
          return;
        }
        const token = await getToken();
        if (!token) {
          router.replace("/unlock");
          return;
        }
        // Verify the token still works.
        try {
          await api("/strategies");
          router.replace("/(tabs)/dashboard");
        } catch {
          router.replace("/unlock");
        }
      } catch {
        router.replace("/unlock");
      }
    })();
  }, [router]);

  return (
    <View style={styles.container} testID="splash-screen">
      <View style={styles.logoBadge}>
        <Text style={styles.logoTicker}>CB</Text>
      </View>
      <Text style={styles.title}>CryptoBot Terminal</Text>
      <Text style={styles.sub}>Multi-exchange · Multi-strategy</Text>
      <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 16,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  logoTicker: { fontFamily: fonts.displayBold, fontSize: 30, color: colors.onBrandPrimary, letterSpacing: 1 },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.onSurface, letterSpacing: 0.8 },
  sub: { fontFamily: fonts.text, fontSize: 13, color: colors.muted, marginTop: spacing.xs },
});
