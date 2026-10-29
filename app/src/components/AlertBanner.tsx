import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, useTheme } from '@/theme';
import { useAlerts } from '@/store/alerts';

export function AlertBanner() {
  const {
    activeAlert,
    activeTrafficAlert,
    dismissAlert,
    dismissTrafficAlert,
  } = useAlerts();
  const { colors, levelColor, trafficColor } = useTheme();
  const insets = useSafeAreaInsets();

  const isTraffic = activeTrafficAlert !== null;
  const message = isTraffic ? activeTrafficAlert.message : activeAlert?.message;
  if (!message) return null;

  const color = activeTrafficAlert
    ? trafficColor(activeTrafficAlert.incident.category)
    : activeAlert
      ? levelColor(activeAlert.hotspot.level)
      : colors.border;
  const title = isTraffic ? 'Alerta de trânsito' : 'Alerta de trecho de risco';
  const onDismiss = isTraffic ? dismissTrafficAlert : dismissAlert;

  return (
    <View style={[styles.wrapper, { top: insets.top + 8 }]} pointerEvents="box-none">
      <View style={[styles.banner, { backgroundColor: colors.surface, borderColor: color }]}>
        <View style={[styles.stripe, { backgroundColor: color }]} />
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.message, { color: colors.textMuted }]}>{message}</Text>
          {isTraffic ? (
            <Text style={[styles.attribution, { color: colors.textMuted }]}>
              Incidentes: © TomTom
            </Text>
          ) : null}
          <Pressable
            onPress={onDismiss}
            style={[styles.close, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Fechar alerta"
          >
            <Text style={[styles.closeText, { color: colors.text }]}>Fechar</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 1000,
    elevation: 12,
  },
  banner: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  stripe: {
    width: 6,
  },
  content: {
    flex: 1,
    padding: 12,
    gap: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
  },
  attribution: {
    fontSize: 10,
  },
  close: {
    alignSelf: 'flex-end',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
  },
  closeText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
