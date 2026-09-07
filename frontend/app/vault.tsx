import Icon from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { Chip, ExchangeBadge } from "@/src/components/ui";
import { usePolling } from "@/src/usePolling";
import { colors, fonts, radius, spacing } from "@/src/theme";

type Key = { id: string; exchange: string; label: string | null; api_key_masked: string; withdrawal_disabled: boolean; created_at: string };
const EXCHANGES = ["binance", "coinbase", "kraken"] as const;

export default function Vault() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, refresh } = usePolling<Key[]>(() => api("/vault/keys"), 10000);
  const [form, setForm] = useState<{ exchange: (typeof EXCHANGES)[number]; label: string; api_key: string; api_secret: string; passphrase: string }>({
    exchange: "binance",
    label: "",
    api_key: "",
    api_secret: "",
    passphrase: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.api_key.trim() || !form.api_secret.trim()) {
      setErr("API key and secret are required");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api("/vault/keys", {
        body: {
          exchange: form.exchange,
          label: form.label || null,
          api_key: form.api_key.trim(),
          api_secret: form.api_secret.trim(),
          passphrase: form.passphrase.trim() || null,
        },
      });
      setForm({ ...form, label: "", api_key: "", api_secret: "", passphrase: "" });
      refresh();
    } catch (e: any) {
      setErr(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await api(`/vault/keys/${id}`, { method: "DELETE" });
    refresh();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="vault-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="vault-back">
          <Icon name="chevron-left" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>VAULT · AES-FERNET</Text>
          <Text style={styles.title}>API Keys</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
          <View style={styles.notice}>
            <Icon name="shield" size={16} color={colors.brandPrimary} />
            <Text style={styles.noticeText}>
              Only TRADING + QUERY permissions are ever used. Withdrawal permission must be disabled on the exchange side.
            </Text>
          </View>

          <Text style={styles.section}>Add key</Text>
          <View style={styles.card}>
            <Text style={styles.label}>EXCHANGE</Text>
            <View style={styles.exchangeRow}>
              {EXCHANGES.map((ex) => (
                <Pressable
                  key={ex}
                  style={[styles.exBtn, form.exchange === ex && styles.exBtnActive]}
                  onPress={() => setForm({ ...form, exchange: ex })}
                  testID={`exchange-${ex}`}
                >
                  <ExchangeBadge exchange={ex} />
                  <Text style={[styles.exBtnText, form.exchange === ex && { color: colors.onSurface }]}>{ex.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>

            <Field label="Label (optional)" value={form.label} onChangeText={(t) => setForm({ ...form, label: t })} placeholder="e.g. main-account" testID="input-label" />
            <Field label="API Key" value={form.api_key} onChangeText={(t) => setForm({ ...form, api_key: t })} placeholder="Paste API key" secureTextEntry testID="input-api-key" />
            <Field label="API Secret" value={form.api_secret} onChangeText={(t) => setForm({ ...form, api_secret: t })} placeholder="Paste API secret" secureTextEntry testID="input-api-secret" />
            {(form.exchange === "coinbase" || form.exchange === "kraken") && (
              <Field label="Passphrase (if required)" value={form.passphrase} onChangeText={(t) => setForm({ ...form, passphrase: t })} placeholder="Passphrase" secureTextEntry testID="input-passphrase" />
            )}
            {err && <Text style={styles.err} testID="vault-error">{err}</Text>}
            <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="save-key-btn">
              <Text style={styles.saveText}>{saving ? "Encrypting…" : "Encrypt & Save"}</Text>
            </Pressable>
          </View>

          <Text style={styles.section}>Connected exchanges</Text>
          {(!data || data.length === 0) && <Text style={styles.emptyLine}>No keys stored yet.</Text>}
          {(data || []).map((k) => (
            <View key={k.id} style={styles.keyRow} testID={`key-row-${k.id}`}>
              <ExchangeBadge exchange={k.exchange} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.keyLabel}>{k.label || k.exchange.toUpperCase()}</Text>
                <Text style={styles.keyMask}>{k.api_key_masked}</Text>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                  <Chip label="WITHDRAWAL DISABLED" tone="pos" />
                  <Chip label="ENCRYPTED" />
                </View>
              </View>
              <Pressable onPress={() => remove(k.id)} testID={`remove-key-${k.id}`}>
                <Icon name="trash-2" size={16} color={colors.error} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, testID, ...props }: any) {
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
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
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.brandTertiary, padding: spacing.md, borderRadius: radius.sm, marginBottom: spacing.lg },
  noticeText: { flex: 1, color: colors.onBrandTertiary, fontFamily: fonts.text, fontSize: 12, lineHeight: 18 },
  section: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 14, letterSpacing: 0.6, textTransform: "uppercase", marginTop: spacing.md, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  label: { fontFamily: fonts.text, color: colors.muted, fontSize: 10, letterSpacing: 0.8, marginBottom: 6 },
  exchangeRow: { flexDirection: "row", gap: spacing.sm },
  exBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary },
  exBtnActive: { borderColor: colors.brandPrimary },
  exBtnText: { fontFamily: fonts.textMedium, color: colors.muted, fontSize: 11 },
  input: { backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.onSurface, fontFamily: fonts.text, fontSize: 14 },
  saveBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center" },
  saveText: { fontFamily: fonts.displayBold, color: colors.onBrandPrimary, letterSpacing: 0.6, fontSize: 14 },
  err: { color: colors.error, fontFamily: fonts.textMedium, fontSize: 12, marginTop: spacing.sm },
  keyRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  keyLabel: { fontFamily: fonts.textMedium, color: colors.onSurface, fontSize: 13 },
  keyMask: { fontFamily: fonts.text, color: colors.muted, fontSize: 11, marginTop: 2 },
  emptyLine: { fontFamily: fonts.text, color: colors.muted, textAlign: "center", marginTop: spacing.md },
});
