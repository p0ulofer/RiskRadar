import {
  evaluateAlerts,
  initialAlertState,
  PER_HOTSPOT_COOLDOWN_MS,
  GLOBAL_COOLDOWN_MS,
  type AlertIndex,
  type AlertSettings,
} from '@/lib/alerts';
import { haversineMeters } from '@/lib/geo';
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
    mortos: 2,
    feridos_graves: 3,
    feridos_leves: 5,
    ilesos: 1,
    score: 150,
    level: 'alto',
    top_causas: [],
    top_tipos: [],
    fase_dia: {},
    por_ano: {},
    ...overrides,
  };
}

function fakeIndex(items: Hotspot[]): AlertIndex {
  return {
    hotspotsWithinRadius(point, radiusM) {
      return items
        .map((item) => ({
          hotspot: item,
          distanceM: haversineMeters(point, { latitude: item.lat, longitude: item.lng }),
        }))
        .filter((item) => item.distanceM <= radiusM)
        .sort((a, b) => a.distanceM - b.distanceM);
    },
  };
}

const settings: AlertSettings = {
  enabled: true,
  radiusM: 1000,
  minLevel: 'alto',
  voiceEnabled: true,
};

const position = { latitude: -8.05, longitude: -34.9 };
const NOW = 1_700_000_000_000;

describe('evaluateAlerts', () => {
  it('dispara para hotspot dentro do raio e com nível suficiente', () => {
    const result = evaluateAlerts(position, fakeIndex([hotspot({})]), settings, initialAlertState, NOW);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].hotspot.id).toBe('PE-101-0001');
    expect(result.alerts[0].message).toBe(
      'Trecho de risco alto à frente: BR-101, Recife. 10 acidentes, 2 mortes registradas.'
    );
    expect(result.state.lastByHotspot['PE-101-0001']).toBe(NOW);
    expect(result.state.lastGlobalAt).toBe(NOW);
  });

  it('não dispara quando os alertas estão desligados', () => {
    const result = evaluateAlerts(
      position,
      fakeIndex([hotspot({})]),
      { ...settings, enabled: false },
      initialAlertState,
      NOW
    );
    expect(result.alerts).toHaveLength(0);
    expect(result.state).toEqual(initialAlertState);
  });

  it('não dispara para nível abaixo do mínimo', () => {
    const result = evaluateAlerts(
      position,
      fakeIndex([hotspot({ level: 'medio' })]),
      settings,
      initialAlertState,
      NOW
    );
    expect(result.alerts).toHaveLength(0);
  });

  it('não dispara fora do raio', () => {
    const far = hotspot({ id: 'far', lat: -9.5, lng: -36.5 });
    const result = evaluateAlerts(position, fakeIndex([far]), settings, initialAlertState, NOW);
    expect(result.alerts).toHaveLength(0);
  });

  it('respeita cooldown global de 30 segundos', () => {
    const first = evaluateAlerts(
      position,
      fakeIndex([hotspot({}), hotspot({ id: 'second', br: 232, municipio: 'Caruaru' })]),
      settings,
      initialAlertState,
      NOW
    );
    expect(first.alerts).toHaveLength(1);
    const second = evaluateAlerts(
      position,
      fakeIndex([hotspot({ id: 'second', br: 232, municipio: 'Caruaru' })]),
      settings,
      first.state,
      NOW + 10_000
    );
    expect(second.alerts).toHaveLength(0);
    expect(second.state).toEqual(first.state);
  });

  it('respeita cooldown de 10 minutos por hotspot', () => {
    const first = evaluateAlerts(position, fakeIndex([hotspot({})]), settings, initialAlertState, NOW);
    const second = evaluateAlerts(
      position,
      fakeIndex([hotspot({})]),
      settings,
      first.state,
      NOW + GLOBAL_COOLDOWN_MS
    );
    expect(second.alerts).toHaveLength(0);

    const third = evaluateAlerts(
      position,
      fakeIndex([hotspot({})]),
      settings,
      first.state,
      NOW + PER_HOTSPOT_COOLDOWN_MS
    );
    expect(third.alerts).toHaveLength(1);
  });

  it('permite outro hotspot após o cooldown global', () => {
    const first = evaluateAlerts(position, fakeIndex([hotspot({})]), settings, initialAlertState, NOW);
    const other = hotspot({ id: 'second', br: 232, municipio: 'Caruaru' });
    const second = evaluateAlerts(
      position,
      fakeIndex([other]),
      settings,
      first.state,
      NOW + GLOBAL_COOLDOWN_MS
    );
    expect(second.alerts).toHaveLength(1);
    expect(second.alerts[0].hotspot.id).toBe('second');
  });
});
