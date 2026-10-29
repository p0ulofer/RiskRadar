import {
  boundsAreaKm2,
  boundsContain,
  boundsFromPoint,
  boundsFromRegion,
  buildIncidentsUrl,
  buildTrafficMessage,
  fetchIncidents,
  normalizeIncident,
  shrinkBounds,
  TomTomError,
  TOMTOM_FREE_MONTHLY_LIMIT,
} from '@/lib/tomtom';
import type { TrafficIncident } from '@/types/traffic';

const NOW = 1_700_000_000_000;

function rawPoint(overrides: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-34.9, -8.05] },
    properties: {
      id: 'inc-1',
      iconCategory: 'accident',
      magnitudeOfDelay: 'major',
      events: [{ description: 'Acidente', code: 1, iconCategory: 'accident' }],
      startTime: '2026-10-29T12:00:00Z',
      lastReportTime: '2026-10-29T12:05:00Z',
      from: 'Recife',
      to: 'Olinda',
      lengthInMeters: 320,
      delayInSeconds: 180,
      roadNumbers: ['BR-101'],
      probabilityOfOccurrence: 'certain',
      numberOfReports: 4,
      ...overrides,
    },
  };
}

describe('normalizeIncident', () => {
  it('normaliza um incidente de ponto da API v2', () => {
    const incident = normalizeIncident(rawPoint(), NOW);
    expect(incident).toEqual<TrafficIncident>({
      id: 'inc-1',
      category: 'accident',
      magnitude: 'major',
      lat: -8.05,
      lng: -34.9,
      geometry: [[-8.05, -34.9]],
      roadNumbers: ['BR-101'],
      from: 'Recife',
      to: 'Olinda',
      description: 'Acidente',
      lengthM: 320,
      delayS: 180,
      startTime: '2026-10-29T12:00:00Z',
      lastReportTime: '2026-10-29T12:05:00Z',
      probability: 'certain',
      reports: 4,
      receivedAt: NOW,
    });
  });

  it('normaliza LineString e usa o vértice central como ponto', () => {
    const incident = normalizeIncident(
      {
        geometry: {
          type: 'LineString',
          coordinates: [
            [-34.9, -8.05],
            [-34.89, -8.04],
            [-34.88, -8.03],
          ],
        },
        properties: { id: 'inc-2', iconCategory: 'roadClosed', roadNumbers: [] },
      },
      NOW
    );
    expect(incident?.geometry).toEqual([
      [-8.05, -34.9],
      [-8.04, -34.89],
      [-8.03, -34.88],
    ]);
    expect(incident?.lat).toBe(-8.04);
    expect(incident?.lng).toBe(-34.89);
    expect(incident?.category).toBe('roadClosed');
  });

  it('aceita as categorias numéricas da API v1', () => {
    const incident = normalizeIncident(
      {
        geometry: { type: 'Point', coordinates: [-34.9, -8.05] },
        properties: { id: 'inc-3', iconCategory: 1, magnitudeOfDelay: 2, roadNumbers: ['101'] },
      },
      NOW
    );
    expect(incident?.category).toBe('accident');
    expect(incident?.magnitude).toBe('moderate');
    expect(incident?.roadNumbers).toEqual(['101']);
  });

  it('descarta incidente sem id ou sem geometria válida', () => {
    expect(
      normalizeIncident({ geometry: { type: 'Point', coordinates: [-34.9, -8.05] }, properties: {} })
    ).toBeNull();
    expect(
      normalizeIncident({ geometry: { type: 'LineString', coordinates: [] }, properties: { id: 'x' } })
    ).toBeNull();
  });

  it('trata campos numéricos nulos como ausentes', () => {
    const incident = normalizeIncident(
      rawPoint({
        lengthInMeters: null,
        delayInSeconds: null,
        numberOfReports: null,
        roadNumbers: null,
      }),
      NOW
    );
    expect(incident?.lengthM).toBeUndefined();
    expect(incident?.delayS).toBeUndefined();
    expect(incident?.reports).toBeUndefined();
    expect(incident?.roadNumbers).toEqual([]);
  });
});

describe('bbox', () => {
  it('converte uma região do mapa em bbox', () => {
    const bounds = boundsFromRegion({
      latitude: -8,
      longitude: -35,
      latitudeDelta: 0.4,
      longitudeDelta: 0.6,
    });
    expect(bounds.minLat).toBeCloseTo(-8.2);
    expect(bounds.maxLat).toBeCloseTo(-7.8);
    expect(bounds.minLon).toBeCloseTo(-35.3);
    expect(bounds.maxLon).toBeCloseTo(-34.7);
  });

  it('calcula a área e encolhe até o limite da API', () => {
    const huge = boundsFromRegion({
      latitude: -8.6,
      longitude: -37.6,
      latitudeDelta: 16,
      longitudeDelta: 16,
    });
    expect(boundsAreaKm2(huge)).toBeGreaterThan(10_000);
    const shrunk = shrinkBounds(huge);
    expect(boundsAreaKm2(shrunk)).toBeLessThanOrEqual(10_000.0001);
    expect(boundsContain(shrunk, shrunk)).toBe(true);
  });

  it('monta um bbox quadrado ao redor de um ponto', () => {
    const bounds = boundsFromPoint({ latitude: -8, longitude: -35 }, 5_000);
    expect(boundsAreaKm2(bounds)).toBeLessThan(200);
    expect(boundsContain(bounds, { ...bounds })).toBe(true);
  });
});

describe('buildIncidentsUrl', () => {
  it('inclui apiVersion, bbox e categorias', () => {
    const url = buildIncidentsUrl(
      { minLat: -8.2, maxLat: -7.8, minLon: -35.3, maxLon: -34.7 },
      ['accident', 'roadClosed']
    );
    expect(url).toContain('apiVersion=2');
    expect(url).toContain('bbox=-35.3%2C-8.2%2C-34.7%2C-7.8');
    expect(url).toContain('iconCategories=accident%2CroadClosed');
    expect(url).toContain('timeValidity=present');
  });
});

describe('buildTrafficMessage', () => {
  it('descreve categoria, rodovia e distância', () => {
    const incident = normalizeIncident(rawPoint(), NOW) as TrafficIncident;
    expect(buildTrafficMessage(incident, 800)).toBe('Acidente na BR-101 (Recife) a 800 m.');
    expect(buildTrafficMessage(incident, 1500)).toBe('Acidente na BR-101 (Recife) a 1.5 km.');
  });
});

describe('fetchIncidents', () => {
  const bounds = { minLat: -8.2, maxLat: -7.8, minLon: -35.3, maxLon: -34.7 };

  beforeEach(() => {
    process.env.EXPO_PUBLIC_TOMTOM_API_KEY = 'test-key';
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_TOMTOM_API_KEY;
  });

  function response(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }

  it('envia a chave no header e normaliza a resposta', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      response(200, { incidents: [rawPoint(), { properties: {} }] })
    );
    const result = await fetchIncidents(bounds, { now: NOW });
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].id).toBe('inc-1');
    expect(result.rawCount).toBe(2);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('api.tomtom.com/maps/orbis/traffic/incidents/details');
    expect(init.headers['TomTom-Api-Key']).toBe('test-key');
    expect(init.headers.Attributes).toContain('incidents(');
  });

  it('mapeia 403 para erro de autenticação e 429 para cota', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(response(403, {}));
    await expect(fetchIncidents(bounds)).rejects.toMatchObject({ kind: 'auth' });

    (global.fetch as jest.Mock).mockResolvedValueOnce(response(429, {}));
    await expect(fetchIncidents(bounds)).rejects.toMatchObject({ kind: 'quota' });
  });

  it('recusa bbox acima do limite sem chamar a rede', async () => {
    const huge = boundsFromRegion({
      latitude: -8,
      longitude: -37,
      latitudeDelta: 16,
      longitudeDelta: 16,
    });
    await expect(fetchIncidents(huge)).rejects.toBeInstanceOf(TomTomError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('exige a chave configurada', async () => {
    delete process.env.EXPO_PUBLIC_TOMTOM_API_KEY;
    await expect(fetchIncidents(bounds)).rejects.toMatchObject({ kind: 'missing-key' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('trata 204 como lista vazia', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(response(204, null));
    await expect(fetchIncidents(bounds)).resolves.toEqual({ incidents: [], rawCount: 0 });
  });
});

it('mantém o limite do plano free documentado', () => {
  expect(TOMTOM_FREE_MONTHLY_LIMIT).toBe(2_500);
});
