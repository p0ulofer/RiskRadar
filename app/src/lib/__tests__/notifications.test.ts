import type * as NotificationsBridge from '@/lib/notifications';

function loadBridge(): typeof NotificationsBridge {
  let bridge: typeof NotificationsBridge | undefined;
  jest.isolateModules(() => {
    bridge = jest.requireActual<typeof NotificationsBridge>('@/lib/notifications');
  });
  if (!bridge) throw new Error('Ponte de notificações não carregada');
  return bridge;
}

describe('ponte de notificações', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('degrada para unavailable quando o módulo nativo não existe', async () => {
    jest.doMock('expo-notifications/build/NotificationPermissions', () => {
      throw new Error("Cannot find native module 'ExpoTopicSubscriptionModule'");
    });

    const notifications = loadBridge();
    await expect(notifications.getNotificationPermission()).resolves.toBe('unavailable');
    await expect(notifications.requestNotificationPermission()).resolves.toBe('unavailable');
    await expect(notifications.presentLocalNotification('RiskRadar', 'teste')).resolves.toBe(false);
  });

  it('não importa o index do pacote (evita o módulo de tópicos no Expo Go)', async () => {
    jest.doMock('expo-notifications', () => {
      throw new Error("Cannot find native module 'ExpoTopicSubscriptionModule'");
    });
    jest.doMock('expo-notifications/build/NotificationPermissions', () => ({
      getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
      requestPermissionsAsync: jest.fn(),
    }));
    jest.doMock('expo-notifications/build/NotificationsHandler', () => ({
      setNotificationHandler: jest.fn(),
    }));
    jest.doMock('expo-notifications/build/scheduleNotificationAsync', () => ({
      scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
    }));

    const notifications = loadBridge();
    await expect(notifications.getNotificationPermission()).resolves.toBe('granted');
    await expect(notifications.presentLocalNotification('RiskRadar', 'teste')).resolves.toBe(true);
  });

  it('pede permissão e agenda notificação quando o módulo está disponível', async () => {
    const setNotificationHandler = jest.fn();
    const scheduleNotificationAsync = jest.fn().mockResolvedValue('id');
    const requestPermissionsAsync = jest.fn().mockResolvedValue({
      granted: true,
      status: 'granted',
    });

    jest.doMock('expo-notifications/build/NotificationPermissions', () => ({
      getPermissionsAsync: jest.fn().mockResolvedValue({
        granted: false,
        status: 'undetermined',
      }),
      requestPermissionsAsync,
    }));
    jest.doMock('expo-notifications/build/NotificationsHandler', () => ({
      setNotificationHandler,
    }));
    jest.doMock('expo-notifications/build/scheduleNotificationAsync', () => ({
      scheduleNotificationAsync,
    }));

    const notifications = loadBridge();
    await expect(notifications.requestNotificationPermission()).resolves.toBe('granted');
    await expect(notifications.presentLocalNotification('RiskRadar', 'teste')).resolves.toBe(true);
    expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(setNotificationHandler).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'RiskRadar', body: 'teste', sound: false },
      trigger: null,
    });
  });
});
