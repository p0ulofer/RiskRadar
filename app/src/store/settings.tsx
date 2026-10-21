import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { Level } from '@/types/hotspots';

export type AlertRadius = 500 | 1000 | 2000;

export interface HotspotFilters {
  uf: string | null;
  br: number | null;
  minLevel: Level;
}

export interface AppSettings {
  alertEnabled: boolean;
  alertRadiusM: AlertRadius;
  alertMinLevel: Level;
  voiceEnabled: boolean;
  filters: HotspotFilters;
}

export const DEFAULT_SETTINGS: AppSettings = {
  alertEnabled: false,
  alertRadiusM: 1000,
  alertMinLevel: 'alto',
  voiceEnabled: true,
  filters: {
    uf: null,
    br: null,
    minLevel: 'baixo',
  },
};

const STORAGE_KEY = 'riskradar:settings:v1';

interface SettingsContextValue {
  settings: AppSettings;
  hydrated: boolean;
  updateSettings: (patch: Partial<Omit<AppSettings, 'filters'>>) => void;
  updateFilters: (patch: Partial<HotspotFilters>) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function mergeWithDefaults(value: unknown): AppSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS;
  const candidate = value as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...candidate,
    filters: {
      ...DEFAULT_SETTINGS.filters,
      ...(candidate.filters ?? {}),
    },
  };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        if (raw) setSettings(mergeWithDefaults(JSON.parse(raw)));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: AppSettings) => {
    setSettings(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<Omit<AppSettings, 'filters'>>) => {
      setSettings((previous) => {
        const next = { ...previous, ...patch };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
        return next;
      });
    },
    []
  );

  const updateFilters = useCallback((patch: Partial<HotspotFilters>) => {
    setSettings((previous) => {
      const next = { ...previous, filters: { ...previous.filters, ...patch } };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => persist(DEFAULT_SETTINGS), [persist]);

  const value = useMemo(
    () => ({ settings, hydrated, updateSettings, updateFilters, resetSettings }),
    [settings, hydrated, updateSettings, updateFilters, resetSettings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings deve ser usado dentro de SettingsProvider');
  return context;
}
