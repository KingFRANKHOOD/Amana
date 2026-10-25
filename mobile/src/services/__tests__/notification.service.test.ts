import {
  getNotificationOptInPreference,
  getNotificationPermissionStatus,
  registerForPushNotifications,
  optOutOfNotifications,
  getStoredPushToken,
  storePushTokenOnBackend,
  setupNotificationListeners,
  setupForegroundNotificationHandler,
  scheduleLocalNotification,
  ensureAndroidNotificationChannel,
} from '../notification.service';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  scheduleNotificationAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
}));

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
    __store: store,
  };
});

const secretStore = () => (SecureStore as any).__store;

describe('notification.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const store = secretStore();
    Object.keys(store).forEach((k) => delete store[k]);
    Platform.OS = 'ios';
  });

  it('getNotificationOptInPreference returns unset by default', async () => {
    expect(await getNotificationOptInPreference()).toBe('unset');
  });

  it('registerForPushNotifications stores granted preference and token', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'push-token-1' });
    const token = await registerForPushNotifications();
    expect(token).toBe('push-token-1');
    expect(await getStoredPushToken()).toBe('push-token-1');
    expect(await getNotificationOptInPreference()).toBe('granted');
  });

  it('registerForPushNotifications records denied when permission denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    const token = await registerForPushNotifications();
    expect(token).toBeNull();
    expect(await getNotificationOptInPreference()).toBe('denied');
  });

  it('optOutOfNotifications clears token and sets denied', async () => {
    const store = secretStore();
    store['amana_push_token'] = 'tok';
    await optOutOfNotifications();
    expect(store['amana_push_token']).toBeUndefined();
    expect(await getNotificationOptInPreference()).toBe('denied');
  });

  it('setupNotificationListeners returns a cleanup function', () => {
    const onTap = jest.fn();
    const cleanup = setupNotificationListeners(onTap);
    expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled();
    expect(cleanup).toEqual(expect.any(Function));
    cleanup();
  });

  it('setupForegroundNotificationHandler returns a cleanup function', () => {
    const onNotification = jest.fn();
    const cleanup = setupForegroundNotificationHandler(onNotification);
    expect(Notifications.addNotificationReceivedListener).toHaveBeenCalled();
    cleanup();
  });

  it('scheduleLocalNotification calls scheduleNotificationAsync', async () => {
    (Notifications.scheduleNotificationAsync as jest.Mock).mockResolvedValue('id-1');
    const id = await scheduleLocalNotification('Title', 'Body', { type: 'trade', tradeId: 't1' });
    expect(id).toBe('id-1');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'Title', body: 'Body', data: { type: 'trade', tradeId: 't1' }, sound: true },
      trigger: null,
    });
  });

  it('getNotificationPermissionStatus returns status', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    expect(await getNotificationPermissionStatus()).toBe('granted');
  });

  it('ensureAndroidNotificationChannel creates channel on android', async () => {
    Platform.OS = 'android';
    await ensureAndroidNotificationChannel();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', expect.objectContaining({ name: 'default' }));
  });

  it('ensureAndroidNotificationChannel is no-op on ios', async () => {
    Platform.OS = 'ios';
    await ensureAndroidNotificationChannel();
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('storePushTokenOnBackend returns true on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
    expect(await storePushTokenOnBackend('tok', 'auth')).toBe(true);
  });

  it('storePushTokenOnBackend returns false on failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as any;
    expect(await storePushTokenOnBackend('tok', 'auth')).toBe(false);
  });
});
