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
export const OBCHOD_VERZE = "261009_1210";

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

/* Kdy to vzniklo. Do týdne se líp čte "před 3 dny", starší věci
   potřebují datum — "před 94 dny" si nikdo nepřeloží. */
export function kdyZadano(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dni = Math.floor((Date.now() - d.getTime()) / 86400000);
  return dni <= 7 ? jakDavno(iso) : datumKratce(iso);
}

/* Datum i čas. U zápisů k zakázce je důležité pořadí v rámci dne —
   "ráno volal, odpoledne poslal podklady" se bez času nepozná. */
export function kdyPresne(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dnes = new Date(); dnes.setHours(0, 0, 0, 0);
  const cas = d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  if (d >= dnes) return `dnes ${cas}`;
  const vcera = new Date(dnes); vcera.setDate(vcera.getDate() - 1);
  if (d >= vcera) return `včera ${cas}`;
  return `${datumKratce(iso)} ${cas}`;
}

/* Název měsíce pro graf: "9/26". Celé "září 2026" by se do sloupce
   nevešlo a pod dvanácti sloupci by se popisky překrývaly. */
export function mesicKratce(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

/* Rozseká text na kusy podle hledaného výrazu, ať jde shoda
   zvýraznit. Porovnává se bez diakritiky — "komin" najde "komínem"
   — ale vrací se původní text, aby se nezkomolil. */
export function zvyrazni(text, dotaz) {
  const t = String(text || "");
  const q = String(dotaz || "").trim();
  if (!q) return [{ text: t, shoda: false }];
  const bez = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const tn = bez(t), qn = bez(q);
  const kusy = [];
  let i = 0;
  while (i < t.length) {
    const j = tn.indexOf(qn, i);
    if (j < 0 || !qn) { kusy.push({ text: t.slice(i), shoda: false }); break; }
    if (j > i) kusy.push({ text: t.slice(i, j), shoda: false });
    kusy.push({ text: t.slice(j, j + q.length), shoda: true });
    i = j + q.length;
  }
  return kusy.length ? kusy : [{ text: t, shoda: false }];
}

/* "12:00" z "12:00:00" i z "12:00". Prázdno znamená celý den. */
export function casKratce(cas) {
  if (!cas) return "";
  const m = String(cas).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${Number(m[1])}:${m[2]}` : "";
}

/* Kolik zbývá. Do hodiny minuty, do dne hodiny, dál dny — "za 180 min"
   si nikdo nepřeloží, stejně jako "za 0,02 dne". Záporné je po termínu.

   minut počítá databáze, aby "do dvanácti" znamenalo dvanáct na serveru,
   ne na notebooku přestaveném na jiné pásmo. */
export function zbyvaPopis(minut, cas) {
  const m = Number(minut);
  if (!isFinite(m)) return "";
  const a = Math.abs(m);
  const text =
    a < 60   ? `${Math.round(a)} min`
  : a < 1440 ? `${Math.round(a / 60)} h`
  : `${Math.round(a / 1440)} ${Math.round(a / 1440) === 1 ? "den" : Math.round(a / 1440) < 5 ? "dny" : "dní"}`;
  if (m < 0) return `${text} po termínu`;
  // Bez hodiny je "za 14 h" falešná přesnost — termín platí na celý den.
  if (!cas && a < 1440) return "dnes";
  return `za ${text}`;
}

/* Odznaky u zakázky: kolik na ní visí úkolů, poznámek a termínů.
   Jen ikona a číslo — na řádek seznamu se víc nevejde a stejně
   jde o jediné: je na té zakázce něco rozdělaného, nebo ne?
   Nula se nekreslí. Prázdný odznak by jen zabíral místo. */
export const ODZNAKY = [
  { k: "ukolu",    ikona: "☑", popis: "nesplněné úkoly" },
  { k: "poznamek", ikona: "📝", popis: "poznámky" },
  { k: "terminu",  ikona: "⏳", popis: "nesplněné termíny" },
];

/* Počet s českým tvarem: 1 položka, 2 položky, 5 položek. */
export function pocet(n, jedna, dve, pet) {
  const x = Number(n) || 0;
  if (x === 1) return `${x} ${jedna}`;
  if (x >= 2 && x <= 4) return `${x} ${dve}`;
  return `${x} ${pet}`;
}
