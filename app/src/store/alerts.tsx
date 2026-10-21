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
  getNotificationPermission,
  presentLocalNotification,
  requestNotificationPermission,
  type NotificationPermission,
} from '@/lib/notifications';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';

export type PermissionStatus = NotificationPermission;

interface AlertsContextValue {
  activeAlert: TriggeredAlert | null;
  dismissAlert: () => void;
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
  const [activeAlert, setActiveAlert] = useState<TriggeredAlert | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<PermissionStatus>('undetermined');
  const [locationStatus, setLocationStatus] = useState<PermissionStatus>('undetermined');
  const [alertIssue, setAlertIssue] = useState<string | null>(null);

  const settingsRef = useRef(settings);
  const indexRef = useRef(index);
  const alertStateRef = useRef<AlertState>(initialAlertState);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const dismissAlert = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setActiveAlert(null);
  }, []);

  const requestNotifications = useCallback(async (): Promise<boolean> => {
    const status = await requestNotificationPermission();
    setNotificationStatus(status);
    return status === 'granted';
  }, []);

  const notify = useCallback(async (alert: TriggeredAlert) => {
    setActiveAlert(alert);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setActiveAlert(null), 12_000);

    const status = await getNotificationPermission();
    setNotificationStatus(status);
    if (status === 'granted') {
      // Se o módulo nativo não existir (Expo Go), o banner continua sozinho.
      await presentLocalNotification('RiskRadar', alert.message);
    }

    if (settingsRef.current.voiceEnabled) {
      try {
        await Speech.stop();
        Speech.speak(alert.message, { language: 'pt-BR' });
      } catch {
        // Voz é opcional.
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    if (!settings.alertEnabled) {
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
            if (!current.alertEnabled) return;
            const evaluation = evaluateAlerts(
              {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              },
              indexRef.current,
              {
                enabled: current.alertEnabled,
                radiusM: current.alertRadiusM,
                minLevel: current.alertMinLevel,
                voiceEnabled: current.voiceEnabled,
              },
              alertStateRef.current,
              Date.now()
            );
            alertStateRef.current = evaluation.state;
            if (evaluation.alerts.length > 0) {
              void notify(evaluation.alerts[0]);
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
  }, [settings.alertEnabled, requestNotifications, notify]);

  useEffect(
    () => () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      Speech.stop().catch(() => undefined);
    },
    []
  );

  const value = useMemo(
    () => ({
      activeAlert,
      dismissAlert,
      notificationStatus,
      locationStatus,
      alertIssue,
      requestNotifications,
    }),
    [activeAlert, dismissAlert, notificationStatus, locationStatus, alertIssue, requestNotifications]
  );

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts(): AlertsContextValue {
  const context = useContext(AlertsContext);
  if (!context) throw new Error('useAlerts deve ser usado dentro de AlertsProvider');
  return context;
}
