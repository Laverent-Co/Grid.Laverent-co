import * as LocalAuthentication from "expo-local-authentication";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, setToken } from "@/src/api";
import { PinPad } from "@/src/components/pin-pad";
import { colors, fonts, spacing } from "@/src/theme";

const PIN_LEN = 4;

export default function Unlock() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);

  useEffect(() => {
    LocalAuthentication.hasHardwareAsync()
      .then(async (has) => {
        if (!has) return;
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        setHasBiometrics(enrolled);
      })
      .catch(() => {});
  }, []);

  const submit = async (v: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ session_token: string }>("/auth/unlock", { body: { pin: v }, auth: false });
      await setToken(res.session_token);
      router.replace("/(tabs)/dashboard");
    } catch (e: any) {
      setError(e.status === 401 ? "Incorrect PIN" : e.message || "Failed");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const bioUnlock = async () => {
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Vault",
        disableDeviceFallback: false,
      });
      if (!res.success) return;
      // Biometric alone can't recover the server PIN; we ask the user to still enter it once.
      setError("Enter PIN once to derive vault session");
    } catch {}
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} testID="unlock-screen">
      <View style={styles.header}>
        <Text style={styles.brand}>CRYPTOBOT · SECURE VAULT</Text>
        <Text style={styles.title}>Enter PIN</Text>
        <Text style={styles.sub}>API keys never leave the encrypted vault. Withdrawal is disabled by policy.</Text>
      </View>
      <View style={styles.padWrap}>
        <PinPad value={pin} onChange={setPin} onSubmit={submit} length={PIN_LEN} error={!!error} />
        {error && <Text style={styles.error} testID="unlock-error">{error}</Text>}
        {busy && <Text style={styles.busy}>Verifying…</Text>}
        {hasBiometrics && (
          <Pressable style={styles.bio} onPress={bioUnlock} testID="bio-unlock">
            <Text style={styles.bioText}>Use biometrics</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.xl },
  header: { alignItems: "center", marginBottom: spacing["2xl"] },
  brand: { fontFamily: fonts.displayBold, color: colors.brandPrimary, letterSpacing: 2, fontSize: 12, marginBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 26 },
  sub: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, textAlign: "center", marginTop: spacing.sm, paddingHorizontal: spacing.md },
  padWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: colors.error, fontFamily: fonts.textMedium, marginTop: spacing.lg, fontSize: 13 },
  busy: { color: colors.muted, fontFamily: fonts.text, marginTop: spacing.lg, fontSize: 13 },
  bio: { marginTop: spacing.xl, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  bioText: { fontFamily: fonts.textMedium, color: colors.onSurfaceSecondary, fontSize: 13 },
});
