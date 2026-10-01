import { useNotificationStore, Notification } from '../stores/notificationStore';

describe('Notification Store', () => {
  beforeEach(() => {
    // Reset Zustand store state before each test
    useNotificationStore.setState({
      notifications: [],
      unreadCount: 0,
      isLoading: false,
    });
    jest.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should have correct initial values', () => {
      const state = useNotificationStore.getState();
      expect(state.notifications).toEqual([]);
      expect(state.unreadCount).toBe(0);
      expect(state.isLoading).toBe(false);
    });
  });

  describe('fetch', () => {
    it('should set isLoading and fetch notifications successfully', async () => {
      const mockApiNotifications: Notification[] = [
        {
          id: 'n-1',
          title: 'Title 1',
          message: 'Msg 1',
          type: 'info',
          read: false,
          createdAt: '2026-06-28T00:00:00Z',
        },
        {
          id: 'n-2',
          title: 'Title 2',
          message: 'Msg 2',
          type: 'success',
          read: true,
          createdAt: '2026-06-28T01:00:00Z',
        },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ notifications: mockApiNotifications }),
      } as unknown as Response);

      const store = useNotificationStore.getState();
      const fetchPromise = store.fetch();

      expect(useNotificationStore.getState().isLoading).toBe(true);

      await fetchPromise;

      const state = useNotificationStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.notifications).toEqual(mockApiNotifications);
      expect(state.unreadCount).toBe(1);
    });

    it('should reject on fetch failure and preserve existing notifications', async () => {
      const existingNotifications: Notification[] = [
        { id: 'existing', title: 'Existing', message: 'Keep this', type: 'info', read: false, createdAt: '...' },
      ];
      useNotificationStore.setState({ notifications: existingNotifications, unreadCount: 1 });
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response);

      const store = useNotificationStore.getState();
      await expect(store.fetch()).rejects.toThrow('Failed to fetch notifications: 404');

      const state = useNotificationStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.notifications).toEqual(existingNotifications);
      expect(state.unreadCount).toBe(1);
    });
  });

  describe('markRead', () => {
    it('should mark a notification as read and decrement unreadCount', async () => {
      const initialNotifications: Notification[] = [
        { id: '1', title: 'T1', message: 'M1', type: 'info', read: false, createdAt: '...' },
        { id: '2', title: 'T2', message: 'M2', type: 'success', read: false, createdAt: '...' },
      ];

      useNotificationStore.setState({
        notifications: initialNotifications,
        unreadCount: 2,
      });

      global.fetch = jest.fn().mockResolvedValue({ ok: true } as unknown as Response);

      const store = useNotificationStore.getState();
      await store.markRead('1');

      const state = useNotificationStore.getState();
      expect(state.notifications[0].read).toBe(true);
      expect(state.notifications[1].read).toBe(false);
      expect(state.unreadCount).toBe(1);
      expect(global.fetch).toHaveBeenCalledWith('/api/notifications/1/read', { method: 'PATCH' });
    });

    it('should reject on request failure without changing notifications', async () => {
      const initialNotifications: Notification[] = [
        { id: '1', title: 'T1', message: 'M1', type: 'info', read: false, createdAt: '...' },
      ];
      useNotificationStore.setState({ notifications: initialNotifications, unreadCount: 1 });
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      await expect(useNotificationStore.getState().markRead('1')).rejects.toThrow('Network error');

      const state = useNotificationStore.getState();
      expect(state.notifications).toEqual(initialNotifications);
      expect(state.unreadCount).toBe(1);
    });
  });

  describe('markAllRead', () => {
    it('should mark all notifications as read and set unreadCount to 0', async () => {
      const initialNotifications: Notification[] = [
        { id: '1', title: 'T1', message: 'M1', type: 'info', read: false, createdAt: '...' },
        { id: '2', title: 'T2', message: 'M2', type: 'success', read: false, createdAt: '...' },
      ];

      useNotificationStore.setState({
        notifications: initialNotifications,
        unreadCount: 2,
      });

      global.fetch = jest.fn().mockResolvedValue({ ok: true } as unknown as Response);

      const store = useNotificationStore.getState();
      await store.markAllRead();

      const state = useNotificationStore.getState();
      expect(state.notifications.every(n => n.read)).toBe(true);
      expect(state.unreadCount).toBe(0);
      expect(global.fetch).toHaveBeenCalledWith('/api/notifications/read', { method: 'PATCH' });
    });

    it('should reject on unsuccessful response without changing notifications', async () => {
      const initialNotifications: Notification[] = [
        { id: '1', title: 'T1', message: 'M1', type: 'info', read: false, createdAt: '...' },
      ];
      useNotificationStore.setState({ notifications: initialNotifications, unreadCount: 1 });
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response);

      await expect(useNotificationStore.getState().markAllRead()).rejects.toThrow(
        'Failed to mark all notifications as read: 404',
      );

      const state = useNotificationStore.getState();
      expect(state.notifications).toEqual(initialNotifications);
      expect(state.unreadCount).toBe(1);
    });
  });

  describe('addNotification', () => {
    it('should prepend a notification and update unreadCount', () => {
      const initialNotifications: Notification[] = [
        { id: '1', title: 'T1', message: 'M1', type: 'info', read: true, createdAt: '...' },
      ];

      useNotificationStore.setState({
        notifications: initialNotifications,
        unreadCount: 0,
      });

      const newNotification: Notification = {
        id: '2',
        title: 'T2',
        message: 'M2',
        type: 'warning',
        read: false,
        createdAt: '...',
      };

      const store = useNotificationStore.getState();
      store.addNotification(newNotification);

      const state = useNotificationStore.getState();
      expect(state.notifications.length).toBe(2);
      expect(state.notifications[0]).toEqual(newNotification);
      expect(state.unreadCount).toBe(1);
    });
  });
});
