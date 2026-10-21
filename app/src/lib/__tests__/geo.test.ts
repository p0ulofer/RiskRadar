import { haversineMeters, HotspotIndex, filterHotspots } from '@/lib/geo';
import type { Hotspot } from '@/types/hotspots';

function hotspot(overrides: Partial<Hotspot>): Hotspot {
  return {
    id: 'PE-101-0001',
    lat: -8.05,
    lng: -34.9,
    radius_m: 300,
    br: 101,
    uf: 'PE',
    municipio: 'Recife',
    km_min: 80,
    km_max: 82,
    n_acidentes: 10,
    mortos: 1,
    feridos_graves: 2,
    feridos_leves: 3,
    ilesos: 4,
    score: 100,
    level: 'critico',
    top_causas: [],
    top_tipos: [],
    fase_dia: {},
    por_ano: {},
    ...overrides,
  };
}

describe('haversineMeters', () => {
  it('calcula distância conhecida entre Recife e Olinda', () => {
    const distance = haversineMeters(
      { latitude: -8.0476, longitude: -34.877 },
      { latitude: -7.995, longitude: -34.855 }
    );
    expect(distance).toBeGreaterThan(5000);
    expect(distance).toBeLessThan(8000);
  });

  it('retorna zero para o mesmo ponto', () => {
    expect(
      haversineMeters({ latitude: -8, longitude: -35 }, { latitude: -8, longitude: -35 })
    ).toBe(0);
  });
});

describe('SpatialIndex', () => {
  const items = [
    hotspot({ id: 'a', lat: -8.05, lng: -34.9, score: 300 }),
    hotspot({ id: 'b', lat: -8.06, lng: -34.91, score: 200, level: 'alto' }),
    hotspot({ id: 'c', lat: -9.5, lng: -36.5, score: 100, level: 'medio', br: 232 }),
  ];
  const index = new HotspotIndex(items);

  it('filtra pelo retângulo visível e limita por score', () => {
    const region = {
      latitude: -8.055,
      longitude: -34.905,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    };
    expect(index.hotspotsInRegion(region).map((item) => item.id)).toEqual(['a', 'b']);
    expect(index.hotspotsInRegion(region, 1).map((item) => item.id)).toEqual(['a']);
  });

  it('consulta por raio usando a grade', () => {
    const found = index.hotspotsWithinRadius({ latitude: -8.05, longitude: -34.9 }, 5000);
    expect(found.map((item) => item.hotspot.id)).toEqual(['a', 'b']);
    expect(found[0].distanceM).toBeLessThan(found[1].distanceM);
  });

  it('retorna os mais próximos ordenados', () => {
    const nearest = index.nearestHotspots({ latitude: -9.49, longitude: -36.49 }, 2);
    expect(nearest[0].hotspot.id).toBe('c');
    expect(nearest[1].hotspot.id).toBe('b');
  });

  it('funciona com índice vazio', () => {
    const empty = new HotspotIndex([]);
    expect(empty.hotspotsInRegion({
      latitude: 0,
      longitude: 0,
      latitudeDelta: 1,
      longitudeDelta: 1,
    })).toEqual([]);
    expect(empty.nearestHotspots({ latitude: 0, longitude: 0 }, 5)).toEqual([]);
  });
});

describe('filterHotspots', () => {
  it('filtra por UF, BR e nível mínimo', () => {
    const items = [
      hotspot({ id: '1', uf: 'PE', br: 101, level: 'critico' }),
      hotspot({ id: '2', uf: 'PE', br: 232, level: 'baixo', score: 10 }),
      hotspot({ id: '3', uf: 'BA', br: 101, level: 'alto' }),
    ];
    expect(filterHotspots(items, { uf: 'PE' }).map((item) => item.id)).toEqual(['1', '2']);
    expect(filterHotspots(items, { br: 101 }).map((item) => item.id)).toEqual(['1', '3']);
    expect(filterHotspots(items, { minLevel: 'alto' }).map((item) => item.id)).toEqual(['1', '3']);
  });
});
