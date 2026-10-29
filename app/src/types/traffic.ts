export type TrafficCategory =
  | 'accident'
  | 'roadClosed'
  | 'jam'
  | 'roadWorks'
  | 'brokenDownVehicle'
  | 'dangerousConditions'
  | 'other';

export type TrafficMagnitude = 'unknown' | 'minor' | 'moderate' | 'major' | 'undefined';

export interface TrafficIncident {
  id: string;
  category: TrafficCategory;
  magnitude: TrafficMagnitude;
  /** Ponto usado para centralizar o mapa e calcular distância. */
  lat: number;
  lng: number;
  /** Linha do trecho afetado, no formato [lat, lng] aceito pelo Leaflet. */
  geometry: [number, number][];
  roadNumbers: string[];
  from?: string;
  to?: string;
  description?: string;
  lengthM?: number;
  delayS?: number;
  startTime?: string;
  lastReportTime?: string;
  probability?: string;
  reports?: number;
  /** Momento em que o app recebeu o incidente. */
  receivedAt: number;
}

export interface TrafficBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}
