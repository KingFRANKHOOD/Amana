import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const PUSH_TOKEN_KEY = "amana_push_token";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface NotificationData {
  type?: "trade" | "dispute" | "general";
  tradeId?: string;
  disputeId?: string;
  screen?: string;
}

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync();
    const pushToken = token.data;

    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, pushToken);
    return pushToken;
  } catch (error) {
    return null;
  }
}

export async function getStoredPushToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  } catch (error) {
    return null;
  }
}

export async function storePushTokenOnBackend(
  pushToken: string,
  authToken: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      "https://api.amana.io/user/push-token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ pushToken }),
      },
    );

    return response.ok;
  } catch (error) {
    return false;
  }
}

export function setupNotificationListeners(
  onNotificationTap: (data: NotificationData) => void,
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data as NotificationData;
      onNotificationTap(data);
    },
  );

  return () => subscription.remove();
}

export function setupForegroundNotificationHandler(
  onNotification: (notification: Notifications.Notification) => void,
): () => void {
  const subscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      onNotification(notification);
    },
  );

  return () => subscription.remove();
}

export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: NotificationData,
): Promise<string> {
  const { identifier } = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data || {},
      sound: true,
    },
    trigger: null,
  });

  return identifier;
}

export async function checkNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted";
}
