/* ═══════════════════════════════════════════════════════
   OBCHOD — dotazy do databáze

   Každá funkce vrací buď data, nebo { ok: false, chyba }.
   Nikdy nevyhazuje výjimku ven — obrazovka se tím pádem
   nerozsype ani při výpadku sítě.
   ═══════════════════════════════════════════════════════ */

import { supabase } from "../supabase.js";

function selhalo(kde, e) {
  console.warn(`[obchod/${kde}]`, e?.message || e);
  return { ok: false, chyba: e?.message || "Nepodařilo se spojit s databází." };
}

/* ── Číselníky ───────────────────────────────────────────
   Jedna tabulka pro všechny seznamy. Načte se jednou při
   otevření a drží se v paměti — jsou to desítky řádků. */

export async function nactiCiselniky(owner) {
  if (!owner) return {};
  try {
    const { data, error } = await supabase
      .from("deal_enums")
      .select("id, kind, key, label, skupina, sort_order, active")
      .eq("owner", owner)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    const out = {};
    for (const r of data || []) {
      (out[r.kind] = out[r.kind] || []).push(r);
    }
    return out;
  } catch (e) {
    selhalo("nactiCiselniky", e);
    return {};
  }
}

// Popisek podle klíče. Když položka chybí, vrátí klíč — radši
// ošklivé než prázdné místo, ať je poznat, že něco nesedí.
export function popis(ciselniky, kind, key) {
  if (!key) return "";
  const r = (ciselniky?.[kind] || []).find(x => x.key === key);
  return r ? r.label : key;
}

export function aktivni(ciselniky, kind) {
  return (ciselniky?.[kind] || []).filter(x => x.active);
}

/* ── Panel ───────────────────────────────────────────── */

export async function nactiPanel(owner) {
  if (!owner) return null;
  try {
    const { data, error } = await supabase.rpc("deal_overview", { p_owner: owner });
    if (error) throw error;
    return (data && data[0]) || null;
  } catch (e) {
    selhalo("nactiPanel", e);
    return null;
  }
}

/* ── Zakázky ─────────────────────────────────────────── */

const SLOUPCE = `
  id, cislo, kod, nazev, typ, velikost, jednotka,
  zeme, kraj, mesto, lokalita_text, faze, cena, mena,
  odmena, stav, souhrn, slozka_odkaz, navazuje_na,
  created_at, updated_at
`;

export async function nactiZakazky(owner, filtr = {}, limit = 50, offset = 0) {
  if (!owner) return [];
  try {
    let q = supabase
      .from("deal_projects")
      .select(SLOUPCE)
      .eq("owner", owner)
      .is("deleted_at", null);

    if (filtr.typ)       q = q.eq("typ", filtr.typ);
    if (filtr.kraj)      q = q.eq("kraj", filtr.kraj);
    if (filtr.faze)      q = q.eq("faze", filtr.faze);
    if (filtr.stav)      q = q.eq("stav", filtr.stav);
    if (filtr.cenaOd != null)     q = q.gte("cena", filtr.cenaOd);
    if (filtr.cenaDo != null)     q = q.lte("cena", filtr.cenaDo);
    // Velikost se filtruje prahem: "nad 50" vrátí i 85 a 100.
    if (filtr.velikostOd != null) q = q.gte("velikost", filtr.velikostOd);

    const h = (filtr.hledat || "").trim();
    if (h) {
      const v = h.replace(/[%,]/g, " ");
      q = q.or(
        `kod.ilike.%${v}%,nazev.ilike.%${v}%,mesto.ilike.%${v}%,` +
        `lokalita_text.ilike.%${v}%,souhrn.ilike.%${v}%`
      );
    }

    const { data, error } = await q
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("nactiZakazky", e);
    return [];
  }
}

export async function nactiZakazku(id) {
  if (!id) return null;
  try {
    const { data, error } = await supabase
      .from("deal_projects").select(SLOUPCE).eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  } catch (e) {
    selhalo("nactiZakazku", e);
    return null;
  }
}

export async function zalozZakazku(owner, data) {
  if (!owner || !data?.nazev) return { ok: false, chyba: "Chybí název." };
  try {
    const { data: row, error } = await supabase
      .from("deal_projects")
      .insert({ ...ocisti(data), owner })
      .select(SLOUPCE)
      .single();
    if (error) throw error;
    return { ok: true, zakazka: row };
  } catch (e) {
    return selhalo("zalozZakazku", e);
  }
}

export async function upravZakazku(id, patch) {
  if (!id) return { ok: false, chyba: "Chybí ID." };
  try {
    const { data, error } = await supabase
      .from("deal_projects")
      .update(ocisti(patch))
      .eq("id", id)
      .select(SLOUPCE)
      .single();
    if (error) throw error;
    return { ok: true, zakazka: data };
  } catch (e) {
    return selhalo("upravZakazku", e);
  }
}

// Mazání je měkké — řádek zůstane, jen se schová. Zakázka nese
// číslo, podle kterého jsou pojmenované složky na disku, a to
// se nesmí ztratit kvůli ukliknutí.
export async function smazZakazku(id) {
  if (!id) return { ok: false, chyba: "Chybí ID." };
  try {
    const { data, error } = await supabase
      .from("deal_projects")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return { ok: false, chyba: "Zakázka se nenašla nebo ti nepatří." };
    }
    return { ok: true };
  } catch (e) {
    return selhalo("smazZakazku", e);
  }
}

// Prázdný text do databáze patří jako prázdná hodnota, ne jako "".
// Jinak by filtry a kontroly braly mezeru jako vyplněný údaj.
function ocisti(d) {
  const out = {};
  for (const [k, v] of Object.entries(d || {})) {
    if (v === "" || v === undefined) out[k] = null;
    else out[k] = v;
  }
  delete out.id;
  delete out.owner;
  delete out.cislo;
  delete out.kod;
  delete out.created_at;
  delete out.updated_at;
  return out;
}

/* ── Lidé ────────────────────────────────────────────────
   Investoři nejsou zvláštní tabulka — jsou to lidé z Mapy.
   Tady se jen hledají, aby se k nim dala přivěsit karta. */

export async function hledejLidi(owner, query = "", limit = 20) {
  if (!owner) return [];
  try {
    const { data, error } = await supabase.rpc("map_people_search", {
      p_owner: owner, p_query: query || "", p_limit: limit,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("hledejLidi", e);
    return [];
  }
}

export async function nactiOsobu(id) {
  if (!id) return null;
  try {
    const { data, error } = await supabase
      .from("map_people")
      .select("id, name, aliases, note, met_at, contact, role_tagy")
      .eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  } catch (e) {
    selhalo("nactiOsobu", e);
    return null;
  }
}

// Profilové role: čím je člověk obecně. Role v konkrétní zakázce
// jsou jinde — Radek je obecně investor i developer, ale v jedné
// zakázce je právě jedním z nich.
export async function ulozRole(personId, role) {
  if (!personId) return { ok: false, chyba: "Chybí osoba." };
  try {
    const { data, error } = await supabase
      .from("map_people")
      .update({ role_tagy: role || [] })
      .eq("id", personId)
      .select("id, role_tagy");
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, chyba: "Osoba se nenašla." };
    return { ok: true, role: data[0].role_tagy };
  } catch (e) {
    return selhalo("ulozRole", e);
  }
}

/* ── Karty ───────────────────────────────────────────── */

const KARTA = `
  id, person_id, smer, nazev, typy, kraje, cena_od, cena_do,
  velikost_od, jednotka, faze_min, pro_koho, poznamka,
  plati_od, plati_do, aktivni, created_at, updated_at,
  osoba:map_people (id, name, role_tagy)
`;

export async function nactiKarty(owner, filtr = {}, limit = 200) {
  if (!owner) return [];
  try {
    let q = supabase.from("deal_cards").select(KARTA).eq("owner", owner);
    if (filtr.smer)    q = q.eq("smer", filtr.smer);
    if (filtr.personId) q = q.eq("person_id", filtr.personId);
    if (filtr.jenAktivni) q = q.eq("aktivni", true);
    // Pole se filtruje překryvem: karta s více typy se najde podle kteréhokoli.
    if (filtr.typ)  q = q.contains("typy", [filtr.typ]);
    if (filtr.kraj) q = q.contains("kraje", [filtr.kraj]);

    const { data, error } = await q
      .order("aktivni", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("nactiKarty", e);
    return [];
  }
}

export async function ulozKartu(owner, data) {
  if (!owner || !data?.person_id) return { ok: false, chyba: "Chybí člověk." };
  const telo = {
    smer: data.smer || "poptavka",
    nazev: prazdnoNaNull(data.nazev),
    typy: data.typy || [],
    kraje: data.kraje || [],
    cena_od: cislo(data.cena_od),
    cena_do: cislo(data.cena_do),
    velikost_od: cislo(data.velikost_od),
    jednotka: prazdnoNaNull(data.jednotka),
    faze_min: prazdnoNaNull(data.faze_min),
    pro_koho: prazdnoNaNull(data.pro_koho),
    poznamka: prazdnoNaNull(data.poznamka),
    plati_do: prazdnoNaNull(data.plati_do),
    aktivni: data.aktivni !== false,
  };
  try {
    const q = data.id
      ? supabase.from("deal_cards").update(telo).eq("id", data.id)
      : supabase.from("deal_cards").insert({ ...telo, owner, person_id: data.person_id });
    const { data: row, error } = await q.select(KARTA).single();
    if (error) throw error;
    return { ok: true, karta: row };
  } catch (e) {
    return selhalo("ulozKartu", e);
  }
}

export async function smazKartu(id) {
  if (!id) return { ok: false, chyba: "Chybí ID." };
  try {
    const { data, error } = await supabase
      .from("deal_cards").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, chyba: "Karta se nenašla." };
    return { ok: true };
  } catch (e) {
    return selhalo("smazKartu", e);
  }
}

function prazdnoNaNull(v) {
  return (v === "" || v === undefined) ? null : v;
}

function cislo(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/* ── Párování ────────────────────────────────────────── */

export async function komuToPasuje(projectId, limit = 30) {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase.rpc("deal_match_people", {
      p_project_id: projectId, p_limit: limit,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("komuToPasuje", e);
    return [];
  }
}

export async function kdoToSezene(owner, typy = [], kraje = [], limit = 30) {
  if (!owner) return [];
  try {
    const { data, error } = await supabase.rpc("deal_match_sources", {
      p_owner: owner, p_typy: typy, p_kraje: kraje, p_limit: limit,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("kdoToSezene", e);
    return [];
  }
}

/* ── Rychlé zadání ───────────────────────────────────────
   Z věty "rodinný dům Beroun 3,5 mil" vytáhne, co umí, a zbytek
   nechá na tobě. Schválně nic nehádá do databáze — jen předvyplní
   formulář, kde to vidíš a můžeš opravit. */

export function rozeberVetu(text, ciselniky) {
  const puvodni = (text || "").trim();
  if (!puvodni) return { nazev: "" };

  let zbytek = puvodni;
  const out = {};

  // Cena: poslední číslo s jednotkou v textu
  const cenaRe = /(\d+(?:[.,]\d+)?)\s*(mld|mil|mln|tis)\b/gi;
  let m, posledni = null;
  while ((m = cenaRe.exec(puvodni)) !== null) posledni = m;
  if (posledni) {
    const n = parseFloat(posledni[1].replace(",", "."));
    const jed = posledni[2].toLowerCase();
    out.cena = Math.round(n * (jed === "mld" ? 1e9 : jed === "tis" ? 1e3 : 1e6));
    zbytek = zbytek.replace(posledni[0], " ");
  }

  // Typ nemovitosti podle popisku v číselníku
  const typy = (ciselniky?.typ || []).filter(t => t.active);
  const bezDiakritiky = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const zbytekN = bezDiakritiky(zbytek);
  let nejdelsi = null;
  for (const t of typy) {
    const ln = bezDiakritiky(t.label);
    if (ln.length >= 4 && zbytekN.includes(ln)) {
      if (!nejdelsi || ln.length > bezDiakritiky(nejdelsi.label).length) nejdelsi = t;
    }
  }
  if (nejdelsi) {
    out.typ = nejdelsi.key;
    const i = zbytekN.indexOf(bezDiakritiky(nejdelsi.label));
    zbytek = zbytek.slice(0, i) + " " + zbytek.slice(i + nejdelsi.label.length);
  }

  // Velikost: "85 bytů", "8000 m2"
  const velRe = /(\d+(?:[.,]\d+)?)\s*(byt\w*|m2|m²|ha|lůžk\w*|luzk\w*)/i;
  const mv = zbytek.match(velRe);
  if (mv) {
    out.velikost = parseFloat(mv[1].replace(",", "."));
    const j = mv[2].toLowerCase();
    out.jednotka = j.startsWith("byt") ? "byt"
      : (j === "m2" || j === "m²") ? "m2"
      : j === "ha" ? "ha" : "luzko";
    zbytek = zbytek.replace(mv[0], " ");
  }

  out.nazev = zbytek.replace(/\s+/g, " ").trim() || puvodni;
  return out;
}
