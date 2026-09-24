import { readFileSync } from "node:fs";
import type { BrokerCreds } from "@/lib/scanner/types";

let fileEnv: Record<string, string> | null = null;

function fileSecrets(): Record<string, string> {
  if (fileEnv) return fileEnv;
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* 배포 환경은 process.env 만 사용 */
  }
  fileEnv = out;
  return out;
}

export function readSecret(...keys: string[]): string | null {
  for (const key of keys) {
    const v = process.env[key]?.trim() || fileSecrets()[key];
    if (v) return v;
  }
  return null;
}

export function resolveKisCreds(appKey?: string, appSecret?: string): BrokerCreds {
  const ck = appKey?.trim() ?? "";
  const cs = appSecret?.trim() ?? "";
  if (ck.length >= 8 && cs.length >= 8) return { appKey: ck, appSecret: cs };
  const ek = readSecret("KIS_APP_KEY", "APP_KEY");
  const es = readSecret("KIS_APP_SECRET", "KIS_SECRET_KEY", "SECRET_KEY");
  if (ek && es && ek.length >= 8 && es.length >= 8) return { appKey: ek, appSecret: es };
  throw new Error("KIS 키가 없습니다. Render Environment에 KIS_APP_KEY, KIS_APP_SECRET 을 넣으세요. 코드에는 넣지 마세요.");
}

export function kisKeyStatus(): { configured: boolean; mask: string | null; dart: boolean } {
  const dart = Boolean(readSecret("DART_API_KEY"));
  try {
    const c = resolveKisCreds();
    const t = c.appKey.trim();
    return {
      configured: true,
      mask: t.length <= 8 ? "••••" : `${t.slice(0, 4)}····${t.slice(-4)}`,
      dart,
    };
  } catch {
    return { configured: false, mask: null, dart };
  }
}
