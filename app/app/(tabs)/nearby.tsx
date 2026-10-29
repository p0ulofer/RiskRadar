import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { HotspotListItem } from '@/components/HotspotListItem';
import { formatDistance, formatRelativeTime } from '@/lib/format';
import { haversineMeters } from '@/lib/geo';
import { categoryLabel, pointInBounds, roadLabel, TOMTOM_COVERAGE_BOUNDS } from '@/lib/tomtom';
import { useData } from '@/store/data';
import { useTraffic } from '@/store/traffic';
import { radius, useTheme } from '@/theme';
import type { GeoPoint, NearbyHotspot } from '@/types/hotspots';
import type { TrafficIncident } from '@/types/traffic';

type PermissionState = 'checking' | 'undetermined' | 'granted' | 'denied';

function IncidentRow({
  incident,
  distanceM,
  onPress,
}: {
  incident: TrafficIncident;
  distanceM: number;
  onPress: () => void;
}) {
  const { colors, trafficColor } = useTheme();
  const where = [incident.from, incident.to].filter(Boolean).join(' → ');
  const description = incident.descriptions.join(' · ');
  const primary = description || where || 'Local não informado';
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.incidentRow,
        { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Ver ${categoryLabel(incident.category)} no mapa`}
    >
      <View
        style={[styles.incidentDot, { backgroundColor: trafficColor(incident.category) }]}
      />
      <View style={styles.incidentText}>
        <Text style={[styles.incidentTitle, { color: colors.text }]} numberOfLines={1}>
          {categoryLabel(incident.category)}
          {incident.roadNumbers[0] ? ` · ${roadLabel(incident.roadNumbers[0])}` : ''}
        </Text>
        <Text style={[styles.incidentSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
          {primary}
        </Text>
        {description && where ? (
          <Text style={[styles.incidentLocation, { color: colors.textMuted }]} numberOfLines={1}>
            {where}
          </Text>
        ) : null}
      </View>
      <View style={styles.incidentRight}>
        <Text style={[styles.incidentDistance, { color: colors.primary }]}>
          {formatDistance(distanceM)}
        </Text>
        {incident.lastReportTime ? (
          <Text style={[styles.incidentTime, { color: colors.textMuted }]}>
            {formatRelativeTime(incident.lastReportTime)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function NearbyScreen() {
  const { colors } = useTheme();
  const { index, ready } = useData();
  const router = useRouter();
  const {
    nearbyIncidents,
    configured: trafficConfigured,
    enabled: trafficEnabled,
    error: trafficError,
    loading: trafficLoading,
    outsideCoverage: trafficOutsideCoverage,
    refreshNearby,
    updatedAt: trafficUpdatedAt,
  } = useTraffic();

  const [permission, setPermission] = useState<PermissionState>('checking');
  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [position, setPosition] = useState<GeoPoint | null>(null);
  const [nearby, setNearby] = useState<NearbyHotspot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trafficItems = useMemo(() => {
    if (!position) return [];
    return nearbyIncidents
      .map((incident) => ({
        incident,
        distanceM: haversineMeters(position, {
          latitude: incident.lat,
          longitude: incident.lng,
        }),
      }))
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 10);
  }, [nearbyIncidents, position]);

  const loadPosition = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      setGpsEnabled(servicesEnabled);
      if (!servicesEnabled) {
        setError('O GPS está desligado. Ative a localização do aparelho.');
        return;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const point = {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      };
      setPosition(point);
      setNearby(index.nearestHotspots(point, 20));
      void refreshNearby(point);
    } catch {
      setError('Não foi possível obter sua posição agora.');
    } finally {
      setLoading(false);
    }
  }, [index, refreshNearby]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (cancelled) return;
      if (current?.granted) {
        setPermission('granted');
        await loadPosition();
      } else if (current?.status === 'denied') {
        setPermission('denied');
      } else {
        setPermission('undetermined');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPosition]);

  const requestPermission = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const requested = await Location.requestForegroundPermissionsAsync();
      if (requested.granted) {
        setPermission('granted');
        await loadPosition();
      } else {
        setPermission('denied');
      }
    } catch {
      setPermission('denied');
    } finally {
      setLoading(false);
    }
  }, [loadPosition]);

  if (!ready || permission === 'checking') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (permission !== 'granted') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <View
          style={[styles.permissionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.title, { color: colors.text }]}>Trechos de risco perto de você</Text>
          <Text style={[styles.body, { color: colors.textMuted }]}>
            O RiskRadar precisa da sua localização para calcular a distância até os trechos com mais
            acidentes. A posição é usada no aparelho; para os acidentes em tempo real, apenas a área
            consultada é enviada ao TomTom.
          </Text>
          <Text style={[styles.body, { color: colors.textMuted }]}>
            Os alertas em primeiro plano também usam a localização enquanto o app está aberto.
          </Text>
          {permission === 'denied' ? (
            <Text style={[styles.warning, { color: colors.warning }]}>
              Permissão negada. Você pode liberar o acesso nas configurações do sistema.
            </Text>
          ) : null}
          <Pressable
            onPress={requestPermission}
            disabled={loading}
            style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: loading ? 0.6 : 1 }]}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
                {permission === 'denied' ? 'Tentar novamente' : 'Permitir localização'}
              </Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => Linking.openSettings()}
            style={[styles.secondaryButton, { borderColor: colors.border }]}
            accessibilityRole="button"
          >
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
              Abrir ajustes do sistema
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={nearby}
        keyExtractor={(item) => item.hotspot.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.trafficSection}>
              <View style={styles.trafficHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Acidentes agora</Text>
                {trafficUpdatedAt ? (
                  <Text style={[styles.trafficUpdated, { color: colors.textMuted }]}>
                    atualizado {formatRelativeTime(trafficUpdatedAt)}
                  </Text>
                ) : null}
              </View>

              {!trafficConfigured ? (
                <>
                  <Text style={[styles.body, { color: colors.textMuted }]}>
                    Os acidentes em tempo real usam o TomTom. Falta configurar a chave da API.
                  </Text>
                  <Pressable
                    onPress={() => router.navigate('/(tabs)/settings')}
                    style={[styles.primaryButtonSmall, { backgroundColor: colors.primary }]}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
                      Configurar agora
                    </Text>
                  </Pressable>
                </>
              ) : !trafficEnabled ? (
                <Text style={[styles.body, { color: colors.textMuted }]}>
                  Camada de acidentes desligada. Ative em Configurações para ver os incidentes.
                </Text>
              ) : trafficError ? (
                <Text style={[styles.warning, { color: colors.warning }]}>{trafficError}</Text>
              ) : trafficOutsideCoverage ? (
                <Text style={[styles.body, { color: colors.textMuted }]}>
                  As consultas do TomTom estão limitadas ao Nordeste para economizar a cota do
                  plano gratuito. Volte para a região para ver os acidentes em tempo real.
                </Text>
              ) : trafficLoading && trafficItems.length === 0 ? (
                <ActivityIndicator style={styles.trafficLoader} color={colors.primary} />
              ) : trafficItems.length === 0 ? (
                <Text style={[styles.body, { color: colors.textMuted }]}>
                  {position
                    ? 'Nenhum acidente ou interdição reportado num raio de 30 km agora.'
                    : 'Aguardando sua posição…'}
                </Text>
              ) : (
                <View style={styles.incidentList}>
                  {trafficItems.map((item) => (
                    <IncidentRow
                      key={item.incident.id}
                      incident={item.incident}
                      distanceM={item.distanceM}
                      onPress={() =>
                        router.navigate({
                          pathname: '/',
                          params: {
                            incidentId: item.incident.id,
                            focusAt: String(Date.now()),
                          },
                        })
                      }
                    />
                  ))}
                </View>
              )}

              <Text style={[styles.attribution, { color: colors.textMuted }]}>
                Incidentes: © TomTom · raio de 30 km
              </Text>
            </View>

            <Text style={[styles.title, { color: colors.text }]}>Mais próximos de você</Text>
            <Text style={[styles.body, { color: colors.textMuted }]}>
              {position
                ? `20 trechos ordenados por distância a partir da sua posição atual.`
                : 'Aguardando sua posição…'}
            </Text>
            {!gpsEnabled ? (
              <Text style={[styles.warning, { color: colors.warning }]}>
                GPS desligado. Ative a localização para calcular as distâncias.
              </Text>
            ) : null}
            {error ? <Text style={[styles.warning, { color: colors.warning }]}>{error}</Text> : null}
            <View style={styles.headerActions}>
              <Pressable
                onPress={loadPosition}
                disabled={loading}
                style={[styles.primaryButtonSmall, { backgroundColor: colors.primary }]}
                accessibilityRole="button"
              >
                <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
                  {loading ? 'Atualizando…' : 'Atualizar posição'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => Linking.openSettings()}
                style={[styles.secondaryButtonSmall, { borderColor: colors.border }]}
                accessibilityRole="button"
              >
                <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Ajustes</Text>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loader} color={colors.primary} />
          ) : (
            <Text style={[styles.body, { color: colors.textMuted }]}>
              Nenhum hotspot encontrado.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <HotspotListItem
            hotspot={item.hotspot}
            distanceM={item.distanceM}
            onPress={() => router.push(`/hotspot/${item.hotspot.id}`)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  permissionCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 18,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  warning: {
    fontSize: 13,
    fontWeight: '600',
  },
  list: {
    padding: 16,
    gap: 10,
    paddingBottom: 32,
  },
  header: {
    gap: 8,
    marginBottom: 8,
  },
  trafficSection: {
    gap: 8,
    marginBottom: 12,
  },
  trafficHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  trafficUpdated: {
    fontSize: 11,
  },
  trafficLoader: {
    marginVertical: 12,
  },
  incidentList: {
    gap: 8,
  },
  incidentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 10,
  },
  incidentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  incidentText: {
    flex: 1,
    gap: 2,
  },
  incidentTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  incidentSubtitle: {
    fontSize: 12,
  },
  incidentLocation: {
    fontSize: 11,
  },
  incidentRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  incidentDistance: {
    fontSize: 13,
    fontWeight: '700',
  },
  incidentTime: {
    fontSize: 11,
  },
  attribution: {
    fontSize: 10,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  primaryButton: {
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonSmall: {
    borderRadius: radius.pill,
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryButtonSmall: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  separator: {
    height: 10,
  },
  loader: {
    marginTop: 24,
  },
});
