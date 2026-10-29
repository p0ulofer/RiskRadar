/**
 * Cliente da API de incidentes de trânsito do TomTom (Orbis v2).
 *
 * - A chave vai no header `TomTom-Api-Key`, nunca na URL (fica fora de logs).
 * - A bbox máxima aceita pela API é de 10.000 km²; o app só consulta a área
 *   visível ou um raio pequeno ao redor do usuário.
 * - Plano free: 2.500 requisições por mês. O store controla cache e cota.
 */
import type { GeoPoint, GeoRegion } from '@/types/hotspots';
import type {
  TrafficBounds,
  TrafficCategory,
  TrafficIncident,
  TrafficMagnitude,
} from '@/types/traffic';

export const TOMTOM_DETAILS_URL = 'https://api.tomtom.com/maps/orbis/traffic/incidents/details';
export const TOMTOM_FREE_MONTHLY_LIMIT = 2_500;
export const TOMTOM_MAX_BBOX_KM2 = 10_000;
export const TOMTOM_DEFAULT_CATEGORIES: TrafficCategory[] = [
  'accident',
  'roadClosed',
  'brokenDownVehicle',
];

export type TomTomErrorKind =
  | 'missing-key'
  | 'auth'
  | 'quota'
  | 'invalid-bounds'
  | 'network'
  | 'server';

export class TomTomError extends Error {
  readonly kind: TomTomErrorKind;
  readonly status?: number;

  constructor(kind: TomTomErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'TomTomError';
    this.kind = kind;
    this.status = status;
  }
}

export function getTomTomKey(): string {
  return (process.env.EXPO_PUBLIC_TOMTOM_API_KEY ?? '').trim();
}

export function isTomTomConfigured(): boolean {
  return getTomTomKey().length > 0;
}

const CATEGORY_LABELS: Record<TrafficCategory, string> = {
  accident: 'Acidente',
  roadClosed: 'Via interditada',
  jam: 'Congestionamento',
  roadWorks: 'Obras',
  brokenDownVehicle: 'Veículo quebrado',
  dangerousConditions: 'Condição perigosa',
  other: 'Incidente',
};

const CATEGORY_BY_NUMBER: Record<number, TrafficCategory> = {
  1: 'accident',
  2: 'other',
  3: 'dangerousConditions',
  4: 'other',
  5: 'other',
  6: 'jam',
  7: 'other',
  8: 'roadClosed',
  9: 'roadWorks',
  10: 'other',
  11: 'other',
  14: 'brokenDownVehicle',
};

export function categoryLabel(category: TrafficCategory): string {
  return CATEGORY_LABELS[category] ?? CATEGORY_LABELS.other;
}

/** Converte string (v2) ou número (v1) do TomTom para a categoria interna. */
export function normalizeCategory(value: unknown): TrafficCategory {
  if (typeof value === 'number') return CATEGORY_BY_NUMBER[value] ?? 'other';
  if (typeof value !== 'string') return 'other';
  const normalized = value.trim();
  if (normalized in CATEGORY_LABELS) return normalized as TrafficCategory;
  const lower = normalized.toLowerCase();
  if (lower === 'accident') return 'accident';
  if (lower === 'roadclosed' || lower === 'road_closed') return 'roadClosed';
  if (lower === 'jam') return 'jam';
  if (lower === 'roadworks' || lower === 'road_works') return 'roadWorks';
  if (lower === 'brokendownvehicle' || lower === 'broken_down_vehicle') {
    return 'brokenDownVehicle';
  }
  if (lower === 'dangerousconditions' || lower === 'dangerous_conditions') {
    return 'dangerousConditions';
  }
  return 'other';
}

export function normalizeMagnitude(value: unknown): TrafficMagnitude {
  if (typeof value === 'number') {
    return (['unknown', 'minor', 'moderate', 'major', 'undefined'] as const)[value] ?? 'unknown';
  }
  if (typeof value !== 'string') return 'unknown';
  const lower = value.toLowerCase();
  if (lower === 'minor' || lower === 'moderate' || lower === 'major' || lower === 'undefined') {
    return lower;
  }
  return 'unknown';
}

export function roadLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^\d+$/.test(trimmed) ? `BR-${trimmed}` : trimmed;
}

function centerOf(points: [number, number][]): { lat: number; lng: number } | null {
  if (points.length === 0) return null;
  const middle = points[Math.floor(points.length / 2)] as [number, number];
  return { lat: middle[0], lng: middle[1] };
}

interface RawGeometry {
  type?: unknown;
  coordinates?: unknown;
}

interface RawIncident {
  geometry?: RawGeometry;
  properties?: Record<string, unknown>;
}

function parseGeometry(geometry: RawGeometry | undefined): [number, number][] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const { type, coordinates } = geometry;
  if (type === 'Point') {
    const point = coordinates as unknown[];
    if (point.length < 2) return [];
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [[lat, lng]] : [];
  }
  if (type === 'LineString') {
    const line = coordinates as unknown[][];
    const points: [number, number][] = [];
    for (const pair of line) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const lng = Number(pair[0]);
      const lat = Number(pair[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng]);
    }
    return points;
  }
  return [];
}

export function normalizeIncident(raw: RawIncident, now = Date.now()): TrafficIncident | null {
  const properties = raw.properties ?? {};
  const id = typeof properties.id === 'string' ? properties.id : '';
  if (!id) return null;

  const geometry = parseGeometry(raw.geometry);
  const center = centerOf(geometry);
  if (!center) return null;

  const events = Array.isArray(properties.events) ? properties.events : [];
  const firstEvent = events.find(
    (event): event is { description?: unknown } =>
      typeof event === 'object' && event !== null
  );
  const description =
    firstEvent && typeof firstEvent.description === 'string' ? firstEvent.description : undefined;

  const roadNumbers = Array.isArray(properties.roadNumbers)
    ? properties.roadNumbers
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  const numeric = (value: unknown): number | undefined => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return {
    id,
    category: normalizeCategory(properties.iconCategory),
    magnitude: normalizeMagnitude(properties.magnitudeOfDelay),
    lat: center.lat,
    lng: center.lng,
    geometry,
    roadNumbers,
    from: typeof properties.from === 'string' ? properties.from : undefined,
    to: typeof properties.to === 'string' ? properties.to : undefined,
    description,
    lengthM: numeric(properties.lengthInMeters ?? properties.length),
    delayS: numeric(properties.delayInSeconds ?? properties.delay),
    startTime: typeof properties.startTime === 'string' ? properties.startTime : undefined,
    lastReportTime:
      typeof properties.lastReportTime === 'string' ? properties.lastReportTime : undefined,
    probability:
      typeof properties.probabilityOfOccurrence === 'string'
        ? properties.probabilityOfOccurrence
        : undefined,
    reports: numeric(properties.numberOfReports),
    receivedAt: now,
  };
}

export interface TrafficResponse {
  incidents: TrafficIncident[];
  rawCount: number;
}

export interface FetchIncidentsOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  categories?: TrafficCategory[];
  now?: number;
}

/** Monta a URL do endpoint (exportada para testes). */
export function buildIncidentsUrl(
  bounds: TrafficBounds,
  categories: TrafficCategory[] = TOMTOM_DEFAULT_CATEGORIES
): string {
  const params = new URLSearchParams({
    apiVersion: '2',
    bbox: `${bounds.minLon},${bounds.minLat},${bounds.maxLon},${bounds.maxLat}`,
    timeValidity: 'present',
  });
  if (categories.length > 0) params.set('iconCategories', categories.join(','));
  return `${TOMTOM_DETAILS_URL}?${params.toString()}`;
}

const ATTRIBUTES =
  'incidents(type,geometry(type,coordinates),properties(id,iconCategory,magnitudeOfDelay,' +
  'events(description,code,iconCategory),startTime,endTime,from,to,lengthInMeters,' +
  'delayInSeconds,roadNumbers,lastReportTime,probabilityOfOccurrence,numberOfReports))';

export async function fetchIncidents(
  bounds: TrafficBounds,
  options: FetchIncidentsOptions = {}
): Promise<TrafficResponse> {
  const key = getTomTomKey();
  if (!key) {
    throw new TomTomError('missing-key', 'Chave do TomTom não configurada.');
  }
  if (boundsAreaKm2(bounds) > TOMTOM_MAX_BBOX_KM2) {
    throw new TomTomError(
      'invalid-bounds',
      'Área muito grande para a API do TomTom (máximo de 10.000 km²).'
    );
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 12_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const external = options.signal;
  const abort = () => controller.abort();
  external?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(buildIncidentsUrl(bounds, options.categories), {
      headers: {
        'TomTom-Api-Key': key,
        Attributes: ATTRIBUTES,
        // A API Orbis v2 não aceita pt-BR (retorna 406). pt-PT é o português
        // suportado e mantém as descrições em português.
        'Accept-Language': 'pt-PT',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (response.status === 204) return { incidents: [], rawCount: 0 };
    if (response.status === 401 || response.status === 403) {
      throw new TomTomError('auth', 'Chave do TomTom inválida ou sem permissão.', response.status);
    }
    if (response.status === 429) {
      throw new TomTomError(
        'quota',
        'Limite de requisições do TomTom atingido. Tente mais tarde.',
        response.status
      );
    }
    if (response.status === 400) {
      throw new TomTomError('invalid-bounds', 'Área inválida para a API do TomTom.', 400);
    }
    if (response.status === 406) {
      throw new TomTomError(
        'server',
        'O TomTom recusou o idioma ou o formato da consulta (HTTP 406).',
        406
      );
    }
    if (!response.ok) {
      throw new TomTomError('server', `TomTom respondeu HTTP ${response.status}.`, response.status);
    }

    const payload = (await response.json()) as { incidents?: unknown };
    const rawList = Array.isArray(payload.incidents) ? payload.incidents : [];
    const now = options.now ?? Date.now();
    const incidents: TrafficIncident[] = [];
    for (const item of rawList) {
      if (typeof item !== 'object' || item === null) continue;
      const normalized = normalizeIncident(item as RawIncident, now);
      if (normalized) incidents.push(normalized);
    }
    return { incidents, rawCount: rawList.length };
  } catch (error) {
    if (error instanceof TomTomError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TomTomError('network', 'Tempo esgotado ao consultar o TomTom.');
    }
    throw new TomTomError('network', 'Não foi possível consultar o TomTom.');
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', abort);
  }
}

export function boundsFromRegion(region: GeoRegion): TrafficBounds {
  const halfLat = Math.abs(region.latitudeDelta) / 2;
  const halfLng = Math.abs(region.longitudeDelta) / 2;
  return normalizeBounds({
    minLat: region.latitude - halfLat,
    maxLat: region.latitude + halfLat,
    minLon: region.longitude - halfLng,
    maxLon: region.longitude + halfLng,
  });
}

export function boundsFromPoint(point: GeoPoint, radiusM: number): TrafficBounds {
  const latDelta = radiusM / 111_320;
  const lngDelta = radiusM / (111_320 * Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180)));
  return normalizeBounds({
    minLat: point.latitude - latDelta,
    maxLat: point.latitude + latDelta,
    minLon: point.longitude - lngDelta,
    maxLon: point.longitude + lngDelta,
  });
}

export function normalizeBounds(bounds: TrafficBounds): TrafficBounds {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  const minLat = clamp(Math.min(bounds.minLat, bounds.maxLat), -85, 85);
  const maxLat = clamp(Math.max(bounds.minLat, bounds.maxLat), -85, 85);
  const minLon = clamp(Math.min(bounds.minLon, bounds.maxLon), -180, 180);
  const maxLon = clamp(Math.max(bounds.minLon, bounds.maxLon), -180, 180);
  return { minLat, maxLat, minLon, maxLon };
}

export function boundsAreaKm2(bounds: TrafficBounds): number {
  const latMid = (((bounds.minLat + bounds.maxLat) / 2) * Math.PI) / 180;
  const heightKm = (bounds.maxLat - bounds.minLat) * 110.574;
  const widthKm = (bounds.maxLon - bounds.minLon) * 111.32 * Math.max(0, Math.cos(latMid));
  return Math.abs(heightKm * widthKm);
}

export function boundsContain(outer: TrafficBounds, inner: TrafficBounds): boolean {
  return (
    inner.minLat >= outer.minLat &&
    inner.maxLat <= outer.maxLat &&
    inner.minLon >= outer.minLon &&
    inner.maxLon <= outer.maxLon
  );
}

/** Encolhe a bbox ao redor do centro até caber no limite da API. */
export function shrinkBounds(bounds: TrafficBounds, maxAreaKm2 = TOMTOM_MAX_BBOX_KM2): TrafficBounds {
  const area = boundsAreaKm2(bounds);
  if (area <= maxAreaKm2 || area === 0) return bounds;
  const factor = Math.sqrt(maxAreaKm2 / area);
  const latMid = (bounds.minLat + bounds.maxLat) / 2;
  const lonMid = (bounds.minLon + bounds.maxLon) / 2;
  const halfLat = ((bounds.maxLat - bounds.minLat) / 2) * factor;
  const halfLon = ((bounds.maxLon - bounds.minLon) / 2) * factor;
  return normalizeBounds({
    minLat: latMid - halfLat,
    maxLat: latMid + halfLat,
    minLon: lonMid - halfLon,
    maxLon: lonMid + halfLon,
  });
}

export function buildTrafficMessage(incident: TrafficIncident, distanceM: number): string {
  const road = incident.roadNumbers[0] ? roadLabel(incident.roadNumbers[0]) : null;
  const where = incident.from || incident.to || incident.description;
  const distance = distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(1)} km`;
  const parts = [categoryLabel(incident.category)];
  if (road) parts.push(`na ${road}`);
  if (where) parts.push(`(${where})`);
  return `${parts.join(' ')} a ${distance}.`;
}

export function incidentPriority(incident: TrafficIncident): number {
  switch (incident.category) {
    case 'accident':
      return 0;
    case 'roadClosed':
      return 1;
    case 'brokenDownVehicle':
      return 2;
    case 'dangerousConditions':
      return 3;
    case 'roadWorks':
      return 4;
    case 'jam':
      return 5;
    default:
      return 6;
  }
}
