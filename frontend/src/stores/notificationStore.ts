import { create } from 'zustand';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  createdAt: string;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  fetch: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  addNotification: (notification: Notification) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,

  fetch: async () => {
    set({ isLoading: true });
    try {
      // Fetch from API, fallback to mock data on failure or for dev
      const response = await fetch('/api/notifications');
      if (response.ok) {
        const data = await response.json();
        const notifications = data.notifications || data;
        const unreadCount = notifications.filter((n: Notification) => !n.read).length;
        set({ notifications, unreadCount, isLoading: false });
      } else {
        throw new Error('API failed');
      }
    } catch {
      // Mock data fallback
      const mockNotifications: Notification[] = [
        {
          id: '1',
          title: 'Trade Created',
          message: 'Your trade #1024 has been successfully created.',
          type: 'success',
          read: false,
          createdAt: new Date().toISOString(),
        },
        {
          id: '2',
          title: 'Payment Received',
          message: 'Payment of 100 USDC received for trade #1024.',
          type: 'success',
          read: false,
          createdAt: new Date().toISOString(),
        },
        {
          id: '3',
          title: 'System Alert',
          message: 'Stellar network connectivity is currently optimal.',
          type: 'info',
          read: true,
          createdAt: new Date().toISOString(),
        }
      ];
      const unreadCount = mockNotifications.filter(n => !n.read).length;
      set({ notifications: mockNotifications, unreadCount, isLoading: false });
    }
  },

  markRead: async (id: string) => {
    // Optionally make a patch request to API
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    } catch {
      // Ignore API failure for client-side state update
    }

    const { notifications } = get();
    const updated = notifications.map(n => {
      if (n.id === id && !n.read) {
        return { ...n, read: true };
      }
      return n;
    });

    const unreadCount = updated.filter(n => !n.read).length;
    set({ notifications: updated, unreadCount });
  },

  markAllRead: async () => {
    try {
      await fetch('/api/notifications/read', { method: 'PATCH' });
    } catch {
      // Ignore API failure for client-side state update
    }

    const { notifications } = get();
    const updated = notifications.map(n => ({ ...n, read: true }));
    set({ notifications: updated, unreadCount: 0 });
  },

  addNotification: (notification: Notification) => {
    const { notifications } = get();
    const updated = [notification, ...notifications];
    const unreadCount = updated.filter(n => !n.read).length;
    set({ notifications: updated, unreadCount });
  },
}));
