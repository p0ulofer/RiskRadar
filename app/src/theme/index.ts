import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import type { Level } from '@/types/hotspots';
import type { TrafficCategory } from '@/types/traffic';

export const trafficColors: Record<TrafficCategory, { light: string; dark: string }> = {
  accident: { light: '#C62828', dark: '#EF5350' },
  roadClosed: { light: '#E65100', dark: '#FFA726' },
  jam: { light: '#F9A825', dark: '#FFD54F' },
  roadWorks: { light: '#6D4C41', dark: '#BCAAA4' },
  brokenDownVehicle: { light: '#546E7A', dark: '#90A4AE' },
  dangerousConditions: { light: '#6A1B9A', dark: '#BA68C8' },
  other: { light: '#455A64', dark: '#90A4AE' },
};

export const levelColors: Record<Level, { light: string; dark: string }> = {
  baixo: { light: '#2E7D32', dark: '#66BB6A' },
  medio: { light: '#F9A825', dark: '#FFD54F' },
  alto: { light: '#EF6C00', dark: '#FFA726' },
  critico: { light: '#C62828', dark: '#EF5350' },
};

export const levelLabels: Record<Level, string> = {
  baixo: 'Baixo',
  medio: 'Médio',
  alto: 'Alto',
  critico: 'Crítico',
};

export const levelOrder: Level[] = ['baixo', 'medio', 'alto', 'critico'];

export const palette = {
  light: {
    background: '#F5F7FA',
    surface: '#FFFFFF',
    surfaceAlt: '#EDF1F6',
    text: '#15212B',
    textMuted: '#5B6B7A',
    border: '#D7DFE7',
    primary: '#0B5D8C',
    primaryText: '#FFFFFF',
    danger: '#C62828',
    warning: '#B26A00',
    success: '#2E7D32',
    mapOverlay: 'rgba(255,255,255,0.94)',
  },
  dark: {
    background: '#0D141A',
    surface: '#15202A',
    surfaceAlt: '#1D2B37',
    text: '#EDF3F8',
    textMuted: '#9FB0BF',
    border: '#2A3B49',
    primary: '#4FA8D8',
    primaryText: '#06121A',
    danger: '#EF5350',
    warning: '#FFB74D',
    success: '#66BB6A',
    mapOverlay: 'rgba(13,20,26,0.94)',
  },
};

export type AppColors = typeof palette.light;

export function useTheme() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return useMemo(() => {
    const colors = isDark ? palette.dark : palette.light;
    return {
      isDark,
      colors,
      levelColor: (level: Level) => levelColors[level][isDark ? 'dark' : 'light'],
      trafficColor: (category: TrafficCategory) =>
        trafficColors[category][isDark ? 'dark' : 'light'],
      spacing: (multiplier = 1) => 8 * multiplier,
    };
  }, [isDark]);
}

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
};

export const font = {
  small: 12,
  body: 15,
  subtitle: 17,
  title: 22,
  hero: 28,
};
