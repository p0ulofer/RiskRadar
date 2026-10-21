import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { levelLabel } from '@/lib/format';
import { levelOrder, radius, useTheme } from '@/theme';
import type { HotspotFilters } from '@/store/settings';
import type { Level } from '@/types/hotspots';

interface Props {
  visible: boolean;
  onClose: () => void;
  filters: HotspotFilters;
  onChange: (patch: Partial<HotspotFilters>) => void;
  ufs: string[];
  brs: number[];
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.primary : colors.surfaceAlt,
          borderColor: active ? colors.primary : colors.border,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, { color: active ? colors.primaryText : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function FilterModal({ visible, onClose, filters, onChange, ufs, brs }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropPress} onPress={onClose} accessibilityLabel="Fechar filtros" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Filtros do mapa</Text>
            <Pressable onPress={onClose} accessibilityRole="button">
              <Text style={[styles.done, { color: colors.primary }]}>Concluir</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={[styles.section, { color: colors.textMuted }]}>Unidade da federação</Text>
            <View style={styles.chips}>
              <Chip label="Todas" active={filters.uf === null} onPress={() => onChange({ uf: null })} />
              {ufs.map((uf) => (
                <Chip
                  key={uf}
                  label={uf}
                  active={filters.uf === uf}
                  onPress={() => onChange({ uf })}
                />
              ))}
            </View>

            <Text style={[styles.section, { color: colors.textMuted }]}>Rodovia (BR)</Text>
            <View style={styles.chips}>
              <Chip
                label="Todas"
                active={filters.br === null}
                onPress={() => onChange({ br: null })}
              />
              {brs.map((br) => (
                <Chip
                  key={br}
                  label={`BR-${br}`}
                  active={filters.br === br}
                  onPress={() => onChange({ br })}
                />
              ))}
            </View>

            <Text style={[styles.section, { color: colors.textMuted }]}>Nível mínimo</Text>
            <View style={styles.chips}>
              {levelOrder.map((level: Level) => (
                <Chip
                  key={level}
                  label={levelLabel(level)}
                  active={filters.minLevel === level}
                  onPress={() => onChange({ minLevel: level })}
                />
              ))}
            </View>

            <Pressable
              onPress={() => onChange({ uf: null, br: null, minLevel: 'baixo' })}
              style={[styles.clear, { borderColor: colors.border }]}
              accessibilityRole="button"
            >
              <Text style={[styles.clearText, { color: colors.text }]}>Limpar filtros</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  backdropPress: {
    flex: 1,
  },
  sheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
  },
  done: {
    fontSize: 15,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  section: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 10,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  clear: {
    marginTop: 18,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 11,
    alignItems: 'center',
  },
  clearText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
