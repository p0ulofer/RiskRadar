import { levelLabel, levelRank } from '@/lib/format';
import type { GeoPoint, Hotspot, Level } from '@/types/hotspots';

export interface AlertSettings {
  enabled: boolean;
  radiusM: number;
  minLevel: Level;
  voiceEnabled: boolean;
}

export interface AlertState {
  lastByHotspot: Record<string, number>;
  lastGlobalAt: number | null;
}

export interface TriggeredAlert {
  hotspot: Hotspot;
  distanceM: number;
  message: string;
  triggeredAt: number;
}

export interface AlertEvaluation {
  alerts: TriggeredAlert[];
  state: AlertState;
}

export interface AlertIndex {
  hotspotsWithinRadius(
    point: GeoPoint,
    radiusM: number
  ): { hotspot: Hotspot; distanceM: number }[];
}

export const PER_HOTSPOT_COOLDOWN_MS = 10 * 60 * 1000;
export const GLOBAL_COOLDOWN_MS = 30 * 1000;

export const initialAlertState: AlertState = {
  lastByHotspot: {},
  lastGlobalAt: null,
};

export function buildAlertMessage(hotspot: Hotspot): string {
  return `Trecho de risco ${levelLabel(hotspot.level).toLowerCase()} à frente: BR-${hotspot.br}, ${
    hotspot.municipio
  }. ${hotspot.n_acidentes} acidentes, ${hotspot.mortos} mortes registradas.`;
}

/**
 * Decide se um alerta deve ser disparado para a posição atual.
 *
 * Regras:
 * - distância até o hotspot <= raio de alerta;
 * - nível do hotspot >= nível mínimo;
 * - cooldown de 10 min por hotspot;
 * - no máximo um alerta a cada 30 s no total.
 */
export function evaluateAlerts(
  position: GeoPoint,
  index: AlertIndex,
  settings: AlertSettings,
  state: AlertState,
  now: number
): AlertEvaluation {
  if (!settings.enabled) {
    return { alerts: [], state };
  }
  if (state.lastGlobalAt !== null && now - state.lastGlobalAt < GLOBAL_COOLDOWN_MS) {
    return { alerts: [], state };
  }

  const minRank = levelRank(settings.minLevel);
  const candidates = index
    .hotspotsWithinRadius(position, settings.radiusM)
    .filter(({ hotspot }) => levelRank(hotspot.level) >= minRank)
    .filter(({ hotspot }) => {
      const last = state.lastByHotspot[hotspot.id];
      return last === undefined || now - last >= PER_HOTSPOT_COOLDOWN_MS;
    })
    .sort((a, b) => a.distanceM - b.distanceM);

  const nearest = candidates[0];
  if (!nearest) {
    return { alerts: [], state };
  }

  const alert: TriggeredAlert = {
    hotspot: nearest.hotspot,
    distanceM: nearest.distanceM,
    message: buildAlertMessage(nearest.hotspot),
    triggeredAt: now,
  };
  return {
    alerts: [alert],
    state: {
      lastByHotspot: {
        ...state.lastByHotspot,
        [nearest.hotspot.id]: now,
      },
      lastGlobalAt: now,
    },
  };
}
