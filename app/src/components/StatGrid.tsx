import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

interface Stat {
  label: string;
  value: number | string;
  accent?: string;
}

export function StatGrid({ stats }: { stats: Stat[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.grid}>
      {stats.map((stat) => (
        <View
          key={stat.label}
          style={[styles.cell, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
        >
          <Text style={[styles.value, { color: stat.accent ?? colors.text }]}>{stat.value}</Text>
          <Text style={[styles.label, { color: colors.textMuted }]}>{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cell: {
    flexGrow: 1,
    flexBasis: '45%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  value: {
    fontSize: 22,
    fontWeight: '800',
  },
  label: {
    fontSize: 12,
  },
});
