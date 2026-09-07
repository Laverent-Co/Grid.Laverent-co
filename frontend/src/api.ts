import { storage } from "@/src/utils/storage";

const TOKEN_KEY = "cryptobot.session_token";
const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export async function getToken(): Promise<string | null> {
  return storage.secureGet<string>(TOKEN_KEY, "" as any).then((v) => (v ? String(v) : null));
}

export async function setToken(token: string | null): Promise<void> {
  if (token == null) {
    await storage.secureRemove(TOKEN_KEY);
  } else {
    await storage.secureSet(TOKEN_KEY, token);
  }
}

type Options = { method?: string; body?: any; auth?: boolean };

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== false) {
    const t = await getToken();
    if (t) headers["X-Session-Token"] = t;
  }
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err: any = new Error(data?.detail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export const backendUrl = BASE_URL;
