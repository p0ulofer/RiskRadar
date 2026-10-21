import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

interface BarItem {
  label: string;
  value: number;
}

interface Props {
  title: string;
  items: BarItem[];
  color?: string;
  emptyLabel?: string;
}

export function BarList({ title, items, color, emptyLabel = 'Sem dados' }: Props) {
  const { colors } = useTheme();
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {items.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textMuted }]}>{emptyLabel}</Text>
      ) : (
        items.map((item) => (
          <View key={item.label} style={styles.row}>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: colors.text }]} numberOfLines={2}>
                {item.label}
              </Text>
              <Text style={[styles.value, { color: colors.textMuted }]}>{item.value}</Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
              <View
                style={[
                  styles.fill,
                  {
                    backgroundColor: color ?? colors.primary,
                    width: `${Math.max(4, (item.value / max) * 100)}%`,
                  },
                ]}
              />
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  row: {
    gap: 4,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  label: {
    flex: 1,
    fontSize: 13,
  },
  value: {
    fontSize: 13,
    fontWeight: '700',
  },
  track: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 7,
    borderRadius: 4,
  },
  empty: {
    fontSize: 13,
  },
});
