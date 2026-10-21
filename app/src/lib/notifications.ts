/**
 * Ponte segura para o expo-notifications.
 *
 * Em algumas versões do Expo Go o módulo nativo `ExpoTopicSubscriptionModule`
 * não existe. O `import` estático de `expo-notifications` lança nesse caso e
 * derruba o app inteiro, mesmo que só quiséssemos notificações locais.
 * Por isso o pacote é carregado sob demanda e qualquer falha vira
 * `unavailable`: o banner no app e a voz continuam funcionando.
 */

import type * as ExpoNotifications from 'expo-notifications';

export type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

type NotificationsModule = typeof ExpoNotifications;

let cachedModule: NotificationsModule | null | undefined;

function normalize(status: string): NotificationPermission {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  if (status === 'undetermined') return 'undetermined';
  return 'unavailable';
}

function loadNotifications(): NotificationsModule | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // require tardio: um import estático quebraria o app se o módulo nativo
    // não existisse no Expo Go.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('expo-notifications') as NotificationsModule;
    try {
      module.setNotificationHandler({
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
    cachedModule = module;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  const module = loadNotifications();
  if (!module) return 'unavailable';
  try {
    const permission = await module.getPermissionsAsync();
    return normalize(permission.status);
  } catch {
    return 'unavailable';
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  const module = loadNotifications();
  if (!module) return 'unavailable';
  try {
    let permission = await module.getPermissionsAsync();
    if (!permission.granted) permission = await module.requestPermissionsAsync();
    return normalize(permission.status);
  } catch {
    return 'unavailable';
  }
}

export async function presentLocalNotification(title: string, body: string): Promise<boolean> {
  const module = loadNotifications();
  if (!module) return false;
  try {
    await module.scheduleNotificationAsync({
      content: { title, body, sound: false },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}
