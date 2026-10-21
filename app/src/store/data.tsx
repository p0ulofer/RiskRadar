import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  clearCache,
  loadHotspots,
  refreshFromRemote,
  seedDocument,
  type LoadSource,
  type RefreshResult,
} from '@/data/repository';
import { HotspotIndex } from '@/lib/geo';
import type { HotspotsDocument } from '@/types/hotspots';

interface DataContextValue {
  document: HotspotsDocument;
  source: LoadSource;
  index: HotspotIndex;
  ready: boolean;
  refreshing: boolean;
  notice: string | null;
  loadError: string | null;
  updateConfigured: boolean;
  refresh: () => Promise<RefreshResult>;
  clearAndReload: () => Promise<void>;
  dismissNotice: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

const DATA_URL = process.env.EXPO_PUBLIC_DATA_URL ?? '';

export function DataProvider({ children }: { children: ReactNode }) {
  const [document, setDocument] = useState<HotspotsDocument>(seedDocument);
  const [source, setSource] = useState<LoadSource>('seed');
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadHotspots()
      .then((result) => {
        if (cancelled) return;
        setDocument(result.document);
        setSource(result.source);
        if (result.error) setLoadError(result.error);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Não foi possível ler os dados locais; usando demonstração.');
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const index = useMemo(() => new HotspotIndex(document.hotspots), [document]);

  const refresh = useCallback(async (): Promise<RefreshResult> => {
    if (!DATA_URL.trim()) {
      setNotice('Atualização remota não configurada (EXPO_PUBLIC_DATA_URL).');
      return { updated: false, error: 'URL não configurada' };
    }
    setRefreshing(true);
    setNotice(null);
    try {
      const result = await refreshFromRemote(DATA_URL, document.meta.data_version);
      if (result.updated) {
        const reloaded = await loadHotspots();
        setDocument(reloaded.document);
        setSource(reloaded.source);
        setNotice('Dados atualizados com sucesso.');
      } else if (result.error) {
        setNotice(result.error);
      } else {
        setNotice('Você já está com a versão mais recente.');
      }
      return result;
    } finally {
      setRefreshing(false);
    }
  }, [document.meta.data_version]);

  const clearAndReload = useCallback(async () => {
    await clearCache();
    setDocument(seedDocument);
    setSource('seed');
    setNotice('Cache limpo. Dados de demonstração restaurados.');
  }, []);

  const value = useMemo(
    () => ({
      document,
      source,
      index,
      ready,
      refreshing,
      notice,
      loadError,
      updateConfigured: Boolean(DATA_URL.trim()),
      refresh,
      clearAndReload,
      dismissNotice: () => setNotice(null),
    }),
    [document, source, index, ready, refreshing, notice, loadError, refresh, clearAndReload]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData deve ser usado dentro de DataProvider');
  return context;
}
