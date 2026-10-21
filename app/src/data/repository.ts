import * as FileSystem from 'expo-file-system/legacy';

import seedJson from '@/assets/data/hotspots.json';
import type { Hotspot, HotspotsDocument, Level } from '@/types/hotspots';

const CACHE_FILENAME = 'riskradar-hotspots.json';
const LEVELS: Level[] = ['baixo', 'medio', 'alto', 'critico'];
const INFRA_KEYS = ['traffic_signals', 'crossing', 'traffic_calming', 'speed_camera'] as const;

export type LoadSource = 'cache' | 'seed';

export interface LoadResult {
  document: HotspotsDocument;
  source: LoadSource;
  error?: string;
}

export interface RefreshResult {
  updated: boolean;
  meta?: HotspotsDocument['meta'];
  error?: string;
}

/** Seed embarcado no app: garante funcionamento offline. */
export const seedDocument = seedJson as unknown as HotspotsDocument;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCountItem(value: unknown): boolean {
  return isRecord(value) && typeof value.nome === 'string' && typeof value.n === 'number';
}

export function isHotspot(value: unknown): value is Hotspot {
  if (!isRecord(value)) return false;
  const requiredStrings = ['id', 'uf', 'municipio', 'level'];
  if (!requiredStrings.every((key) => typeof value[key] === 'string')) return false;
  const requiredNumbers = [
    'lat',
    'lng',
    'radius_m',
    'br',
    'n_acidentes',
    'mortos',
    'feridos_graves',
    'feridos_leves',
    'ilesos',
    'score',
  ];
  if (!requiredNumbers.every((key) => typeof value[key] === 'number')) return false;
  if (!LEVELS.includes(value.level as Level)) return false;
  if (!Array.isArray(value.top_causas) || !value.top_causas.every(isCountItem)) return false;
  if (!Array.isArray(value.top_tipos) || !value.top_tipos.every(isCountItem)) return false;
  if (!isRecord(value.fase_dia) || !isRecord(value.por_ano)) return false;
  // 'infra' é opcional (schema 1 sem enriquecimento, schema 2 com OSM).
  if (value.infra !== undefined) {
    if (!isRecord(value.infra)) return false;
    const infra = value.infra;
    if (!INFRA_KEYS.every((key) => typeof infra[key] === 'number')) return false;
  }
  return true;
}

export function isHotspotsDocument(value: unknown): value is HotspotsDocument {
  if (!isRecord(value)) return false;
  if (!isRecord(value.meta)) return false;
  if (!Array.isArray(value.hotspots)) return false;
  const meta = value.meta;
  if (
    typeof meta.schema_version !== 'number' ||
    typeof meta.data_version !== 'string' ||
    typeof meta.generated_at !== 'string' ||
    (meta.fonte !== 'prf' && meta.fonte !== 'sintetico')
  ) {
    return false;
  }
  return value.hotspots.every(isHotspot);
}

export function parseHotspotsDocument(raw: string): HotspotsDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('JSON inválido');
  }
  if (!isHotspotsDocument(parsed)) {
    throw new Error('Formato de dados inválido');
  }
  return parsed;
}

function cacheUri(): string | null {
  if (!FileSystem.documentDirectory) return null;
  return `${FileSystem.documentDirectory}${CACHE_FILENAME}`;
}

async function readCache(): Promise<HotspotsDocument | null> {
  const uri = cacheUri();
  if (!uri) return null;
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) return null;
  const raw = await FileSystem.readAsStringAsync(uri);
  return parseHotspotsDocument(raw);
}

async function writeCache(raw: string): Promise<void> {
  const uri = cacheUri();
  if (!uri) return;
  await FileSystem.writeAsStringAsync(uri, raw);
}

export async function clearCache(): Promise<void> {
  const uri = cacheUri();
  if (!uri) return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

/**
 * Carrega os dados: cache em arquivo (se válido) e, como fallback, o seed.
 * Nunca lança: o app sempre abre, mesmo com cache corrompido.
 */
export async function loadHotspots(): Promise<LoadResult> {
  try {
    const cached = await readCache();
    if (cached) return { document: cached, source: 'cache' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await clearCache().catch(() => undefined);
    return { document: seedDocument, source: 'seed', error: `Cache inválido (${message})` };
  }
  return { document: seedDocument, source: 'seed' };
}

async function fetchJson(url: string, timeoutMs = 12_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

interface RemoteMeta {
  data_version?: unknown;
}

export function remoteBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/**
 * Verifica meta.json remoto e baixa hotspots.json apenas se a versão mudou.
 * Falhas de rede retornam erro sem afetar os dados locais.
 */
export async function refreshFromRemote(
  baseUrl: string,
  currentVersion: string
): Promise<RefreshResult> {
  const base = remoteBase(baseUrl);
  if (!base) return { updated: false, error: 'URL de dados não configurada' };
  try {
    const meta = await fetchJson(`${base}/meta.json`);
    if (!isRecord(meta) || typeof (meta as RemoteMeta).data_version !== 'string') {
      return { updated: false, error: 'meta.json remoto inválido' };
    }
    const remoteVersion = (meta as RemoteMeta).data_version as string;
    if (remoteVersion === currentVersion) {
      return { updated: false, meta: meta as unknown as HotspotsDocument['meta'] };
    }
    const document = await fetchJson(`${base}/hotspots.json`);
    if (!isHotspotsDocument(document)) {
      return { updated: false, error: 'hotspots.json remoto inválido' };
    }
    await writeCache(JSON.stringify(document));
    return { updated: true, meta: document.meta };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { updated: false, error: `Falha ao atualizar: ${message}` };
  }
}

export function hotspotById(document: HotspotsDocument, id: string): Hotspot | undefined {
  return document.hotspots.find((hotspot) => hotspot.id === id);
}
