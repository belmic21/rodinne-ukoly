/* ═══════════════════════════════════════════════════════
   OBCHOD — společné styly a drobné pomůcky

   Schválně nic neimportuje z App.jsx. Modul dostane barvy
   zvenčí jako `theme` a jinak si vystačí sám — díky tomu
   se dá upravovat, aniž by se sáhlo do hlavního souboru.
   ═══════════════════════════════════════════════════════ */

import { useEffect } from "react";

/* Verze modulu. Je schválně oddělená od verze v App.jsx:
   obchod se dá aktualizovat samostatně, aniž by se sahalo
   do hlavního souboru, a podle tohohle čísla poznáš,
   která verze modulu je nasazená. Ukazuje se v hlavičce okna. */
export const OBCHOD_VERZE = "261008_1310";

export const FONT = "'DM Sans', system-ui, sans-serif";

export const card = (th) => ({
  background: th.card,
  border: `1px solid ${th.cardBorder}`,
  borderRadius: "12px",
});

export const input = (th) => ({
  background: th.inputBg,
  border: `1px solid ${th.inputBorder}`,
  borderRadius: "8px",
  color: th.text,
  padding: "8px 10px",
  fontSize: "13px",
  fontFamily: FONT,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
});

export const btn = () => ({
  border: "none",
  borderRadius: "8px",
  fontFamily: FONT,
  fontWeight: 600,
  cursor: "pointer",
});

export const btnMain = (th) => ({
  ...btn(),
  background: th.accent,
  color: "#fff",
  padding: "7px 14px",
  fontSize: "12px",
  fontWeight: 700,
});

export const btnGhost = (th) => ({
  ...btn(),
  background: "transparent",
  color: th.textSub,
  border: `1px solid ${th.cardBorder}`,
  padding: "6px 11px",
  fontSize: "12px",
});

export const label = (th) => ({
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: th.textSub,
  marginBottom: 3,
  display: "block",
});

export function useEscapeKey(handler, enabled = true) {
  useEffect(() => {
    if (!enabled || !handler) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); handler(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handler, enabled]);
}

/* ── Peníze ──────────────────────────────────────────────
   V seznamu se nehodí vypisovat 3 500 000, ale 3,5 mil.
   V detailu naopak chceš vidět přesné číslo. */

export function penizeKratce(n) {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!isFinite(v)) return "—";
  if (v >= 1e9) return trim(v / 1e9) + " mld";
  if (v >= 1e6) return trim(v / 1e6) + " mil";
  if (v >= 1e3) return trim(v / 1e3) + " tis";
  return trim(v);
}

export function penizePresne(n) {
  if (n === null || n === undefined || n === "") return "";
  const v = Number(n);
  if (!isFinite(v)) return "";
  return v.toLocaleString("cs-CZ");
}

function trim(x) {
  const r = Math.round(x * 10) / 10;
  return String(r).replace(".", ",");
}

/* Čte, co člověk napsal: "3,5 mil", "90 mil", "1,2 mld",
   "3500000", "3 500 000". Vrátí číslo nebo null. */
export function parsePenize(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim().toLowerCase().replace(/\s/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+(?:[.,]\d+)?)(mld|mil|mln|tis|k|m)?$/);
  if (!m) return null;
  const cislo = parseFloat(m[1].replace(",", "."));
  if (!isFinite(cislo)) return null;
  switch (m[2]) {
    case "mld": return Math.round(cislo * 1e9);
    case "mil":
    case "mln":
    case "m":   return Math.round(cislo * 1e6);
    case "tis":
    case "k":   return Math.round(cislo * 1e3);
    default:    return Math.round(cislo);
  }
}

export function datumKratce(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "2-digit" });
}

/* Kolik dní je to staré — "dnes", "včera", "před 5 dny" */
export function jakDavno(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dni = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dni <= 0) return "dnes";
  if (dni === 1) return "včera";
  if (dni < 5) return `před ${dni} dny`;
  return `před ${dni} dny`;
}

/* Počet s českým tvarem: 1 položka, 2 položky, 5 položek. */
export function pocet(n, jedna, dve, pet) {
  const x = Number(n) || 0;
  if (x === 1) return `${x} ${jedna}`;
  if (x >= 2 && x <= 4) return `${x} ${dve}`;
  return `${x} ${pet}`;
}
