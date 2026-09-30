import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const PUSH_TOKEN_KEY = "amana_push_token";
const OPT_IN_PREFERENCE_KEY = "amana_notification_opt_in";
const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000";

export type NotificationOptInPreference = "granted" | "denied" | "unset";

export interface NotificationData {
  type?: "trade" | "dispute" | "general";
  tradeId?: string;
  disputeId?: string;
  screen?: string;
}

/**
 * Reads the user's in-app opt-in preference. This is distinct from the OS
 * permission status: a user can grant OS notification permission but still
 * choose to opt out of notifications within the app (e.g. via a settings
 * toggle), and this preference is what we honor for that case.
 */
export async function getNotificationOptInPreference(): Promise<NotificationOptInPreference> {
  try {
    const value = await SecureStore.getItemAsync(OPT_IN_PREFERENCE_KEY);
    if (value === "granted" || value === "denied") {
      return value;
    }
    return "unset";
  } catch {
    return "unset";
  }
}

async function setNotificationOptInPreference(
  preference: NotificationOptInPreference,
): Promise<void> {
  try {
    await SecureStore.setItemAsync(OPT_IN_PREFERENCE_KEY, preference);
  } catch {
    // Best-effort persistence; a failure here just means we'll re-check next launch.
  }
}

// The handler only controls how a notification is displayed once we've
// already decided to show it (foreground alert/sound/badge). Whether we
// register for notifications at all is gated separately by the user's
// opt-in preference below.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Ensures the Android notification channel exists. Safe to call multiple
 * times and independent of permission status — channels can be configured
 * before permission is granted.
 */
export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync("default", {
    name: "default",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#FF231F7C",
  });
}

/**
 * Returns the current OS-level permission status without prompting the
 * user.
 */
export async function getNotificationPermissionStatus(): Promise<Notifications.PermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * Requests OS notification permission if not already determined, then
 * (when granted) fetches and persists the Expo push token. This is the
 * function that should back an explicit "enable notifications" opt-in
 * action in the UI — it surfaces the native permission prompt on first
 * call.
 *
 * On success, also records the user's in-app opt-in preference as
 * "granted"; on denial, records "denied" so the UI has a single source of
 * truth to render an opt-in prompt vs. a "notifications disabled" state.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    await ensureAndroidNotificationChannel();

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      await setNotificationOptInPreference("denied");
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync();
    const pushToken = token.data;

    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, pushToken);
    await setNotificationOptInPreference("granted");
    return pushToken;
  } catch {
    return null;
  }
}

/**
 * Lets the user opt out of notifications from within the app (e.g. a
 * settings toggle). We can't revoke OS permission programmatically, so this
 * clears the locally stored push token and records the preference as
 * "denied" so the app stops treating the user as subscribed (and callers
 * should stop sending the token to the backend / re-registering it).
 */
export async function optOutOfNotifications(): Promise<void> {
  await setNotificationOptInPreference("denied");
  try {
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  } catch {
    // Ignore — nothing to clean up if it was never stored.
  }
}

/**
 * Re-enables notifications after a prior in-app opt-out, re-registering for
 * a push token (which may re-prompt for OS permission if it was never
 * determined, or resolve immediately if it was already granted).
 */
export async function optInToNotifications(): Promise<string | null> {
  return registerForPushNotifications();
}

export async function getStoredPushToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function storePushTokenOnBackend(
  pushToken: string,
  authToken: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${API_URL}/user/push-token`,
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
  } catch {
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
  const identifier = await Notifications.scheduleNotificationAsync({
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

/**
 * @deprecated Use `getNotificationPermissionStatus` (to check without
 * prompting) together with `ensureAndroidNotificationChannel`, or
 * `registerForPushNotifications` (to check-and-request in one call). Kept
 * for backward compatibility with existing call sites.
 */
export async function checkNotificationPermissions(): Promise<boolean> {
  await ensureAndroidNotificationChannel();
  const status = await getNotificationPermissionStatus();
  return status === "granted";
}
