import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BarList } from '@/components/BarList';
import { LevelBadge } from '@/components/LevelBadge';
import { StatGrid } from '@/components/StatGrid';
import {
  faseDiaOrdered,
  formatDate,
  formatKmRange,
  levelLabel,
  porAnoOrdered,
} from '@/lib/format';
import { useData } from '@/store/data';
import { radius, useTheme } from '@/theme';
import type { Hotspot } from '@/types/hotspots';

export default function HotspotDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, levelColor } = useTheme();
  const { document, ready } = useData();

  const hotspot: Hotspot | undefined = useMemo(
    () => document.hotspots.find((item) => item.id === id),
    [document.hotspots, id]
  );

  if (!ready) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textMuted }}>Carregando…</Text>
      </View>
    );
  }

  if (!hotspot) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.notFoundTitle, { color: colors.text }]}>Hotspot não encontrado</Text>
        <Text style={{ color: colors.textMuted, textAlign: 'center' }}>
          Os dados podem ter sido atualizados. Volte ao mapa para escolher outro trecho.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={[styles.button, { backgroundColor: colors.primary }]}
        >
          <Text style={{ color: colors.primaryText, fontWeight: '700' }}>Voltar</Text>
        </Pressable>
      </View>
    );
  }

  const accent = levelColor(hotspot.level);
  const cut = document.meta.cortes_nivel;

  const openInMaps = async () => {
    const coords = `${hotspot.lat},${hotspot.lng}`;
    const label = encodeURIComponent(`BR-${hotspot.br} ${hotspot.municipio}`);
    const nativeUrl =
      Platform.OS === 'ios'
        ? `maps:0,0?q=${label}@${coords}`
        : `geo:${coords}?q=${coords}(${label})`;
    const webUrl = `https://www.google.com/maps/search/?api=1&query=${coords}`;
    try {
      const supported = await Linking.canOpenURL(nativeUrl);
      await Linking.openURL(supported ? nativeUrl : webUrl);
    } catch {
      await Linking.openURL(webUrl);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.heroHeader}>
          <Text style={[styles.title, { color: colors.text }]}>
            BR-{hotspot.br}/{hotspot.uf} · {hotspot.municipio || '—'} · {formatKmRange(hotspot)}
          </Text>
          <LevelBadge level={hotspot.level} />
        </View>
        <View style={styles.scoreRow}>
          <Text style={[styles.score, { color: accent }]}>{hotspot.score}</Text>
          <View style={styles.scoreText}>
            <Text style={[styles.scoreLabel, { color: colors.text }]}>score de severidade</Text>
            <Text style={[styles.scoreHint, { color: colors.textMuted }]}>
              {hotspot.n_acidentes} acidentes agrupados num raio de {hotspot.radius_m} m
            </Text>
          </View>
        </View>
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          Nível {levelLabel(hotspot.level).toLowerCase()} · cortes: médio {cut.medio}, alto{' '}
          {cut.alto}, crítico {cut.critico} · dados de {formatDate(document.meta.generated_at)}
        </Text>
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Vítimas e acidentes</Text>
        <StatGrid
          stats={[
            { label: 'Acidentes', value: hotspot.n_acidentes },
            { label: 'Mortos', value: hotspot.mortos, accent: colors.danger },
            { label: 'Feridos graves', value: hotspot.feridos_graves, accent: colors.warning },
            { label: 'Feridos leves', value: hotspot.feridos_leves },
            { label: 'Ilesos', value: hotspot.ilesos },
            { label: 'Km do trecho', value: `${hotspot.km_min}–${hotspot.km_max}` },
          ]}
        />
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <BarList
          title="Principais causas"
          items={hotspot.top_causas.map((item) => ({ label: item.nome, value: item.n }))}
          color={colors.primary}
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <BarList
          title="Principais tipos de acidente"
          items={hotspot.top_tipos.map((item) => ({ label: item.nome, value: item.n }))}
          color={accent}
        />
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <BarList
          title="Distribuição por fase do dia"
          items={faseDiaOrdered(hotspot.fase_dia)}
          color={colors.warning}
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <BarList
          title="Acidentes por ano"
          items={porAnoOrdered(hotspot.por_ano)}
          color={colors.success}
        />
      </View>

      {hotspot.infra ? (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Infraestrutura no entorno (OpenStreetMap)
          </Text>
          <StatGrid
            stats={[
              { label: 'Semáforos', value: hotspot.infra.traffic_signals },
              { label: 'Faixas de pedestre', value: hotspot.infra.crossing },
              { label: 'Redutores de velocidade', value: hotspot.infra.traffic_calming },
              { label: 'Câmeras de velocidade', value: hotspot.infra.speed_camera },
            ]}
          />
        </View>
      ) : null}

      <Pressable
        onPress={() => {
          void openInMaps();
        }}
        style={[styles.button, { backgroundColor: colors.primary }]}
        accessibilityRole="button"
      >
        <Text style={[styles.buttonText, { color: colors.primaryText }]}>
          Abrir no app de mapas
        </Text>
      </Pressable>

      <Pressable
        onPress={() => router.push('/about')}
        style={[styles.buttonOutline, { borderColor: colors.border }]}
        accessibilityRole="button"
      >
        <Text style={[styles.buttonText, { color: colors.text }]}>Como o score é calculado</Text>
      </Pressable>

      <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
        Informação baseada em dados históricos; não substitui a atenção ao dirigir nem a sinalização
        da via. Não use o celular enquanto dirige.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  notFoundTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  hero: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    gap: 10,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  score: {
    fontSize: 40,
    fontWeight: '900',
  },
  scoreText: {
    flex: 1,
    gap: 2,
  },
  scoreLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  scoreHint: {
    fontSize: 12,
  },
  meta: {
    fontSize: 11,
    lineHeight: 16,
  },
  section: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    marginVertical: 4,
  },
  button: {
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonOutline: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  disclaimer: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
