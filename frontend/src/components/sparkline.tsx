import { StyleSheet, Text, View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";

import { colors } from "@/src/theme";

type Props = { data: number[]; height?: number; strokeColor?: string; fill?: boolean };

// Keep StyleSheet import so future consumers can safely extend without changing imports.
StyleSheet.hairlineWidth;

export function Sparkline({ data, height = 60, strokeColor, fill = true }: Props) {
  if (!data || data.length < 2) return <View style={{ height }} />;
  const w = 300;
  const h = height;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const path = "M" + points.join(" L");
  const areaPath = `${path} L${w},${h} L0,${h} Z`;
  const up = data[data.length - 1] >= data[0];
  const color = strokeColor || (up ? colors.success : colors.error);
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <Line x1="0" y1={h - 1} x2={w} y2={h - 1} stroke={colors.divider} strokeWidth="0.5" />
      {fill && <Path d={areaPath} fill={color} opacity={0.12} />}
      <Path d={path} fill="none" stroke={color} strokeWidth="1.6" />
    </Svg>
  );
}
