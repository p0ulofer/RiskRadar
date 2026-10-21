import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

export function DemoBanner() {
  const { colors } = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: colors.warning }]}>
      <Text style={styles.text}>Dados de demonstração — gerados sinteticamente</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  text: {
    color: '#1B1200',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
});
