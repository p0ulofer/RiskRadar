import { haversineMeters } from '@/lib/geo';
import { buildTrafficMessage } from '@/lib/tomtom';
import type { GeoPoint } from '@/types/hotspots';
import type { TrafficIncident } from '@/types/traffic';

export interface TrafficAlertSettings {
  enabled: boolean;
  radiusM: number;
}

export interface TrafficAlertState {
  lastByIncident: Record<string, number>;
  lastGlobalAt: number | null;
}

export interface TrafficTriggeredAlert {
  incident: TrafficIncident;
  distanceM: number;
  message: string;
  triggeredAt: number;
}

export interface TrafficAlertEvaluation {
  alerts: TrafficTriggeredAlert[];
  state: TrafficAlertState;
}

export const TRAFFIC_PER_INCIDENT_COOLDOWN_MS = 30 * 60 * 1000;
export const TRAFFIC_GLOBAL_COOLDOWN_MS = 30 * 1000;

/** Só acidentes e interdições justificam interromper o usuário. */
const ALERT_CATEGORIES = new Set(['accident', 'roadClosed']);

export const initialTrafficAlertState: TrafficAlertState = {
  lastByIncident: {},
  lastGlobalAt: null,
};

/**
 * Decide se um incidente do TomTom deve virar alerta.
 *
 * Regras:
 * - incidente dentro do raio de alerta;
 * - categoria acidente ou via interditada;
 * - cooldown de 30 min por incidente;
 * - no máximo um alerta a cada 30 s no total.
 */
export function evaluateTrafficAlerts(
  position: GeoPoint,
  incidents: TrafficIncident[],
  settings: TrafficAlertSettings,
  state: TrafficAlertState,
  now: number
): TrafficAlertEvaluation {
  if (!settings.enabled) {
    return { alerts: [], state };
  }
  if (state.lastGlobalAt !== null && now - state.lastGlobalAt < TRAFFIC_GLOBAL_COOLDOWN_MS) {
    return { alerts: [], state };
  }

  const candidates = incidents
    .filter((incident) => ALERT_CATEGORIES.has(incident.category))
    .map((incident) => ({
      incident,
      distanceM: haversineMeters(position, { latitude: incident.lat, longitude: incident.lng }),
    }))
    .filter(({ distanceM }) => distanceM <= settings.radiusM)
    .filter(({ incident }) => {
      const last = state.lastByIncident[incident.id];
      return last === undefined || now - last >= TRAFFIC_PER_INCIDENT_COOLDOWN_MS;
    })
    .sort((a, b) => a.distanceM - b.distanceM);

  const nearest = candidates[0];
  if (!nearest) {
    return { alerts: [], state };
  }

  const alert: TrafficTriggeredAlert = {
    incident: nearest.incident,
    distanceM: nearest.distanceM,
    message: buildTrafficMessage(nearest.incident, nearest.distanceM),
    triggeredAt: now,
  };
  return {
    alerts: [alert],
    state: {
      lastByIncident: {
        ...state.lastByIncident,
        [nearest.incident.id]: now,
      },
      lastGlobalAt: now,
    },
  };
}

/** Remove cooldowns antigos para o estado persistido não crescer sem limite. */
export function pruneTrafficAlertState(
  state: TrafficAlertState,
  now: number,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000
): TrafficAlertState {
  const lastByIncident: Record<string, number> = {};
  for (const [id, timestamp] of Object.entries(state.lastByIncident)) {
    if (Number.isFinite(timestamp) && now - timestamp < maxAgeMs) {
      lastByIncident[id] = timestamp;
    }
  }
  return {
    lastByIncident,
    lastGlobalAt:
      state.lastGlobalAt !== null && now - state.lastGlobalAt < maxAgeMs
        ? state.lastGlobalAt
        : null,
  };
}
