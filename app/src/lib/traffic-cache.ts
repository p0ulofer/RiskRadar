import AsyncStorage from '@react-native-async-storage/async-storage';

import { boundsContain } from '@/lib/tomtom';
import {
  pruneTrafficAlertState,
  type TrafficAlertState,
} from '@/lib/traffic-alerts';
import type { TrafficBounds, TrafficIncident } from '@/types/traffic';

export const TRAFFIC_CACHE_KEY = 'riskradar:traffic-cache:v1';
export const TRAFFIC_QUOTA_KEY = 'riskradar:tomtom-quota:v1';
export const TRAFFIC_ALERT_STATE_KEY = 'riskradar:traffic-alerts:v1';

export interface TrafficCache {
  version: 1;
  fetchedAt: number;
  bounds: TrafficBounds;
  incidents: TrafficIncident[];
}

export interface QuotaState {
  month: string;
  used: number;
}

export function monthKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function isCacheFresh(cache: TrafficCache, ttlMs: number, now: number): boolean {
  return now - cache.fetchedAt >= 0 && now - cache.fetchedAt < ttlMs;
}

/** O cache só serve se estiver fresco e cobrir toda a área pedida. */
export function isCacheUsable(
  cache: TrafficCache,
  bounds: TrafficBounds,
  ttlMs: number,
  now: number
): boolean {
  return isCacheFresh(cache, ttlMs, now) && boundsContain(cache.bounds, bounds);
}

export function nextQuota(quota: QuotaState, now: number): QuotaState {
  const month = monthKey(new Date(now));
  if (quota.month !== month) return { month, used: 1 };
  return { month, used: quota.used + 1 };
}

export function quotaRemaining(quota: QuotaState, limit: number): number {
  return Math.max(0, limit - quota.used);
}

function isBounds(value: unknown): value is TrafficBounds {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ['minLat', 'maxLat', 'minLon', 'maxLon'].every(
    (key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key])
  );
}

function parseCache(raw: string): TrafficCache | null {
  try {
    const value = JSON.parse(raw) as Partial<TrafficCache>;
    if (value.version !== 1) return null;
    if (typeof value.fetchedAt !== 'number' || !Number.isFinite(value.fetchedAt)) return null;
    if (!isBounds(value.bounds)) return null;
    if (!Array.isArray(value.incidents)) return null;
    return {
      version: 1,
      fetchedAt: value.fetchedAt,
      bounds: value.bounds,
      incidents: value.incidents as TrafficIncident[],
    };
  } catch {
    return null;
  }
}

export async function loadTrafficCache(): Promise<TrafficCache | null> {
  try {
    const raw = await AsyncStorage.getItem(TRAFFIC_CACHE_KEY);
    return raw ? parseCache(raw) : null;
  } catch {
    return null;
  }
}

export async function saveTrafficCache(cache: TrafficCache): Promise<void> {
  try {
    await AsyncStorage.setItem(TRAFFIC_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache é otimização: falhar não pode quebrar o app.
  }
}

export async function clearTrafficCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TRAFFIC_CACHE_KEY);
  } catch {
    // Ignora.
  }
}

export async function loadQuota(now = Date.now()): Promise<QuotaState> {
  const month = monthKey(new Date(now));
  try {
    const raw = await AsyncStorage.getItem(TRAFFIC_QUOTA_KEY);
    if (!raw) return { month, used: 0 };
    const value = JSON.parse(raw) as Partial<QuotaState>;
    if (value.month !== month || typeof value.used !== 'number' || !Number.isFinite(value.used)) {
      return { month, used: 0 };
    }
    return { month, used: Math.max(0, value.used) };
  } catch {
    return { month, used: 0 };
  }
}

export async function saveQuota(quota: QuotaState): Promise<void> {
  try {
    await AsyncStorage.setItem(TRAFFIC_QUOTA_KEY, JSON.stringify(quota));
  } catch {
    // Ignora.
  }
}

export async function incrementQuota(now = Date.now()): Promise<QuotaState> {
  const current = await loadQuota(now);
  const next = nextQuota(current, now);
  await saveQuota(next);
  return next;
}

export async function loadTrafficAlertState(now = Date.now()): Promise<TrafficAlertState> {
  try {
    const raw = await AsyncStorage.getItem(TRAFFIC_ALERT_STATE_KEY);
    if (!raw) return { lastByIncident: {}, lastGlobalAt: null };
    const value = JSON.parse(raw) as Partial<TrafficAlertState>;
    const lastByIncident =
      typeof value.lastByIncident === 'object' && value.lastByIncident !== null
        ? (value.lastByIncident as Record<string, number>)
        : {};
    const state: TrafficAlertState = {
      lastByIncident,
      lastGlobalAt: typeof value.lastGlobalAt === 'number' ? value.lastGlobalAt : null,
    };
    return pruneTrafficAlertState(state, now);
  } catch {
    return { lastByIncident: {}, lastGlobalAt: null };
  }
}

export async function saveTrafficAlertState(state: TrafficAlertState): Promise<void> {
  try {
    await AsyncStorage.setItem(TRAFFIC_ALERT_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignora.
  }
}
