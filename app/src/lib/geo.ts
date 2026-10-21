import type { GeoPoint, GeoRegion, Hotspot, Level } from '@/types/hotspots';
import { levelRank } from '@/lib/format';

const EARTH_RADIUS_M = 6_371_000;
export const GRID_CELL_SIZE_DEG = 0.1;

export interface Nearby<T> {
  hotspot: T;
  distanceM: number;
}

export interface SpatialItem {
  id: string;
  lat: number;
  lng: number;
  score: number;
  level: Level;
}

/** Distância haversine em metros entre dois pontos em graus decimais. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/**
 * Índice espacial em grade de 0,1° (~11 km).
 *
 * Evita varrer todos os hotspots a cada atualização de GPS: consultas por raio
 * visitam apenas as células próximas. Para regiões muito grandes o índice cai
 * para uma varredura única, que ainda é barata para alguns milhares de itens.
 */
export class SpatialIndex<T extends SpatialItem> {
  private readonly cellSize: number;
  private readonly cells = new Map<string, T[]>();
  private readonly items: T[];

  constructor(items: T[], cellSizeDeg: number = GRID_CELL_SIZE_DEG) {
    this.items = [...items];
    this.cellSize = cellSizeDeg;
    for (const item of items) {
      const key = this.keyFor(item.lat, item.lng);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(item);
      else this.cells.set(key, [item]);
    }
  }

  get size(): number {
    return this.items.length;
  }

  private keyFor(lat: number, lng: number): string {
    return `${Math.floor(lat / this.cellSize)}:${Math.floor(lng / this.cellSize)}`;
  }

  private collect(
    latMin: number,
    latMax: number,
    lngMin: number,
    lngMax: number
  ): T[] {
    const latCells = Math.floor(latMax / this.cellSize) - Math.floor(latMin / this.cellSize) + 1;
    const lngCells = Math.floor(lngMax / this.cellSize) - Math.floor(lngMin / this.cellSize) + 1;
    if (latCells * lngCells > 4000 || latCells * lngCells > this.cells.size * 4) {
      return this.items;
    }
    const found: T[] = [];
    for (
      let latIndex = Math.floor(latMin / this.cellSize);
      latIndex <= Math.floor(latMax / this.cellSize);
      latIndex += 1
    ) {
      for (
        let lngIndex = Math.floor(lngMin / this.cellSize);
        lngIndex <= Math.floor(lngMax / this.cellSize);
        lngIndex += 1
      ) {
        const bucket = this.cells.get(`${latIndex}:${lngIndex}`);
        if (bucket) found.push(...bucket);
      }
    }
    return found;
  }

  /** Hotspots dentro do retângulo visível, priorizando maior score. */
  hotspotsInRegion(region: GeoRegion, limit = 150): T[] {
    const halfLat = Math.abs(region.latitudeDelta) / 2;
    const halfLng = Math.abs(region.longitudeDelta) / 2;
    const latMin = region.latitude - halfLat;
    const latMax = region.latitude + halfLat;
    const lngMin = region.longitude - halfLng;
    const lngMax = region.longitude + halfLng;
    return this.collect(latMin, latMax, lngMin, lngMax)
      .filter(
        (item) =>
          item.lat >= latMin && item.lat <= latMax && item.lng >= lngMin && item.lng <= lngMax
      )
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  /** Hotspots dentro de um raio (metros), ordenados por distância. */
  hotspotsWithinRadius(point: GeoPoint, radiusM: number): Nearby<T>[] {
    const latDelta = radiusM / 111_320;
    const lngDelta = radiusM / (111_320 * Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180)));
    const candidates = this.collect(
      point.latitude - latDelta,
      point.latitude + latDelta,
      point.longitude - lngDelta,
      point.longitude + lngDelta
    );
    const result: Nearby<T>[] = [];
    for (const item of candidates) {
      const distanceM = haversineMeters(point, { latitude: item.lat, longitude: item.lng });
      if (distanceM <= radiusM) result.push({ hotspot: item, distanceM });
    }
    return result.sort((a, b) => a.distanceM - b.distanceM);
  }

  /** Os ``n`` hotspots mais próximos, usando expansão de anéis da grade. */
  nearestHotspots(point: GeoPoint, n: number): Nearby<T>[] {
    if (n <= 0 || this.items.length === 0) return [];
    let stepM = 20_000;
    let candidates: T[] = [];
    while (stepM <= 2_000_000) {
      const latDelta = stepM / 111_320;
      const lngDelta =
        stepM / (111_320 * Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180)));
      candidates = this.collect(
        point.latitude - latDelta,
        point.latitude + latDelta,
        point.longitude - lngDelta,
        point.longitude + lngDelta
      );
      if (candidates.length >= n) break;
      stepM *= 2;
    }
    if (candidates.length < n) candidates = this.items;
    return candidates
      .map((hotspot) => ({
        hotspot,
        distanceM: haversineMeters(point, { latitude: hotspot.lat, longitude: hotspot.lng }),
      }))
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, n);
  }
}

/** Atalho para o caso de uso do app. */
export class HotspotIndex extends SpatialIndex<Hotspot> {}

/** Filtra por UF, BR e nível mínimo. */
export function filterHotspots(
  hotspots: Hotspot[],
  filters: { uf?: string | null; br?: number | null; minLevel?: Level }
): Hotspot[] {
  const minRank = filters.minLevel ? levelRank(filters.minLevel) : -1;
  return hotspots.filter(
    (hotspot) =>
      (!filters.uf || hotspot.uf === filters.uf) &&
      (filters.br == null || hotspot.br === filters.br) &&
      levelRank(hotspot.level) >= minRank
  );
}
