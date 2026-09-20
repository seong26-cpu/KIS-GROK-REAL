import type { BrokerCreds } from "./types";

const STORAGE_KEY = "kis-scanner-creds-v1";
const LEGACY_KEY = "kb-scanner-creds-v1";

export function loadCreds(): BrokerCreds | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrokerCreds>;
    if (!parsed.appKey || !parsed.appSecret) return null;
    return {
      appKey: String(parsed.appKey),
      appSecret: String(parsed.appSecret),
    };
  } catch {
    return null;
  }
}

export function saveCreds(creds: BrokerCreds) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ appKey: creds.appKey, appSecret: creds.appSecret }));
}

export function clearCreds() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
}

export function maskKey(key: string): string {
  const t = key.trim();
  if (t.length <= 8) return "••••";
  return `${t.slice(0, 4)}····${t.slice(-4)}`;
}
