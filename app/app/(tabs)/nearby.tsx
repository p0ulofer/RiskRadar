import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
import { useData } from '@/store/data';
import { radius, useTheme } from '@/theme';
import type { GeoPoint, NearbyHotspot } from '@/types/hotspots';

type PermissionState = 'checking' | 'undetermined' | 'granted' | 'denied';

export default function NearbyScreen() {
  const { colors } = useTheme();
  const { index, ready } = useData();
  const router = useRouter();

  const [permission, setPermission] = useState<PermissionState>('checking');
  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [position, setPosition] = useState<GeoPoint | null>(null);
  const [nearby, setNearby] = useState<NearbyHotspot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch {
      setError('Não foi possível obter sua posição agora.');
    } finally {
      setLoading(false);
    }
  }, [index]);

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
            acidentes. A posição é usada apenas no aparelho e não é enviada para servidores.
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
