/**
 * Ponte segura para o expo-notifications.
 *
 * O `index` do pacote `expo-notifications` importa o módulo nativo
 * `ExpoTopicSubscriptionModule` (usado por push com tópicos), que não existe
 * no Expo Go. Importar o pacote inteiro lança
 * `Cannot find native module 'ExpoTopicSubscriptionModule'` e, no dev server,
 * isso vira tela vermelha do LogBox.
 *
 * Por isso carregamos apenas os submódulos que o app usa — permissões,
 * handler de primeiro plano e agendamento — que não tocam o módulo ausente.
 * Se qualquer um deles não estiver disponível, o status vira `unavailable` e o
 * app continua funcionando: banner interno e voz seguem ativos.
 */

import type * as PermissionsModule from 'expo-notifications/build/NotificationPermissions';
import type * as HandlerModule from 'expo-notifications/build/NotificationsHandler';
import type * as SchedulerModule from 'expo-notifications/build/scheduleNotificationAsync';

export type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

interface NotificationsApi {
  getPermissionsAsync: typeof PermissionsModule.getPermissionsAsync;
  requestPermissionsAsync: typeof PermissionsModule.requestPermissionsAsync;
  setNotificationHandler: typeof HandlerModule.setNotificationHandler;
  scheduleNotificationAsync: typeof SchedulerModule.scheduleNotificationAsync;
}

let cachedApi: NotificationsApi | null | undefined;

function normalize(status: string): NotificationPermission {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  if (status === 'undetermined') return 'undetermined';
  return 'unavailable';
}

function loadNotifications(): NotificationsApi | null {
  if (cachedApi !== undefined) return cachedApi;
  try {
    // Submódulos: não passam pelo index do pacote (ver comentário do topo).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const permissions = require('expo-notifications/build/NotificationPermissions') as
      typeof PermissionsModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const handler = require('expo-notifications/build/NotificationsHandler') as
      typeof HandlerModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const scheduler = require('expo-notifications/build/scheduleNotificationAsync') as
      typeof SchedulerModule;

    try {
      handler.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
    } catch {
      // O handler só controla a apresentação em primeiro plano.
    }

    cachedApi = {
      getPermissionsAsync: permissions.getPermissionsAsync,
      requestPermissionsAsync: permissions.requestPermissionsAsync,
      setNotificationHandler: handler.setNotificationHandler,
      scheduleNotificationAsync: scheduler.scheduleNotificationAsync,
    };
  } catch {
    cachedApi = null;
  }
  return cachedApi;
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  const api = loadNotifications();
  if (!api) return 'unavailable';
  try {
    const permission = await api.getPermissionsAsync();
    return normalize(permission.status);
  } catch {
    return 'unavailable';
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  const api = loadNotifications();
  if (!api) return 'unavailable';
  try {
    let permission = await api.getPermissionsAsync();
    if (!permission.granted) permission = await api.requestPermissionsAsync();
    return normalize(permission.status);
  } catch {
    return 'unavailable';
  }
}

export async function presentLocalNotification(title: string, body: string): Promise<boolean> {
  const api = loadNotifications();
  if (!api) return false;
  try {
    await api.scheduleNotificationAsync({
      content: { title, body, sound: false },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}
