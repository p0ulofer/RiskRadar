import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { evaluateAlerts, initialAlertState, type AlertState, type TriggeredAlert } from '@/lib/alerts';
import {
  evaluateTrafficAlerts,
  initialTrafficAlertState,
  type TrafficAlertState,
  type TrafficTriggeredAlert,
} from '@/lib/traffic-alerts';
import {
  loadTrafficAlertState,
  saveTrafficAlertState,
} from '@/lib/traffic-cache';
import {
  getNotificationPermission,
  presentLocalNotification,
  requestNotificationPermission,
  type NotificationPermission,
} from '@/lib/notifications';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { useTraffic } from '@/store/traffic';

export type PermissionStatus = NotificationPermission;

interface AlertsContextValue {
  activeAlert: TriggeredAlert | null;
  activeTrafficAlert: TrafficTriggeredAlert | null;
  dismissAlert: () => void;
  dismissTrafficAlert: () => void;
  notificationStatus: PermissionStatus;
  locationStatus: PermissionStatus;
  alertIssue: string | null;
  requestNotifications: () => Promise<boolean>;
}

const AlertsContext = createContext<AlertsContextValue | null>(null);

function statusFromPermission(status: string): PermissionStatus {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  if (status === 'undetermined') return 'undetermined';
  return 'unavailable';
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { index } = useData();
  const { settings } = useSettings();
  const {
    configured: trafficConfigured,
    nearbyIncidents,
    refreshNearby,
  } = useTraffic();
  const [activeAlert, setActiveAlert] = useState<TriggeredAlert | null>(null);
  const [activeTrafficAlert, setActiveTrafficAlert] =
    useState<TrafficTriggeredAlert | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<PermissionStatus>('undetermined');
  const [locationStatus, setLocationStatus] = useState<PermissionStatus>('undetermined');
  const [alertIssue, setAlertIssue] = useState<string | null>(null);

  const settingsRef = useRef(settings);
  const indexRef = useRef(index);
  const nearbyRef = useRef(nearbyIncidents);
  const alertStateRef = useRef<AlertState>(initialAlertState);
  const trafficAlertStateRef = useRef<TrafficAlertState>(initialTrafficAlertState);
  const trafficAlertStateReady = useRef(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trafficDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trafficWatchEnabled = settings.trafficEnabled && settings.trafficAlertEnabled;
  const watchEnabled = settings.alertEnabled || trafficWatchEnabled;

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    nearbyRef.current = nearbyIncidents;
  }, [nearbyIncidents]);

  useEffect(() => {
    let cancelled = false;
    loadTrafficAlertState()
      .then((state) => {
        if (!cancelled) trafficAlertStateRef.current = state;
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) trafficAlertStateReady.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissAlert = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setActiveAlert(null);
  }, []);

  const dismissTrafficAlert = useCallback(() => {
    if (trafficDismissTimer.current) clearTimeout(trafficDismissTimer.current);
    setActiveTrafficAlert(null);
  }, []);

  const requestNotifications = useCallback(async (): Promise<boolean> => {
    const status = await requestNotificationPermission();
    setNotificationStatus(status);
    return status === 'granted';
  }, []);

  const deliver = useCallback(async (message: string) => {
    const status = await getNotificationPermission();
    setNotificationStatus(status);
    if (status === 'granted') {
      // Se o módulo nativo não existir (Expo Go), o banner continua sozinho.
      await presentLocalNotification('RiskRadar', message);
    }

    if (settingsRef.current.voiceEnabled) {
      try {
        await Speech.stop();
        Speech.speak(message, { language: 'pt-BR' });
      } catch {
        // Voz é opcional.
      }
    }
  }, []);

  const notify = useCallback(
    async (alert: TriggeredAlert) => {
      setActiveAlert(alert);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => setActiveAlert(null), 12_000);
      await deliver(alert.message);
    },
    [deliver]
  );

  const notifyTraffic = useCallback(
    async (alert: TrafficTriggeredAlert) => {
      setActiveTrafficAlert(alert);
      if (trafficDismissTimer.current) clearTimeout(trafficDismissTimer.current);
      trafficDismissTimer.current = setTimeout(() => setActiveTrafficAlert(null), 12_000);
      await deliver(alert.message);
    },
    [deliver]
  );

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    if (!watchEnabled) {
      return () => undefined;
    }

    async function start() {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        setLocationStatus(statusFromPermission(permission.status));
        if (!permission.granted) {
          setAlertIssue('Permissão de localização negada. Ative nos ajustes do sistema.');
          return;
        }

        const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
        if (!enabled) {
          setAlertIssue('GPS desligado. Ative a localização para receber alertas.');
          return;
        }

        setAlertIssue(null);
        await requestNotifications();
        if (cancelled) return;

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 50,
            timeInterval: 15_000,
          },
          (position) => {
            const current = settingsRef.current;
            const point = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            };
            const now = Date.now();

            if (current.alertEnabled) {
              const evaluation = evaluateAlerts(
                point,
                indexRef.current,
                {
                  enabled: current.alertEnabled,
                  radiusM: current.alertRadiusM,
                  minLevel: current.alertMinLevel,
                  voiceEnabled: current.voiceEnabled,
                },
                alertStateRef.current,
                now
              );
              alertStateRef.current = evaluation.state;
              if (evaluation.alerts.length > 0) {
                void notify(evaluation.alerts[0]);
              }
            }

            if (
              trafficConfigured &&
              trafficAlertStateReady.current &&
              current.trafficEnabled &&
              current.trafficAlertEnabled
            ) {
              // Mantém a lista de 30 km por perto enquanto o app está aberto.
              void refreshNearby(point);
              const trafficEvaluation = evaluateTrafficAlerts(
                point,
                nearbyRef.current,
                { enabled: true, radiusM: current.alertRadiusM },
                trafficAlertStateRef.current,
                now
              );
              if (trafficEvaluation.alerts.length > 0) {
                trafficAlertStateRef.current = trafficEvaluation.state;
                void saveTrafficAlertState(trafficEvaluation.state);
                void notifyTraffic(trafficEvaluation.alerts[0]);
              }
            }
          }
        );
        if (cancelled) {
          subscription.remove();
          subscription = null;
        }
      } catch {
        if (!cancelled) {
          setAlertIssue('Não foi possível iniciar o monitoramento de localização.');
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [
    watchEnabled,
    trafficConfigured,
    refreshNearby,
    requestNotifications,
    notify,
    notifyTraffic,
  ]);

  useEffect(
    () => () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      if (trafficDismissTimer.current) clearTimeout(trafficDismissTimer.current);
      Speech.stop().catch(() => undefined);
    },
    []
  );

  const value = useMemo(
    () => ({
      activeAlert,
      activeTrafficAlert,
      dismissAlert,
      dismissTrafficAlert,
      notificationStatus,
      locationStatus,
      alertIssue,
      requestNotifications,
    }),
    [
      activeAlert,
      activeTrafficAlert,
      dismissAlert,
      dismissTrafficAlert,
      notificationStatus,
      locationStatus,
      alertIssue,
      requestNotifications,
    ]
  );

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts(): AlertsContextValue {
  const context = useContext(AlertsContext);
  if (!context) throw new Error('useAlerts deve ser usado dentro de AlertsProvider');
  return context;
}
