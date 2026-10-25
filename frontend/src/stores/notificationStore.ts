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
      const response = await fetch('/api/notifications');
      if (!response.ok) {
        throw new Error(`Failed to fetch notifications: ${response.status}`);
      }
      const data = await response.json();
      const notifications = data.notifications || data;
      const unreadCount = notifications.filter((n: Notification) => !n.read).length;
      set({ notifications, unreadCount });
    } finally {
      set({ isLoading: false });
    }
  },

  markRead: async (id: string) => {
    const response = await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    if (!response.ok) {
      throw new Error(`Failed to mark notification as read: ${response.status}`);
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
    const response = await fetch('/api/notifications/read', { method: 'PATCH' });
    if (!response.ok) {
      throw new Error(`Failed to mark all notifications as read: ${response.status}`);
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
