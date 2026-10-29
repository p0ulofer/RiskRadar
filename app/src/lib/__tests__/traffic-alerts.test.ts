import {
  evaluateTrafficAlerts,
  initialTrafficAlertState,
  pruneTrafficAlertState,
  TRAFFIC_GLOBAL_COOLDOWN_MS,
  TRAFFIC_PER_INCIDENT_COOLDOWN_MS,
} from '@/lib/traffic-alerts';
import type { TrafficIncident } from '@/types/traffic';

const NOW = 1_700_000_000_000;
const position = { latitude: -8.05, longitude: -34.9 };

function incident(overrides: Partial<TrafficIncident> = {}): TrafficIncident {
  return {
    id: 'inc-1',
    category: 'accident',
    magnitude: 'major',
    lat: -8.05,
    lng: -34.9,
    geometry: [[-8.05, -34.9]],
    roadNumbers: ['BR-101'],
    from: 'Recife',
    receivedAt: NOW,
    ...overrides,
  };
}

const settings = { enabled: true, radiusM: 1000 };

describe('evaluateTrafficAlerts', () => {
  it('dispara para acidente dentro do raio', () => {
    const result = evaluateTrafficAlerts(position, [incident()], settings, initialTrafficAlertState, NOW);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].incident.id).toBe('inc-1');
    expect(result.alerts[0].distanceM).toBeLessThan(1);
    expect(result.alerts[0].message).toContain('Acidente na BR-101');
    expect(result.state.lastByIncident['inc-1']).toBe(NOW);
    expect(result.state.lastGlobalAt).toBe(NOW);
  });

  it('ignora congestionamento e incidente fora do raio', () => {
    const jam = incident({ id: 'jam-1', category: 'jam' });
    const far = incident({ id: 'far-1', lat: -9.5 });
    const result = evaluateTrafficAlerts(
      position,
      [jam, far],
      settings,
      initialTrafficAlertState,
      NOW
    );
    expect(result.alerts).toHaveLength(0);
  });

  it('respeita o cooldown por incidente', () => {
    const first = evaluateTrafficAlerts(
      position,
      [incident()],
      settings,
      initialTrafficAlertState,
      NOW
    );
    const second = evaluateTrafficAlerts(
      position,
      [incident()],
      settings,
      first.state,
      NOW + TRAFFIC_PER_INCIDENT_COOLDOWN_MS - 1
    );
    expect(second.alerts).toHaveLength(0);

    const third = evaluateTrafficAlerts(
      position,
      [incident()],
      settings,
      first.state,
      NOW + TRAFFIC_PER_INCIDENT_COOLDOWN_MS
    );
    expect(third.alerts).toHaveLength(1);
  });

  it('respeita o cooldown global entre incidentes diferentes', () => {
    const first = evaluateTrafficAlerts(
      position,
      [incident()],
      settings,
      initialTrafficAlertState,
      NOW
    );
    const other = incident({ id: 'inc-2' });
    const second = evaluateTrafficAlerts(
      position,
      [other],
      settings,
      first.state,
      NOW + TRAFFIC_GLOBAL_COOLDOWN_MS - 1
    );
    expect(second.alerts).toHaveLength(0);
  });

  it('não dispara quando desabilitado', () => {
    const result = evaluateTrafficAlerts(
      position,
      [incident()],
      { ...settings, enabled: false },
      initialTrafficAlertState,
      NOW
    );
    expect(result.alerts).toHaveLength(0);
    expect(result.state).toBe(initialTrafficAlertState);
  });
});

describe('pruneTrafficAlertState', () => {
  it('remove cooldowns antigos', () => {
    const pruned = pruneTrafficAlertState(
      {
        lastByIncident: { old: NOW - 8 * 24 * 60 * 60 * 1000, recent: NOW - 1000 },
        lastGlobalAt: NOW - 8 * 24 * 60 * 60 * 1000,
      },
      NOW
    );
    expect(pruned.lastByIncident).toEqual({ recent: NOW - 1000 });
    expect(pruned.lastGlobalAt).toBeNull();
  });
});
