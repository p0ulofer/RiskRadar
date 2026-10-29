import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { haversineMeters } from '@/lib/geo';
import {
  boundsAreaKm2,
  boundsContain,
  boundsFromPoint,
  boundsFromRegion,
  fetchIncidents,
  isTomTomConfigured,
  TomTomError,
  TOMTOM_FREE_MONTHLY_LIMIT,
  TOMTOM_MAX_BBOX_KM2,
} from '@/lib/tomtom';
import {
  incrementQuota,
  isCacheUsable,
  loadQuota,
  loadTrafficCache,
  saveTrafficCache,
  type QuotaState,
  type TrafficCache,
} from '@/lib/traffic-cache';
import { useSettings } from '@/store/settings';
import type { GeoPoint, GeoRegion } from '@/types/hotspots';
import type { TrafficIncident } from '@/types/traffic';

const NEARBY_RADIUS_M = 30_000;

interface TrafficContextValue {
  incidents: TrafficIncident[];
  nearbyIncidents: TrafficIncident[];
  allIncidents: TrafficIncident[];
  configured: boolean;
  enabled: boolean;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
  quota: { used: number; limit: number; remaining: number; month: string };
  regionTooLarge: boolean;
  setRegion: (region: GeoRegion) => void;
  refresh: (options?: { force?: boolean }) => Promise<void>;
  refreshNearby: (point: GeoPoint, radiusM?: number) => Promise<void>;
  clearError: () => void;
}

const TrafficContext = createContext<TrafficContextValue | null>(null);

function uniqueById(incidents: TrafficIncident[]): TrafficIncident[] {
  const map = new Map<string, TrafficIncident>();
  for (const incident of incidents) map.set(incident.id, incident);
  return [...map.values()];
}

function filterByRadius(
  incidents: TrafficIncident[],
  point: GeoPoint,
  radiusM: number
): TrafficIncident[] {
  return incidents.filter(
    (incident) =>
      haversineMeters(point, { latitude: incident.lat, longitude: incident.lng }) <= radiusM
  );
}

export function TrafficProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const configured = isTomTomConfigured();
  const enabled = settings.trafficEnabled;
  const ttlMs = settings.trafficRefreshMin * 60_000;

  const [incidents, setIncidents] = useState<TrafficIncident[]>([]);
  const [nearbyIncidents, setNearbyIncidents] = useState<TrafficIncident[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [regionTooLarge, setRegionTooLarge] = useState(false);
  const [quota, setQuota] = useState<QuotaState>({ month: '', used: 0 });

  const cacheRef = useRef<TrafficCache | null>(null);
  const quotaRef = useRef<QuotaState>({ month: '', used: 0 });
  const regionRef = useRef<GeoRegion | null>(null);
  const mapInFlight = useRef(false);
  const nearbyInFlight = useRef(false);
  const lastNearbyAt = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    quotaRef.current = quota;
  }, [quota]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadTrafficCache(), loadQuota()])
      .then(([cache, currentQuota]) => {
        if (cancelled) return;
        cacheRef.current = cache;
        quotaRef.current = currentQuota;
        setQuota(currentQuota);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const applyQuota = useCallback(async () => {
    const next = await incrementQuota();
    quotaRef.current = next;
    setQuota(next);
  }, []);

  const ensureQuota = useCallback(async (): Promise<boolean> => {
    if (quotaRef.current.used < TOMTOM_FREE_MONTHLY_LIMIT) return true;
    const fresh = await loadQuota();
    quotaRef.current = fresh;
    setQuota(fresh);
    if (fresh.used < TOMTOM_FREE_MONTHLY_LIMIT) return true;
    setError(
      `Limite mensal de ${TOMTOM_FREE_MONTHLY_LIMIT.toLocaleString('pt-BR')} consultas do TomTom atingido. Os últimos dados continuam disponíveis.`
    );
    return false;
  }, []);

  const storeResult = useCallback(
    (bounds: TrafficCache['bounds'], next: TrafficIncident[], fetchedAt: number) => {
      const cache: TrafficCache = { version: 1, fetchedAt, bounds, incidents: next };
      cacheRef.current = cache;
      void saveTrafficCache(cache);
      setUpdatedAt(fetchedAt);
    },
    []
  );

  const refresh = useCallback(
    async (options?: { force?: boolean }) => {
      const region = regionRef.current;
      if (!region || !configured || !enabled) return;
      const bounds = boundsFromRegion(region);
      if (boundsAreaKm2(bounds) > TOMTOM_MAX_BBOX_KM2) {
        setRegionTooLarge(true);
        return;
      }
      setRegionTooLarge(false);

      const now = Date.now();
      const cache = cacheRef.current;
      if (!options?.force && cache && isCacheUsable(cache, bounds, ttlMs, now)) {
        setIncidents(cache.incidents);
        setUpdatedAt(cache.fetchedAt);
        return;
      }
      if (mapInFlight.current) return;
      if (!(await ensureQuota())) return;

      mapInFlight.current = true;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchIncidents(bounds);
        await applyQuota();
        const fetchedAt = Date.now();
        setIncidents(result.incidents);
        storeResult(bounds, result.incidents, fetchedAt);
      } catch (caught) {
        const cached = cacheRef.current;
        if (cached && boundsContain(cached.bounds, bounds)) {
          setIncidents(cached.incidents);
          setUpdatedAt(cached.fetchedAt);
        }
        const message =
          caught instanceof TomTomError
            ? caught.message
            : 'Não foi possível carregar os acidentes em tempo real.';
        setError(message);
      } finally {
        mapInFlight.current = false;
        setLoading(false);
      }
    },
    [applyQuota, configured, enabled, ensureQuota, storeResult, ttlMs]
  );

  const refreshNearby = useCallback(
    async (point: GeoPoint, radiusM = NEARBY_RADIUS_M) => {
      if (!configured || !enabled) return;
      const now = Date.now();
      if (now - lastNearbyAt.current < ttlMs) return;
      if (nearbyInFlight.current) return;

      const bounds = boundsFromPoint(point, radiusM);
      const cache = cacheRef.current;
      if (cache && isCacheUsable(cache, bounds, ttlMs, now)) {
        lastNearbyAt.current = now;
        setNearbyIncidents(filterByRadius(cache.incidents, point, radiusM));
        setUpdatedAt(cache.fetchedAt);
        return;
      }
      if (!(await ensureQuota())) return;

      nearbyInFlight.current = true;
      lastNearbyAt.current = now;
      try {
        const result = await fetchIncidents(bounds);
        await applyQuota();
        const fetchedAt = Date.now();
        setNearbyIncidents(filterByRadius(result.incidents, point, radiusM));
        storeResult(bounds, result.incidents, fetchedAt);
      } catch (caught) {
        const cached = cacheRef.current;
        if (cached && boundsContain(cached.bounds, bounds)) {
          setNearbyIncidents(filterByRadius(cached.incidents, point, radiusM));
          setUpdatedAt(cached.fetchedAt);
        }
        const message =
          caught instanceof TomTomError
            ? caught.message
            : 'Não foi possível carregar os acidentes próximos.';
        setError(message);
      } finally {
        nearbyInFlight.current = false;
      }
    },
    [applyQuota, configured, enabled, ensureQuota, storeResult, ttlMs]
  );

  const setRegion = useCallback(
    (region: GeoRegion) => {
      regionRef.current = region;
      const bounds = boundsFromRegion(region);
      setRegionTooLarge(boundsAreaKm2(bounds) > TOMTOM_MAX_BBOX_KM2);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void refresh();
      }, 1_200);
    },
    [refresh]
  );

  useEffect(() => {
    if (!configured || !enabled) return;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (!regionRef.current) return;
      void refresh({ force: true });
    }, ttlMs);
    return () => clearInterval(timer);
  }, [configured, enabled, refresh, ttlMs]);

  useEffect(() => {
    if (!configured || !enabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [configured, enabled, refresh]);

  // Ao ligar a camada, busca imediatamente em vez de esperar o próximo ciclo.
  const wasEnabled = useRef(enabled);
  useEffect(() => {
    if (configured && enabled && !wasEnabled.current) {
      void refresh({ force: true });
    }
    wasEnabled.current = enabled;
  }, [configured, enabled, refresh]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const allIncidents = useMemo(
    () => uniqueById([...incidents, ...nearbyIncidents]),
    [incidents, nearbyIncidents]
  );

  const value = useMemo<TrafficContextValue>(
    () => ({
      incidents,
      nearbyIncidents,
      allIncidents,
      configured,
      enabled,
      loading,
      error,
      updatedAt,
      quota: {
        used: quota.used,
        limit: TOMTOM_FREE_MONTHLY_LIMIT,
        remaining: Math.max(0, TOMTOM_FREE_MONTHLY_LIMIT - quota.used),
        month: quota.month,
      },
      regionTooLarge,
      setRegion,
      refresh,
      refreshNearby,
      clearError: () => setError(null),
    }),
    [
      allIncidents,
      configured,
      enabled,
      error,
      incidents,
      loading,
      nearbyIncidents,
      quota,
      refresh,
      refreshNearby,
      regionTooLarge,
      setRegion,
      updatedAt,
    ]
  );

  return <TrafficContext.Provider value={value}>{children}</TrafficContext.Provider>;
}

export function useTraffic(): TrafficContextValue {
  const context = useContext(TrafficContext);
  if (!context) throw new Error('useTraffic deve ser usado dentro de TrafficProvider');
  return context;
}
