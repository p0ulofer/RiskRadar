import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DemoBanner } from '@/components/DemoBanner';
import { FilterModal } from '@/components/FilterModal';
import { LeafletMap } from '@/components/LeafletMap';
import { LevelBadge } from '@/components/LevelBadge';
import { formatKmRange, levelLabel } from '@/lib/format';
import { HotspotIndex, filterHotspots } from '@/lib/geo';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { levelOrder, radius, useTheme } from '@/theme';
import type { GeoRegion, Hotspot } from '@/types/hotspots';

const NORTHEAST_REGION: GeoRegion = {
  latitude: -8.6,
  longitude: -37.6,
  latitudeDelta: 16,
  longitudeDelta: 16,
};

const MAX_MARKERS = 150;

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, levelColor } = useTheme();
  const { document, ready } = useData();
  const { settings, updateFilters } = useSettings();

  const [userRegion, setUserRegion] = useState<GeoRegion | null>(null);
  const [region, setRegion] = useState<GeoRegion>(NORTHEAST_REGION);
  const [selected, setSelected] = useState<Hotspot | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted || cancelled) return;
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        const next: GeoRegion = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        };
        setUserRegion(next);
        setRegion(next);
      } catch {
        // Mantém o mapa centrado no Nordeste.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () => filterHotspots(document.hotspots, settings.filters),
    [document.hotspots, settings.filters]
  );
  const index = useMemo(() => new HotspotIndex(filtered), [filtered]);

  const zoomedOut = region.latitudeDelta > 6;
  const visible = useMemo(() => {
    const items = index.hotspotsInRegion(region, MAX_MARKERS);
    if (!zoomedOut) return items;
    return items.filter((hotspot) => hotspot.level === 'alto' || hotspot.level === 'critico');
  }, [index, region, zoomedOut]);

  const availableUfs = useMemo(
    () => [...new Set(document.hotspots.map((hotspot) => hotspot.uf))].sort(),
    [document.hotspots]
  );
  const availableBrs = useMemo(
    () => [...new Set(document.hotspots.map((hotspot) => hotspot.br))].sort((a, b) => a - b),
    [document.hotspots]
  );

  const filterSummary = [
    settings.filters.uf ?? 'Todas as UFs',
    settings.filters.br ? `BR-${settings.filters.br}` : 'Todas as BRs',
    `nível ${levelLabel(settings.filters.minLevel).toLowerCase()}+`,
  ].join(' · ');

  if (!ready) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textMuted }]}>Carregando hotspots…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {document.meta.fonte === 'sintetico' ? <DemoBanner /> : null}
      <View style={styles.mapWrapper}>
        <LeafletMap
          hotspots={visible}
          selected={selected}
          focus={userRegion}
          colorForLevel={levelColor}
          backgroundColor={colors.background}
          onSelect={setSelected}
          onRegionChange={setRegion}
        />

        <View
          style={[
            styles.topBar,
            {
              top: insets.top + 8,
              backgroundColor: colors.mapOverlay,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.topBarText}>
            <Text style={[styles.topBarTitle, { color: colors.text }]}>
              {visible.length} trechos no mapa
            </Text>
            <Text style={[styles.topBarSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
              {filterSummary}
            </Text>
          </View>
          <Pressable
            onPress={() => setFilterOpen(true)}
            style={[styles.filterButton, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Abrir filtros"
          >
            <Text style={[styles.filterButtonText, { color: colors.primaryText }]}>Filtros</Text>
          </Pressable>
        </View>

        <View
          style={[
            styles.legend,
            {
              top: insets.top + 78,
              backgroundColor: colors.mapOverlay,
              borderColor: colors.border,
            },
          ]}
        >
          {levelOrder.map((level) => (
            <View key={level} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: levelColor(level) }]} />
              <Text style={[styles.legendText, { color: colors.textMuted }]}>
                {levelLabel(level)}
              </Text>
            </View>
          ))}
        </View>

        {visible.length === 0 ? (
          <View
            style={[
              styles.empty,
              { backgroundColor: colors.mapOverlay, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.emptyText, { color: colors.text }]}>
              Nenhum hotspot nesta área. Afaste o mapa ou ajuste os filtros.
            </Text>
          </View>
        ) : null}

        {selected ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                marginBottom: 12,
              },
            ]}
          >
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
                BR-{selected.br}/{selected.uf} · {selected.municipio || '—'}
              </Text>
              <LevelBadge level={selected.level} />
            </View>
            <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
              {formatKmRange(selected)} · {selected.n_acidentes} acidentes · score {selected.score}
            </Text>
            <Text style={[styles.cardStats, { color: colors.textMuted }]}>
              {selected.mortos} mortos · {selected.feridos_graves} feridos graves ·{' '}
              {selected.feridos_leves} feridos leves
            </Text>
            <View style={styles.cardActions}>
              <Pressable
                onPress={() => {
                  setSelected(null);
                }}
                style={[styles.secondaryButton, { borderColor: colors.border }]}
                accessibilityRole="button"
              >
                <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Fechar</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push(`/hotspot/${selected.id}`)}
                style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                accessibilityRole="button"
              >
                <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
                  Ver detalhes
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      <FilterModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={settings.filters}
        onChange={updateFilters}
        ufs={availableUfs}
        brs={availableBrs}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapWrapper: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  topBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topBarText: {
    flex: 1,
    gap: 2,
  },
  topBarTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  topBarSubtitle: {
    fontSize: 12,
  },
  filterButton: {
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  legend: {
    position: 'absolute',
    left: 12,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 8,
    gap: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '600',
  },
  empty: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 32,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 14,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
  },
  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
  },
  cardSubtitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  cardStats: {
    fontSize: 12,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 6,
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  primaryButton: {
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  primaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
