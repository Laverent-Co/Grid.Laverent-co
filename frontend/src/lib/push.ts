import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";

const USER_ID_KEY = "cryptobot.rc_user_id";

async function getUserId(): Promise<string | null> {
  const v = await storage.secureGet<string>(USER_ID_KEY, "" as any);
  return v ? String(v) : null;
}

/** Ask permissions, fetch native token, POST to backend. No-op on web / Expo Go. */
export async function registerForPushOnce(): Promise<void> {
  if (Platform.OS === "web") return;
  if (!Device.isDevice) return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    let status = perm.status;
    if (status !== "granted" && perm.canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return;
    const token = await Notifications.getDevicePushTokenAsync();
    const userId = (await getUserId()) || `anon-${Date.now()}`;
    await api("/register-push", {
      body: { user_id: userId, platform: Platform.OS, device_token: token.data },
      auth: false,
    });
  } catch {
    // Registration failure must never block the app.
  }
}
