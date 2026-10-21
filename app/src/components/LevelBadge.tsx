import { StyleSheet, Text, View } from 'react-native';

import { levelLabel } from '@/lib/format';
import { radius, useTheme } from '@/theme';
import type { Level } from '@/types/hotspots';

export function LevelBadge({ level, small = false }: { level: Level; small?: boolean }) {
  const { levelColor } = useTheme();
  const color = levelColor(level);
  return (
    <View
      style={[
        styles.badge,
        small && styles.small,
        { backgroundColor: color, borderColor: color },
      ]}
      accessibilityLabel={`Nível ${levelLabel(level)}`}
    >
      <Text style={[styles.text, small && styles.smallText]}>{levelLabel(level)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  small: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  smallText: {
    fontSize: 10,
  },
});
