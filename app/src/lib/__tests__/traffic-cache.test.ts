import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  TRAFFIC_CACHE_KEY,
  TRAFFIC_QUOTA_KEY,
  incrementQuota,
  isCacheFresh,
  isCacheUsable,
  loadQuota,
  loadTrafficAlertState,
  loadTrafficCache,
  monthKey,
  nextQuota,
  quotaRemaining,
  saveTrafficAlertState,
  saveTrafficCache,
  type TrafficCache,
} from '@/lib/traffic-cache';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      __store: store,
    },
  };
});

const mockStore = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;
const NOW = new Date('2026-10-29T12:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;

function cache(overrides: Partial<TrafficCache> = {}): TrafficCache {
  return {
    version: 1,
    fetchedAt: NOW,
    bounds: { minLat: -8.2, maxLat: -7.8, minLon: -35.3, maxLon: -34.7 },
    incidents: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('cache', () => {
  it('considera fresco dentro do TTL e vencido depois', () => {
    expect(isCacheFresh(cache(), 15 * HOUR, NOW + 14 * HOUR)).toBe(true);
    expect(isCacheFresh(cache(), 15 * HOUR, NOW + 16 * HOUR)).toBe(false);
  });

  it('só usa o cache quando ele cobre a área pedida', () => {
    const inside = { minLat: -8.1, maxLat: -7.9, minLon: -35.2, maxLon: -34.8 };
    const outside = { minLat: -9.5, maxLat: -9.4, minLon: -35.2, maxLon: -35.1 };
    expect(isCacheUsable(cache(), inside, 15 * HOUR, NOW + HOUR)).toBe(true);
    expect(isCacheUsable(cache(), outside, 15 * HOUR, NOW + HOUR)).toBe(false);
  });

  it('grava e lê o cache, descartando JSON inválido', async () => {
    await saveTrafficCache(cache());
    await expect(loadTrafficCache()).resolves.toMatchObject({ version: 1, fetchedAt: NOW });

    mockStore.set(TRAFFIC_CACHE_KEY, '{"version":1}');
    await expect(loadTrafficCache()).resolves.toBeNull();

    mockStore.set(TRAFFIC_CACHE_KEY, 'não é json');
    await expect(loadTrafficCache()).resolves.toBeNull();
  });
});

describe('cota mensal', () => {
  it('usa a chave AAAA-MM', () => {
    expect(monthKey(new Date('2026-10-29T12:00:00Z'))).toBe('2026-10');
    expect(monthKey(new Date('2027-01-05T12:00:00Z'))).toBe('2027-01');
  });

  it('incrementa no mesmo mês e reinicia na virada', () => {
    expect(nextQuota({ month: '2026-10', used: 41 }, NOW)).toEqual({ month: '2026-10', used: 42 });
    expect(nextQuota({ month: '2026-09', used: 900 }, NOW)).toEqual({ month: '2026-10', used: 1 });
  });

  it('calcula o restante sem ficar negativo', () => {
    expect(quotaRemaining({ month: '2026-10', used: 2499 }, 2500)).toBe(1);
    expect(quotaRemaining({ month: '2026-10', used: 3000 }, 2500)).toBe(0);
  });

  it('persiste e reinicia a cota ao mudar de mês', async () => {
    await expect(loadQuota(NOW)).resolves.toEqual({ month: '2026-10', used: 0 });
    const first = await incrementQuota(NOW);
    expect(first).toEqual({ month: '2026-10', used: 1 });
    mockStore.set(TRAFFIC_QUOTA_KEY, JSON.stringify({ month: '2026-09', used: 120 }));
    await expect(loadQuota(NOW)).resolves.toEqual({ month: '2026-10', used: 0 });
  });
});

describe('estado de alertas', () => {
  it('persiste e poda entradas antigas', async () => {
    await saveTrafficAlertState({
      lastByIncident: { recent: NOW - 1000, old: NOW - 8 * 24 * HOUR },
      lastGlobalAt: NOW - 1000,
    });
    const loaded = await loadTrafficAlertState(NOW);
    expect(loaded.lastByIncident).toEqual({ recent: NOW - 1000 });
    expect(loaded.lastGlobalAt).toBe(NOW - 1000);
  });

  it('devolve estado vazio quando não há nada salvo', async () => {
    await expect(loadTrafficAlertState(NOW)).resolves.toEqual({
      lastByIncident: {},
      lastGlobalAt: null,
    });
  });
});
