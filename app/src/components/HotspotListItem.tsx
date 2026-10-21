import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LevelBadge } from '@/components/LevelBadge';
import { formatDistance, formatKmRange } from '@/lib/format';
import { radius, useTheme } from '@/theme';
import type { Hotspot } from '@/types/hotspots';

interface Props {
  hotspot: Hotspot;
  distanceM?: number;
  onPress: () => void;
}

export function HotspotListItem({ hotspot, distanceM, onPress }: Props) {
  const { colors, levelColor } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`BR-${hotspot.br}, ${hotspot.municipio}, nível ${hotspot.level}`}
    >
      <View style={[styles.stripe, { backgroundColor: levelColor(hotspot.level) }]} />
      <View style={styles.body}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            BR-{hotspot.br}/{hotspot.uf} · {hotspot.municipio || '—'}
          </Text>
          <LevelBadge level={hotspot.level} small />
        </View>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {formatKmRange(hotspot)} · {hotspot.n_acidentes} acidentes · score {hotspot.score}
        </Text>
        <View style={styles.footer}>
          <Text style={[styles.meta, { color: colors.textMuted }]}>
            {hotspot.mortos} mortos · {hotspot.feridos_graves} feridos graves
          </Text>
          {distanceM !== undefined ? (
            <Text style={[styles.distance, { color: colors.primary }]}>
              {formatDistance(distanceM)}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  stripe: {
    width: 5,
  },
  body: {
    flex: 1,
    padding: 12,
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  meta: {
    fontSize: 12,
    flex: 1,
  },
  distance: {
    fontSize: 13,
    fontWeight: '800',
  },
});
