import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, setToken } from "@/src/api";
import { PinPad } from "@/src/components/pin-pad";
import { colors, fonts, spacing } from "@/src/theme";

const PIN_LEN = 4;

export default function SetupPin() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<"create" | "confirm">("create");
  const [first, setFirst] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (v: string) => {
    if (stage === "create") {
      setFirst(v);
      setPin("");
      setStage("confirm");
      setError(null);
      return;
    }
    if (v !== first) {
      setError("PIN codes do not match");
      setPin("");
      setStage("create");
      setFirst("");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ session_token: string }>("/auth/setup", { body: { pin: v }, auth: false });
      await setToken(res.session_token);
      router.replace("/(tabs)/dashboard");
    } catch (e: any) {
      setError(e.message || "Setup failed");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} testID="setup-pin-screen">
      <View style={styles.header}>
        <Text style={styles.brand}>..::GRID::..</Text>
        <Text style={styles.brandSub}>Laverent-Co.</Text>
        <Text style={styles.title}>{stage === "create" ? "Create Vault PIN" : "Confirm PIN"}</Text>
        <Text style={styles.sub}>
          {stage === "create"
            ? "Your PIN unlocks the local vault where exchange API keys are encrypted with AES-Fernet."
            : "Enter the same PIN again to secure the vault."}
        </Text>
      </View>
      <View style={styles.padWrap}>
        <PinPad value={pin} onChange={setPin} onSubmit={onSubmit} length={PIN_LEN} error={!!error} />
        {error && <Text style={styles.error} testID="pin-error">{error}</Text>}
        {busy && <Text style={styles.busy}>Encrypting vault…</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.xl },
  header: { alignItems: "center", marginBottom: spacing["2xl"] },
  brand: { fontFamily: fonts.displayBold, color: colors.brandPrimary, letterSpacing: 2, fontSize: 12 },
  brandSub: { fontFamily: fonts.text, color: colors.muted, fontSize: 10, marginTop: 2, marginBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 26, letterSpacing: 0.6 },
  sub: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, textAlign: "center", marginTop: spacing.sm, paddingHorizontal: spacing.md },
  padWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: colors.error, fontFamily: fonts.textMedium, marginTop: spacing.lg, fontSize: 13 },
  busy: { color: colors.muted, fontFamily: fonts.text, marginTop: spacing.lg, fontSize: 13 },
});
