import { useRouter } from 'expo-router';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { formatDate, levelLabel } from '@/lib/format';
import { useAlerts } from '@/store/alerts';
import { useData } from '@/store/data';
import { useSettings, type AlertRadius } from '@/store/settings';
import { levelOrder, radius, useTheme } from '@/theme';
import type { Level } from '@/types/hotspots';

function OptionRow<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: T[];
  value: T;
  onChange: (value: T) => void;
  format: (value: T) => string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.options}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={String(option)}
            onPress={() => onChange(option)}
            style={[
              styles.option,
              {
                backgroundColor: active ? colors.primary : colors.surfaceAlt,
                borderColor: active ? colors.primary : colors.border,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[styles.optionText, { color: active ? colors.primaryText : colors.text }]}
            >
              {format(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { settings, updateSettings, resetSettings } = useSettings();
  const { document, source, refreshing, refresh, clearAndReload, updateConfigured, notice } =
    useData();
  const { alertIssue, notificationStatus, requestNotifications } = useAlerts();

  const setLevel = (level: Level) => updateSettings({ alertMinLevel: level });

  const toggleAlerts = async (enabled: boolean) => {
    updateSettings({ alertEnabled: enabled });
    if (enabled) await requestNotifications();
  };

  const onRefresh = async () => {
    await refresh();
  };

  const onClearCache = () => {
    Alert.alert(
      'Limpar cache',
      'Os dados baixados serão removidos e o app voltará ao conjunto embarcado. Deseja continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpar',
          style: 'destructive',
          onPress: () => {
            void clearAndReload();
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Alertas em primeiro plano</Text>
        <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>
          O app acompanha sua posição enquanto está aberto e avisa quando você se aproxima de um
          trecho de risco. Não funciona com o app fechado ou em segundo plano.
        </Text>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: colors.text }]}>Ativar alertas</Text>
          <Switch
            value={settings.alertEnabled}
            onValueChange={(value) => {
              void toggleAlerts(value);
            }}
            trackColor={{ false: colors.border, true: colors.primary }}
            accessibilityLabel="Ativar alertas"
          />
        </View>

        {alertIssue ? (
          <Text style={[styles.issue, { color: colors.warning }]}>{alertIssue}</Text>
        ) : null}
        {settings.alertEnabled ? (
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Notificações do sistema:{' '}
            {notificationStatus === 'granted'
              ? 'permitidas'
              : notificationStatus === 'unavailable'
                ? 'indisponíveis neste ambiente'
                : 'não permitidas'}
            . O banner no app continua funcionando
            {notificationStatus === 'granted'
              ? '.'
              : '; a notificação do sistema pode não aparecer.'}
          </Text>
        ) : null}

        <Text style={[styles.subsection, { color: colors.textMuted }]}>Raio de alerta</Text>
        <OptionRow<AlertRadius>
          options={[500, 1000, 2000]}
          value={settings.alertRadiusM}
          onChange={(value) => updateSettings({ alertRadiusM: value })}
          format={(value) => `${value / 1000} km`}
        />

        <Text style={[styles.subsection, { color: colors.textMuted }]}>Nível mínimo</Text>
        <OptionRow<Level>
          options={levelOrder}
          value={settings.alertMinLevel}
          onChange={setLevel}
          format={levelLabel}
        />

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Voz</Text>
            <Text style={[styles.rowHint, { color: colors.textMuted }]}>
              Falar o alerta em português do Brasil
            </Text>
          </View>
          <Switch
            value={settings.voiceEnabled}
            onValueChange={(value) => updateSettings({ voiceEnabled: value })}
            trackColor={{ false: colors.border, true: colors.primary }}
            accessibilityLabel="Alerta por voz"
          />
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Dados</Text>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Versão dos dados</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>{document.meta.data_version}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Gerado em</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {formatDate(document.meta.generated_at)}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Fonte</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {document.meta.fonte === 'prf' ? 'PRF (dados abertos)' : 'Demonstração (sintética)'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Hotspots</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {document.meta.total_hotspots} · {document.meta.total_acidentes_considerados} acidentes
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Origem atual</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {source === 'cache' ? 'Cache do aparelho' : 'Seed embarcado'}
          </Text>
        </View>

        <Pressable
          onPress={onRefresh}
          disabled={refreshing}
          style={[
            styles.button,
            { backgroundColor: colors.primary, opacity: refreshing ? 0.6 : 1 },
          ]}
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, { color: colors.primaryText }]}>
            {refreshing ? 'Atualizando…' : 'Atualizar dados agora'}
          </Text>
        </Pressable>
        {!updateConfigured ? (
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Atualização remota não configurada. Defina EXPO_PUBLIC_DATA_URL para baixar novas
            versões.
          </Text>
        ) : null}
        {notice ? (
          <Text style={[styles.hint, { color: colors.primary }]}>{notice}</Text>
        ) : null}

        <Pressable
          onPress={onClearCache}
          style={[styles.buttonOutline, { borderColor: colors.border }]}
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>Limpar cache</Text>
        </Pressable>
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable
          onPress={() => router.push('/about')}
          style={styles.row}
          accessibilityRole="button"
        >
          <Text style={[styles.rowLabel, { color: colors.text }]}>Sobre o RiskRadar</Text>
          <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
        </Pressable>
        <Pressable
          onPress={resetSettings}
          style={styles.row}
          accessibilityRole="button"
        >
          <Text style={[styles.rowLabel, { color: colors.danger }]}>Restaurar configurações padrão</Text>
        </Pressable>
      </View>

      <Text style={[styles.footer, { color: colors.textMuted }]}>
        Informação baseada em dados históricos. Não use o celular enquanto dirige.
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
  section: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  sectionDescription: {
    fontSize: 13,
    lineHeight: 19,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  rowHint: {
    fontSize: 12,
  },
  subsection: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  options: {
    flexDirection: 'row',
    gap: 8,
  },
  option: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 8,
    alignItems: 'center',
  },
  optionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
  },
  issue: {
    fontSize: 12,
    fontWeight: '600',
  },
  infoRow: {
    gap: 2,
  },
  infoLabel: {
    fontSize: 12,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  button: {
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonOutline: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 11,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  chevron: {
    fontSize: 24,
    lineHeight: 24,
  },
  footer: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
});
