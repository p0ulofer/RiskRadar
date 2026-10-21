export type Level = 'baixo' | 'medio' | 'alto' | 'critico';

export type DataSourceKind = 'prf' | 'sintetico';

export interface CountItem {
  nome: string;
  n: number;
}

export interface HotspotInfra {
  traffic_signals: number;
  crossing: number;
  traffic_calming: number;
  speed_camera: number;
}

export interface Hotspot {
  id: string;
  lat: number;
  lng: number;
  radius_m: number;
  br: number;
  uf: string;
  municipio: string;
  km_min: number;
  km_max: number;
  /** Km de referência do trecho (mediana do grupo dominante de km). */
  km_mediana?: number;
  n_acidentes: number;
  mortos: number;
  feridos_graves: number;
  feridos_leves: number;
  ilesos: number;
  score: number;
  level: Level;
  top_causas: CountItem[];
  top_tipos: CountItem[];
  fase_dia: Record<string, number>;
  por_ano: Record<string, number>;
  infra?: HotspotInfra;
}

export interface HotspotsParams {
  eps_m: number;
  min_samples: number;
  pesos: Record<string, number>;
}

export interface HotspotsMeta {
  schema_version: number;
  generated_at: string;
  data_version: string;
  fonte: DataSourceKind;
  ufs: string[];
  anos: number[];
  params: HotspotsParams;
  cortes_nivel: {
    medio: number;
    alto: number;
    critico: number;
  };
  total_acidentes_considerados: number;
  total_hotspots: number;
}

export interface HotspotsDocument {
  meta: HotspotsMeta;
  hotspots: Hotspot[];
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface GeoRegion extends GeoPoint {
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface NearbyHotspot {
  hotspot: Hotspot;
  distanceM: number;
}
