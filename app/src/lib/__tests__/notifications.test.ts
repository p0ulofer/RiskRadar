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
    jest.doMock('expo-notifications', () => {
      throw new Error("Cannot find native module 'ExpoTopicSubscriptionModule'");
    });

    const notifications = loadBridge();
    await expect(notifications.getNotificationPermission()).resolves.toBe('unavailable');
    await expect(notifications.requestNotificationPermission()).resolves.toBe('unavailable');
    await expect(notifications.presentLocalNotification('RiskRadar', 'teste')).resolves.toBe(false);
  });

  it('pede permissão e agenda notificação quando o módulo está disponível', async () => {
    const setNotificationHandler = jest.fn();
    const scheduleNotificationAsync = jest.fn().mockResolvedValue('id');
    const requestPermissionsAsync = jest.fn().mockResolvedValue({
      granted: true,
      status: 'granted',
    });

    jest.doMock('expo-notifications', () => ({
      setNotificationHandler,
      getPermissionsAsync: jest.fn().mockResolvedValue({
        granted: false,
        status: 'undetermined',
      }),
      requestPermissionsAsync,
      scheduleNotificationAsync,
    }));

    const notifications = loadBridge();
    await expect(notifications.requestNotificationPermission()).resolves.toBe('granted');
    await expect(notifications.presentLocalNotification('RiskRadar', 'teste')).resolves.toBe(true);
    expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'RiskRadar', body: 'teste', sound: false },
      trigger: null,
    });
  });
});
