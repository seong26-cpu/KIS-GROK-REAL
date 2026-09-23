/** ETF·ETN·레버리지 상품 종목명 */
const ETF_NAME_RE =
  /ETF|ETN|KODEX|TIGER|KBSTAR|KOSEF|\bACE\b|\bSOL\b|HANARO|TIMEFOLIO|ARIRANG|KINDEX|KOACT|마이티|에셋플러스|인버스|레버리지|합성|\bPLUS\b|\bRISE\b|\bSMART\b|\bTREX\b|\bFOCUS\b|\bKIWOOM\b|\b1Q\b/i;

const SPAC_RE = /스팩|SPAC/i;
const ADMIN_RE = /관리종목|\(관리\)|정리매매|투자위험|투자경고/;

export function isEtfName(name: string): boolean {
  return ETF_NAME_RE.test(name);
}

export function isSpacName(name: string): boolean {
  return SPAC_RE.test(name);
}

export function isAdminName(name: string): boolean {
  return ADMIN_RE.test(name);
}

export function exclusionReason(opts: {
  code: string;
  name: string;
  etfCodes?: Set<string>;
  adminCodes?: Set<string>;
  newListedCodes?: Set<string>;
}): string | null {
  const code = opts.code.padStart(6, "0");
  const name = opts.name.trim();
  if (opts.etfCodes?.has(code) || isEtfName(name)) return "ETF/ETN";
  if (opts.adminCodes?.has(code) || isAdminName(name)) return "관리";
  if (isSpacName(name) || opts.newListedCodes?.has(code)) return "신규상장";
  return null;
}

export async function fetchNaverEtfCodes(): Promise<Set<string>> {
  const codes = new Set<string>();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch("https://finance.naver.com/api/sise/etfItemList.nhn", {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!resp.ok) return codes;
    const json = (await resp.json()) as {
      result?: { etfItemList?: { itemcode?: string }[] };
    };
    for (const row of json.result?.etfItemList ?? []) {
      const c = String(row.itemcode ?? "").padStart(6, "0");
      if (/^\d{6}$/.test(c)) codes.add(c);
    }
  } catch {
    /* keep empty — name filter still applies */
  } finally {
    clearTimeout(t);
  }
  return codes;
}
