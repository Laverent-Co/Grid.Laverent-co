import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, fonts, radius, spacing } from "@/src/theme";

type Props = {
  value: string;
  length: number;
  onChange: (v: string) => void;
  onSubmit?: (v: string) => void;
  error?: boolean;
};

export function PinPad({ value, length, onChange, onSubmit, error }: Props) {
  const press = (digit: string) => {
    Haptics.selectionAsync().catch(() => {});
    if (digit === "del") {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length >= length) return;
    const next = value + digit;
    onChange(next);
    if (next.length === length && onSubmit) {
      // Slight defer so the user sees the last dot fill.
      setTimeout(() => onSubmit(next), 60);
    }
  };

  const keys: (string | "del")[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  return (
    <View style={styles.wrap} testID="pin-pad">
      <View style={styles.dots}>
        {Array.from({ length }).map((_, i) => {
          const filled = i < value.length;
          return (
            <View
              key={i}
              style={[
                styles.dot,
                filled && styles.dotFilled,
                error && styles.dotError,
              ]}
            />
          );
        })}
      </View>
      <View style={styles.grid}>
        {keys.map((k, idx) => {
          if (k === "") return <View key={idx} style={styles.keySpacer} />;
          const label = k === "del" ? "⌫" : k;
          return (
            <Pressable
              key={idx}
              style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
              onPress={() => press(k)}
              testID={`pin-key-${k}`}
            >
              <Text style={[styles.keyLabel, k === "del" && { color: colors.muted, fontSize: 22 }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const KEY = 76;
const styles = StyleSheet.create({
  wrap: { alignItems: "center", width: "100%" },
  dots: { flexDirection: "row", gap: 14, marginBottom: spacing["2xl"] },
  dot: {
    width: 16,
    height: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  dotFilled: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  dotError: { borderColor: colors.error, backgroundColor: colors.error },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    width: KEY * 3 + 32,
    gap: 12,
  },
  key: {
    width: KEY,
    height: KEY,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  keyPressed: { backgroundColor: colors.surfaceTertiary, borderColor: colors.brandPrimary },
  keySpacer: { width: KEY, height: KEY },
  keyLabel: { color: colors.onSurface, fontFamily: fonts.displayBold, fontSize: 26 },
});
