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

/* ── Člověk ze všech stran ───────────────────────────────
   Davidovi volá klient. Potřebuje za pár vteřin vidět, co
   s ním běží, kdy naposledy a za kolik — nezávisle na tom,
   jestli je to majitel, prostředník nebo investor.

   Role se v řetězci posouvá: klient je pro Davida majitel,
   David je pro tebe prostředník. Proto se u každé zakázky
   ukazuje role, kterou tam má, ne jedna role napevno. */

export async function osobaPrehled(owner, personId) {
  if (!owner || !personId) return null;
  const prazdne = { osoba: null, ucast: [], osloveni: [], karty: [], zaznamy: [] };
  try {
    const projekt = "projekt:deal_projects (id, kod, nazev, typ, kraj, mesto, cena, stav, faze, created_at)";
    const [osoba, ucast, osloveni, karty, zaznamy] = await Promise.all([
      supabase.from("map_people")
        .select("id, name, aliases, note, met_at, contact, role_tagy, introduced_by")
        .eq("id", personId).maybeSingle(),
      // Bez filtru na vlastníka: u zakázky ve spolupráci patří k člověku
      // i to, co zapsal partner. Co vidět nemáš, ti databáze nevydá.
      supabase.from("deal_participants")
        .select(`id, owner, role, podil, poradi, forma_dohody, poznamka, ${projekt}`)
        .eq("person_id", personId),
      supabase.from("deal_approaches")
        .select(`id, owner, stav, aktualne, aktualne_at, odeslano_at, cena_jednana,
                 pripominka_at, poznamka, ${projekt}`)
        .eq("person_id", personId).is("deleted_at", null),
      supabase.from("deal_cards")
        .select("id, smer, nazev, typy, kraje, cena_od, cena_do, velikost_od, jednotka, aktivni, poznamka")
        .eq("owner", owner).eq("person_id", personId),
      supabase.from("map_facts")
        .select("id, owner, content, context, happened_at, projekt:deal_projects (kod, nazev)")
        .eq("person_id", personId)
        .order("happened_at", { ascending: false }).limit(60),
    ]);
    return {
      osoba: osoba.data || null,
      ucast: ucast.data || [],
      osloveni: osloveni.data || [],
      karty: karty.data || [],
      zaznamy: zaznamy.data || [],
    };
  } catch (e) {
    selhalo("osobaPrehled", e);
    return prazdne;
  }
}

/* ── Úpravy číselníků ────────────────────────────────────
   Kde se který seznam v datech používá. Podle toho se pozná,
   jestli jde položka smazat, nebo se má jen vypnout. */

const POUZITI = {
  typ:           [["deal_projects", "typ"], ["deal_cards", "typy", true]],
  faze:          [["deal_projects", "faze"], ["deal_cards", "faze_min"]],
  kraj:          [["deal_projects", "kraj"], ["deal_cards", "kraje", true]],
  jednotka:      [["deal_projects", "jednotka"], ["deal_cards", "jednotka"]],
  stav_zakazky:  [["deal_projects", "stav"]],
  stav_osloveni: [["deal_approaches", "stav"]],
  forma_dohody:  [["deal_participants", "forma_dohody"]],
  role:          [["deal_participants", "role"], ["map_people", "role_tagy", true]],
};

export async function pouzitiCiselniku(owner, kind, key) {
  let celkem = 0;
  for (const [tabulka, sloupec, pole] of (POUZITI[kind] || [])) {
    try {
      let q = supabase.from(tabulka).select("id", { count: "exact", head: true }).eq("owner", owner);
      q = pole ? q.contains(sloupec, [key]) : q.eq(sloupec, key);
      const { count, error } = await q;
      if (error) throw error;
      celkem += count || 0;
    } catch (e) {
      // Když se počet nepodaří zjistit, tváříme se, že položka použitá je.
      // Radši nechat smazání nedostupné než něco osiřet.
      console.warn("[obchod/pouzitiCiselniku]", e?.message || e);
      return -1;
    }
  }
  return celkem;
}

// Z popisku udělá neměnný klíč: "Před rekonstrukcí" → "pred_rekonstrukci".
// Klíč je to, co je zapsané v datech; popisek se dá přejmenovat kdykoli,
// klíč nikdy.
export function naKlic(label, obsazene = []) {
  const zaklad = (label || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .slice(0, 40) || "polozka";
  if (!obsazene.includes(zaklad)) return zaklad;
  let i = 2;
  while (obsazene.includes(`${zaklad}_${i}`)) i++;
  return `${zaklad}_${i}`;
}

export async function ulozCiselnik(owner, data) {
  const label = (data?.label || "").trim();
  if (!owner || !data?.kind || !label) return { ok: false, chyba: "Chybí název." };
  const telo = {
    label,
    skupina: prazdnoNaNull(data.skupina),
    sort_order: cislo(data.sort_order) ?? 100,
    active: data.active !== false,
  };
  try {
    const q = data.id
      ? supabase.from("deal_enums").update(telo).eq("id", data.id)
      : supabase.from("deal_enums").insert({
          ...telo, owner, kind: data.kind, key: data.key,
        });
    const { data: row, error } = await q.select("*").single();
    if (error) throw error;
    return { ok: true, polozka: row };
  } catch (e) {
    if (String(e?.code) === "23505") {
      return { ok: false, chyba: "Položka s tímhle klíčem už v seznamu je." };
    }
    return selhalo("ulozCiselnik", e);
  }
}

export async function smazCiselnik(owner, polozka) {
  if (!polozka?.id) return { ok: false, chyba: "Chybí ID." };
  const pouzito = await pouzitiCiselniku(owner, polozka.kind, polozka.key);
  if (pouzito !== 0) {
    return {
      ok: false,
      chyba: pouzito > 0
        ? `Používá se u ${pouzito} záznamů. Smazat nejde — vypni ji, zůstane u starých dat a nově ji nepůjde vybrat.`
        : "Nepodařilo se ověřit, jestli se položka používá. Radši ji jen vypni.",
    };
  }
  try {
    const { data, error } = await supabase
      .from("deal_enums").delete().eq("id", polozka.id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, chyba: "Nenašlo se." };
    return { ok: true };
  } catch (e) {
    return selhalo("smazCiselnik", e);
  }
}

// Přeskládání: přepíše pořadí celé skupiny najednou, ať v něm
// nevzniknou díry a shodná čísla.
export async function prerovnejCiselnik(polozky) {
  try {
    for (let i = 0; i < polozky.length; i++) {
      const { error } = await supabase
        .from("deal_enums").update({ sort_order: (i + 1) * 10 }).eq("id", polozky[i].id);
      if (error) throw error;
    }
    return { ok: true };
  } catch (e) {
    return selhalo("prerovnejCiselnik", e);
  }
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
  id, owner, cislo, kod, nazev, typ, velikost, jednotka,
  zeme, kraj, mesto, lokalita_text, faze, cena, mena,
  odmena, stav, souhrn, slozka_odkaz, navazuje_na,
  created_at, updated_at
`;

/* Jsem správce? Ptáme se databáze, ne přihlášení — příznak
   v aplikaci by se dal podvrhnout, odpověď funkce ne.

   Schválně se neukládá do paměti modulu. Odpověď patří
   přihlášenému, a kdyby se v jedné záložce někdo odhlásil
   a přihlásil druhý, zdědil by cizí práva. Je to jeden dotaz
   při otevření okna, ne nic, na čem by se dalo šetřit. */
export async function jsemSpravce() {
  try {
    const { data, error } = await supabase.rpc("je_spravce");
    if (error) throw error;
    return !!data;
  } catch (e) {
    selhalo("jsemSpravce", e);
    return false;
  }
}

export async function nactiZakazky(owner, filtr = {}, limit = 50, offset = 0) {
  if (!owner) return [];
  try {
    let q = supabase
      .from("deal_projects")
      .select(SLOUPCE)
      .eq("owner", owner)
      .is("deleted_at", null);

    if (filtr.typ)       q = q.eq("typ", filtr.typ);
    // Jeden kraj, nebo celá oblast (Čechy, Morava) jako seznam krajů.
    if (filtr.kraje && filtr.kraje.length) q = q.in("kraj", filtr.kraje);
    else if (filtr.kraj) q = q.eq("kraj", filtr.kraj);
    if (filtr.faze)      q = q.eq("faze", filtr.faze);
    if (filtr.stav)      q = q.eq("stav", filtr.stav);
    if (filtr.cenaOd != null)     q = q.gte("cena", filtr.cenaOd);
    if (filtr.cenaDo != null)     q = q.lte("cena", filtr.cenaDo);
    // Od kdy byla zadaná. Hranici počítá aplikace, ne databáze —
    // "dnes" se řídí časem u tebe, ne na serveru v Americe.
    if (filtr.odKdy)              q = q.gte("created_at", filtr.odKdy);
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

// Nový člověk rovnou odsud, bez odskoku do Mapy. Zapisuje se do
// stejné tabulky, takže v Mapě na něj narazíš úplně stejně.
/* Sloupce člověka. Na jednom místě, aby se po okně nepotulovaly
   tři různé výběry a jedno okno nevědělo o roli, kterou druhé ukládá. */
const OSOBA = "id, name, aliases, note, met_at, contact, role_tagy, introduced_by";

/* Očistí, co přišlo z formuláře. Prázdné pole = null, ne prázdný řetězec:
   jinak by "bez kontaktu" a "kontakt je prázdný text" byly dvě různé věci. */
function osobaDoDb(d) {
  const t = (x) => {
    const v = (x ?? "").toString().trim();
    return v === "" ? null : v;
  };
  const telo = {};
  if ("name" in d)     telo.name = t(d.name);
  if ("contact" in d)  telo.contact = t(d.contact);
  if ("met_at" in d)   telo.met_at = t(d.met_at);
  if ("note" in d)     telo.note = t(d.note);
  if ("role_tagy" in d) telo.role_tagy = Array.isArray(d.role_tagy) ? d.role_tagy : [];
  if ("aliases" in d) {
    telo.aliases = Array.isArray(d.aliases)
      ? d.aliases
      : String(d.aliases || "").split(",").map(x => x.trim()).filter(Boolean);
  }
  return telo;
}

function jmenoSedi(n) {
  if (!n) return "Chybí jméno.";
  if (n.length > 60 || n.split(/\s+/).length > 5) {
    return "To vypadá spíš na větu než na jméno. Zadej jen jméno.";
  }
  return null;
}

/* Druhý parametr bere jméno jako text (staré volání) i celý
   formulář jako objekt. Díky tomu jde člověka založit i s rolemi
   rovnou z výběru u zakázky, ne až dodatečně v Síti. */
export async function zalozOsobu(owner, jmenoNeboData, kontakt = "") {
  const d = typeof jmenoNeboData === "string"
    ? { name: jmenoNeboData, contact: kontakt }
    : (jmenoNeboData || {});
  const telo = osobaDoDb(d);
  if (!owner) return { ok: false, chyba: "Chybí přihlášení." };
  const spatne = jmenoSedi(telo.name);
  if (spatne) return { ok: false, chyba: spatne };
  try {
    const { data, error } = await supabase
      .from("map_people")
      .insert({ ...telo, owner })
      .select(OSOBA)
      .single();
    if (error) throw error;
    return { ok: true, osoba: data };
  } catch (e) {
    if (String(e?.code) === "23505") {
      return { ok: false, chyba: "Někdo s tímhle jménem už v Mapě je — najdi ho v seznamu." };
    }
    return selhalo("zalozOsobu", e);
  }
}

/* Úprava člověka. Stejná data, stejná pravidla, ať to voláš
   z Mapy, ze Sítě nebo z detailu zakázky. */
export async function ulozOsobu(id, data) {
  if (!id) return { ok: false, chyba: "Chybí osoba." };
  const telo = osobaDoDb(data || {});
  if ("name" in telo) {
    const spatne = jmenoSedi(telo.name);
    if (spatne) return { ok: false, chyba: spatne };
  }
  if (Object.keys(telo).length === 0) return { ok: false, chyba: "Není co uložit." };
  try {
    const { data: row, error } = await supabase
      .from("map_people").update(telo).eq("id", id).select(OSOBA);
    if (error) throw error;
    if (!row || row.length === 0) {
      return { ok: false, chyba: "Osobu se nepodařilo uložit — není tvoje." };
    }
    return { ok: true, osoba: row[0] };
  } catch (e) {
    if (String(e?.code) === "23505") {
      return { ok: false, chyba: "Někdo s tímhle jménem už v Mapě je." };
    }
    return selhalo("ulozOsobu", e);
  }
}

/* Prostý seznam lidí, ne hledání. Na přepisování kontaktů z telefonu
   a na otázku „ukaž mi všechny prostředníky“. Role se filtruje
   překryvem, takže člověk s víc rolemi se najde pod každou z nich. */
export async function nactiLidi(owner, filtr = {}, limit = 300) {
  if (!owner) return [];
  try {
    let q = supabase
      .from("map_people")
      .select("id, name, contact, met_at, note, role_tagy")
      .eq("owner", owner);

    if (filtr.role) q = q.contains("role_tagy", [filtr.role]);
    if (filtr.bezRole) q = q.eq("role_tagy", "{}");

    const h = (filtr.hledat || "").trim();
    if (h) {
      const v = h.replace(/[%,]/g, " ");
      q = q.or(`name.ilike.%${v}%,contact.ilike.%${v}%,met_at.ilike.%${v}%,note.ilike.%${v}%`);
    }

    const { data, error } = await q.order("name").limit(limit);
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("nactiLidi", e);
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

/* ── Časová osa ──────────────────────────────────────────
   Události kolem zakázky se zapisují do Mapy, ne do vlastní
   tabulky. Díky tomu klik na Davida ukáže i to, co s ním
   řešíš obchodně — je to jedna osa, jen filtrovaná jinak. */

async function zapisDoOsy(owner, { personId, projectId, text, context }) {
  if (!owner || !text) return;
  try {
    const { error } = await supabase.from("map_facts").insert({
      owner,
      person_id: personId || null,
      project_id: projectId || null,
      content: text,
      context: context || null,
      happened_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (e) {
    // Osa je doprovodná. Když se nezapíše, hlavní akce platí dál.
    console.warn("[obchod/zapisDoOsy]", e?.message || e);
  }
}

export async function osaZakazky(owner, projectId, limit = 100) {
  if (!owner || !projectId) return [];
  try {
    const { data, error } = await supabase
      .from("map_facts")
      .select("id, owner, content, context, happened_at, person_id, osoba:map_people (id, name)")
      // Schválně bez filtru na vlastníka: u sdílené zakázky patří na osu
      // i to, co zapsal partner. Pravidla v databázi hlídají, že se sem
      // nedostane nic z jiné zakázky.
      .eq("project_id", projectId)
      .order("happened_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("osaZakazky", e);
    return [];
  }
}

/* ── Účastníci: kdo je na zakázce napojený ───────────────
   Provizní řetězec i vlastníci. Oddělené od oslovení:
   tohle je "kdo na tom je", oslovení je "koho jsem zkoušel". */

const UCASTNIK = `
  id, owner, project_id, person_id, role, podil, poradi,
  forma_dohody, poznamka, created_at,
  osoba:map_people (id, name)
`;

export async function nactiUcastniky(projectId) {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase
      .from("deal_participants").select(UCASTNIK)
      .eq("project_id", projectId)
      .order("poradi", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("nactiUcastniky", e);
    return [];
  }
}

export async function ulozUcastnika(owner, data) {
  if (!owner || !data?.project_id || !data?.person_id) {
    return { ok: false, chyba: "Chybí zakázka nebo člověk." };
  }
  const telo = {
    role: data.role || "prostrednik",
    podil: cislo(data.podil),
    poradi: cislo(data.poradi) ?? 1,
    forma_dohody: prazdnoNaNull(data.forma_dohody),
    poznamka: prazdnoNaNull(data.poznamka),
  };
  try {
    const q = data.id
      ? supabase.from("deal_participants").update(telo).eq("id", data.id)
      : supabase.from("deal_participants").insert({
          ...telo, owner, project_id: data.project_id, person_id: data.person_id,
        });
    const { data: row, error } = await q.select(UCASTNIK).single();
    if (error) throw error;
    return { ok: true, ucastnik: row };
  } catch (e) {
    // Stejný člověk ve stejné roli už na zakázce je
    if (String(e?.code) === "23505") {
      return { ok: false, chyba: "Tenhle člověk už tu v téhle roli je." };
    }
    return selhalo("ulozUcastnika", e);
  }
}

export async function smazUcastnika(id) {
  if (!id) return { ok: false, chyba: "Chybí ID." };
  try {
    const { data, error } = await supabase
      .from("deal_participants").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, chyba: "Nenašlo se." };
    return { ok: true };
  } catch (e) {
    return selhalo("smazUcastnika", e);
  }
}

/* ── Oslovení ────────────────────────────────────────── */

const OSLOVENI = `
  id, owner, project_id, person_id, stav, aktualne, aktualne_at,
  kanal, odeslano_at, cena_jednana, pripominka_at, poznamka,
  created_at, updated_at,
  osoba:map_people (id, name, contact)
`;

export async function nactiOsloveni(projectId) {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase
      .from("deal_approaches").select(OSLOVENI)
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("odeslano_at", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("nactiOsloveni", e);
    return [];
  }
}

// Hromadné oslovení z výsledku párování. Kdo tam už je,
// se přeskočí — nechceme přepsat stav u někoho rozjednaného.
export async function oslovHromadne(owner, projectId, lide, nazevZakazky = "") {
  if (!owner || !projectId || !lide?.length) {
    return { ok: false, chyba: "Není koho oslovit." };
  }
  try {
    const radky = lide.map(p => ({
      owner, project_id: projectId, person_id: p.person_id,
      stav: "osloveno", kanal: p.kanal || null,
      odeslano_at: new Date().toISOString(),
    }));
    const { data, error } = await supabase
      .from("deal_approaches")
      .upsert(radky, { onConflict: "project_id,person_id", ignoreDuplicates: true })
      .select("id, person_id");
    if (error) throw error;
    const pridano = data || [];
    for (const r of pridano) {
      const kdo = lide.find(x => x.person_id === r.person_id);
      await zapisDoOsy(owner, {
        personId: r.person_id, projectId,
        text: `Oslovil jsem ho s nabídkou${nazevZakazky ? `: ${nazevZakazky}` : ""}.`,
        context: kdo?.kanal || null,
      });
    }
    return { ok: true, pridano: pridano.length, preskoceno: lide.length - pridano.length };
  } catch (e) {
    return selhalo("oslovHromadne", e);
  }
}

export async function ulozOsloveni(owner, data, puvodniStav = null, popisStavu = "") {
  if (!data?.id) return { ok: false, chyba: "Chybí ID." };
  const telo = {
    stav: data.stav,
    aktualne: prazdnoNaNull(data.aktualne),
    aktualne_at: data.aktualne ? new Date().toISOString() : null,
    kanal: prazdnoNaNull(data.kanal),
    cena_jednana: cislo(data.cena_jednana),
    pripominka_at: prazdnoNaNull(data.pripominka_at),
    poznamka: prazdnoNaNull(data.poznamka),
  };
  try {
    const { data: row, error } = await supabase
      .from("deal_approaches").update(telo).eq("id", data.id)
      .select(OSLOVENI).single();
    if (error) throw error;
    // Posun na žebříku je událost, kterou chceš za rok vidět.
    if (puvodniStav && puvodniStav !== data.stav) {
      await zapisDoOsy(owner, {
        personId: row.person_id, projectId: row.project_id,
        text: `Posun v jednání: ${popisStavu || data.stav}.`,
      });
    }
    return { ok: true, osloveni: row };
  } catch (e) {
    return selhalo("ulozOsloveni", e);
  }
}

export async function smazOsloveni(id) {
  if (!id) return { ok: false, chyba: "Chybí ID." };
  try {
    const { data, error } = await supabase
      .from("deal_approaches")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, chyba: "Nenašlo se." };
    return { ok: true };
  } catch (e) {
    return selhalo("smazOsloveni", e);
  }
}

/* ── Termíny ─────────────────────────────────────────────
   Termín patří k zakázce a volitelně ke konkrétnímu člověku.
   U jedné zakázky jich může být víc: s investorem jeden,
   s klientem druhý, se zprostředkovatelem třetí.

   Barva se počítá z počtu zbývajících dní, ne z typu termínu —
   u výkupu je týden stres, u due diligence ne, ale naléhavost
   je nakonec vždycky jen „kolik času zbývá“. */

const TERMIN = `
  id, owner, project_id, person_id, nazev, datum, poznamka,
  hotovo_at, reminder_id, created_at,
  osoba:map_people (id, name)
`;

export async function nactiTerminy(projectId) {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase
      .from("deal_terminy").select(TERMIN)
      .eq("project_id", projectId)
      .order("datum", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("nactiTerminy", e);
    return [];
  }
}

export async function prehledTerminu(owner, dni = 60) {
  if (!owner) return [];
  try {
    const { data, error } = await supabase.rpc("deal_terminy_prehled", {
      p_owner: owner, p_dni: dni,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("prehledTerminu", e);
    return [];
  }
}

export async function ulozTermin(owner, data, popisZakazky = "") {
  if (!owner || !data?.project_id) return { ok: false, chyba: "Chybí zakázka." };
  if (!data.nazev?.trim()) return { ok: false, chyba: "Napiš, o jaký termín jde." };
  if (!data.datum) return { ok: false, chyba: "Chybí datum." };

  const telo = {
    nazev: data.nazev.trim(),
    datum: data.datum,
    person_id: data.person_id || null,
    poznamka: prazdnoNaNull(data.poznamka),
  };

  try {
    // Připomínka jede přes stávající systém připomínek, aby se ozvala
    // i když aplikaci neotevřeš. Ukládá se zvlášť a termín si na ni
    // drží odkaz, takže se dá posunout nebo zrušit zároveň s ním.
    let reminderId = data.reminder_id || null;
    if (data.pripomenout) {
      const text = `Termín: ${telo.nazev}${popisZakazky ? ` — ${popisZakazky}` : ""}`;
      const kdy = new Date(telo.datum + "T09:00:00").toISOString();
      reminderId = await ulozPripominku(owner, reminderId, text, kdy);
    } else if (reminderId) {
      await zrusPripominku(reminderId);
      reminderId = null;
    }
    telo.reminder_id = reminderId;

    const q = data.id
      ? supabase.from("deal_terminy").update(telo).eq("id", data.id)
      : supabase.from("deal_terminy").insert({ ...telo, owner, project_id: data.project_id });
    const { data: row, error } = await q.select(TERMIN).single();
    if (error) throw error;
    return { ok: true, termin: row };
  } catch (e) {
    return selhalo("ulozTermin", e);
  }
}

export async function splnTermin(id, hotovo = true, reminderId = null) {
  if (!id) return { ok: false, chyba: "Chybí ID." };
  try {
    const { data, error } = await supabase
      .from("deal_terminy")
      .update({ hotovo_at: hotovo ? new Date().toISOString() : null })
      .eq("id", id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, chyba: "Nenašlo se." };
    if (hotovo && reminderId) await zrusPripominku(reminderId);
    return { ok: true };
  } catch (e) {
    return selhalo("splnTermin", e);
  }
}

export async function smazTermin(id, reminderId = null) {
  if (!id) return { ok: false, chyba: "Chybí ID." };
  try {
    const { data, error } = await supabase
      .from("deal_terminy").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, chyba: "Nenašlo se." };
    if (reminderId) await zrusPripominku(reminderId);
    return { ok: true };
  } catch (e) {
    return selhalo("smazTermin", e);
  }
}

// Zapisuje do tabulky připomínek, kterou používá zbytek aplikace.
// Vrátí id, nebo null — selhání připomínky nesmí shodit uložení termínu.
async function ulozPripominku(owner, id, text, kdy) {
  try {
    if (id) {
      const { data, error } = await supabase
        .from("reminders")
        .update({ text, remind_at: kdy, dismissed_at: null, notified: false })
        .eq("id", id).select("id");
      if (error) throw error;
      if (data && data.length) return id;
    }
    const { data, error } = await supabase
      .from("reminders")
      .insert({ text, remind_at: kdy, created_by: owner })
      .select("id").single();
    if (error) throw error;
    return data?.id || null;
  } catch (e) {
    console.warn("[obchod/ulozPripominku]", e?.message || e);
    return null;
  }
}

async function zrusPripominku(id) {
  if (!id) return;
  try {
    await supabase.from("reminders")
      .update({ dismissed_at: new Date().toISOString() }).eq("id", id);
  } catch (e) {
    console.warn("[obchod/zrusPripominku]", e?.message || e);
  }
}

/* Naléhavost podle zbývajících dní. Jedno místo, ať se barvy
   neliší mezi seznamem a detailem. */
export function nalehavost(zbyva) {
  const d = Number(zbyva);
  if (!isFinite(d)) return { klic: "zadny", popis: "" };
  // 2 dny, ale 5 dní — bez toho to v seznamu drhne.
  const dny = (n) => `${n} ${n === 1 ? "den" : n < 5 ? "dny" : "dní"}`;
  if (d < 0)   return { klic: "po",    popis: d === -1 ? "včera" : `${dny(-d)} po termínu` };
  if (d === 0) return { klic: "dnes",  popis: "dnes" };
  if (d === 1) return { klic: "dnes",  popis: "zítra" };
  if (d <= 7)  return { klic: "tyden", popis: `za ${dny(d)}` };
  if (d <= 30) return { klic: "mesic", popis: `za ${dny(d)}` };
  return { klic: "dale", popis: `za ${dny(d)}` };
}

export function barvaTerminu(theme, klic) {
  switch (klic) {
    case "po":    return theme.red;
    case "dnes":  return theme.orange || theme.red;
    case "tyden": return theme.yellow;
    case "mesic": return theme.accent;
    default:      return theme.textSub;
  }
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

/* ── Uživatelé ───────────────────────────────────────── */

export async function nactiUzivatele() {
  try {
    const { data, error } = await supabase
      .from("profiles").select("id, name, is_admin").order("name");
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("nactiUzivatele", e);
    return [];
  }
}

export async function nactiPozvanky() {
  try {
    const { data, error } = await supabase
      .from("pozvanky")
      .select("email, jmeno, is_admin, pozval, poznamka, created_at, pouzito_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    // Nesprávce sem nevidí; to není chyba, jen prázdno.
    return [];
  }
}

export async function pozviUzivatele(owner, { email, jmeno, is_admin, poznamka }) {
  const mail = (email || "").trim().toLowerCase();
  const kdo = (jmeno || "").trim();
  if (!mail || !mail.includes("@")) return { ok: false, chyba: "Chybí platný e-mail." };
  if (!kdo) return { ok: false, chyba: "Chybí jméno." };
  try {
    const { data, error } = await supabase
      .from("pozvanky")
      .insert({ email: mail, jmeno: kdo, is_admin: !!is_admin, pozval: owner, poznamka: poznamka || null })
      .select("email, jmeno, is_admin, created_at, pouzito_at")
      .single();
    if (error) throw error;
    return { ok: true, pozvanka: data };
  } catch (e) {
    if (String(e?.code) === "23505") {
      return { ok: false, chyba: "Tenhle e-mail nebo jméno už pozvánku má." };
    }
    if (String(e?.code) === "42501") {
      return { ok: false, chyba: "Zvát můžou jen správci." };
    }
    return selhalo("pozviUzivatele", e);
  }
}

export async function zrusPozvanku(email) {
  if (!email) return { ok: false, chyba: "Chybí e-mail." };
  try {
    const { data, error } = await supabase
      .from("pozvanky").delete().eq("email", email).select("email");
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, chyba: "Pozvánka se nenašla." };
    return { ok: true };
  } catch (e) {
    return selhalo("zrusPozvanku", e);
  }
}

/* ── Úkoly a poznámky u zakázky ──────────────────────────
   Nevzniká tu žádná nová tabulka. Úkol je pořád úkol v úkolníku
   a poznámka pořád poznámka — jen mají vyplněnou zakázku. Díky
   tomu je uvidíš na obou místech a v úkolníku si je vyfiltruješ.

   Čte se přes funkce, ne z tabulky: úkolník se sdílením zakázky
   neotvírá. Každý vidí svoje, správce všechno. */

/* Počty pro celý seznam najednou. Jeden dotaz místo dvaceti —
   odznaky u řádku se jinak nedají ukázat bez čekání. */
export async function prehledPrilepenych(owner) {
  if (!owner) return {};
  try {
    const { data, error } = await supabase.rpc("deal_prilepene_prehled", { p_owner: owner });
    if (error) throw error;
    const mapa = {};
    for (const r of (data || [])) {
      mapa[r.project_id] = {
        ukolu: Number(r.ukolu) || 0,
        poznamek: Number(r.poznamek) || 0,
        terminu: Number(r.terminu) || 0,
      };
    }
    return mapa;
  } catch (e) {
    selhalo("prehledPrilepenych", e);
    return {};
  }
}

/* Komu můžu u téhle zakázky zadat úkol: já a ti, s kým ji sdílím.
   Zadat úkol někomu, kdo zakázku nevidí, nedává smysl — otevřel by
   si ho a nevěděl, o čem je. */
export async function komuZadat(owner, projectId) {
  const ja = { name: owner, ja: true };
  if (!projectId) return [ja];
  try {
    const { data, error } = await supabase
      .from("deal_shares").select("grantee").eq("project_id", projectId);
    if (error) throw error;
    const dalsi = (data || [])
      .map(r => r.grantee)
      .filter(n => n && n !== owner)
      .map(name => ({ name, ja: false }));
    return [ja, ...dalsi];
  } catch (e) {
    selhalo("komuZadat", e);
    return [ja];
  }
}

export async function ukolyZakazky(projectId) {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase.rpc("ukoly_zakazky", { p_project: projectId });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("ukolyZakazky", e);
    return [];
  }
}

export async function poznamkyZakazky(projectId) {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase.rpc("poznamky_zakazky", { p_project: projectId });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("poznamkyZakazky", e);
    return [];
  }
}

/* Založí úkol v úkolníku a rovnou ho přiváže k zakázce.
   `komu` je jméno z profilů — úkol se dá zadat i někomu jinému. */
/* Kód zakázky se píše na začátek názvu. Je to schválně — díky tomu
   úkol i poznámku najdeš kdekoli prostým napsáním "MB-10002",
   v úkolníku, v poznámkách i v lupě. Vazba přes project_id je sice
   přesnější, ale ta není vidět a nedá se do ní napsat. */
function sKodem(kod, text) {
  const t = (text || "").trim();
  if (!kod) return t;
  if (t.toUpperCase().startsWith(String(kod).toUpperCase())) return t;
  return `${kod} ${t}`;
}

/* Kód zpátky pryč — v detailu zakázky by stál na každém řádku zbytečně. */
export function bezKodu(kod, text) {
  const t = (text || "").trim();
  if (!kod) return t;
  const k = String(kod);
  if (t.toUpperCase().startsWith(k.toUpperCase())) {
    return t.slice(k.length).replace(/^[\s—·:-]+/, "");
  }
  return t;
}

export async function ukolKZakazce(owner, projectId, nazev, kod = "", komu = null, priorita = null) {
  const t = (nazev || "").trim();
  if (!owner || !projectId) return { ok: false, chyba: "Chybí zakázka." };
  if (!t) return { ok: false, chyba: "Napiš, co je potřeba udělat." };
  try {
    // Vyplňujeme stejná pole, jaká zakládá úkolník sám. Chybějící
    // sloupec se sice dosadí výchozí hodnotou, ale aplikace podle
    // některých filtruje — úkol by pak v seznamu nebyl vidět.
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: sKodem(kod, t),
        note: null,
        type: "simple",
        priority: priorita || null,
        category: null,
        status: "active",
        due_date: null,
        show_from: null,
        rec_days: 0,
        created_by: owner,
        // POZOR: "úkol pro mě" se v téhle aplikaci ukládá jako
        // assigned_to: [moje jméno], NE jako prázdné pole. Prázdný
        // seznam znamená "nikomu" a filtr MOJE úkoly takový úkol
        // vyhodí — zmizel by ze všech pohledů, i když v databázi je.
        assign_to: komu && komu !== owner ? "person" : "self",
        assigned_to: [komu && komu !== owner ? komu : owner],
        shared_with: [],
        done_by: [],
        seen_by: [],
        checklist: [],
        images: [],
        rejected_by: [],
        project_id: projectId,
      })
      .select("*")
      .single();
    if (error) throw error;
    return { ok: true, ukol: data };
  } catch (e) {
    return selhalo("ukolKZakazce", e);
  }
}

export async function poznamkaKZakazce(owner, projectId, text, kod = "") {
  const t = (text || "").trim();
  if (!owner || !projectId) return { ok: false, chyba: "Chybí zakázka." };
  if (!t) return { ok: false, chyba: "Poznámka je prázdná." };
  // Titulek je v tabulce povinný. Prázdný řetězec projde, null ne —
  // na tomhle poznámka u zakázky poprvé spadla.
  const prvniRadek = t.split("\n")[0].slice(0, 60);
  try {
    const { data, error } = await supabase
      .from("notes")
      .insert({
        title: sKodem(kod, prvniRadek) || (kod || "Poznámka"),
        content: t,
        created_by: owner,
        project_id: projectId,
        shared_with: [],
        is_shared: false,
        pinned: false,
        archived_by: {},
      })
      .select("*")
      .single();
    if (error) throw error;
    return { ok: true, poznamka: data };
  } catch (e) {
    return selhalo("poznamkaKZakazce", e);
  }
}

/* Odškrtnutí úkolu rovnou od zakázky. Vrací nový stav. */
export async function prepniUkol(id, hotovo, kdo = null) {
  if (!id) return { ok: false, chyba: "Chybí úkol." };
  try {
    // Stejná pole jako když úkol odškrtneš v úkolníku — jinak by se
    // tam tvářil jako nedokončený a opakování by se nespustilo.
    const { data, error } = await supabase
      .from("tasks")
      .update({
        status: hotovo ? "done" : "active",
        completed_at: hotovo ? new Date().toISOString() : null,
        completed_by_user: hotovo ? kdo : null,
      })
      .eq("id", id).select("id, status");
    if (error) throw error;
    if (!data || data.length === 0) {
      return { ok: false, chyba: "Tenhle úkol měnit nemůžeš — není tvůj." };
    }
    return { ok: true };
  } catch (e) {
    return selhalo("prepniUkol", e);
  }
}

/* ── Statistika ──────────────────────────────────────────
   Datum zadání se ukládalo od začátku, jen se nikde nečetlo.
   Obě funkce počítají v databázi — stahovat kvůli součtu
   všechny zakázky by bylo zbytečné. */

export async function kolikZakazek(owner) {
  if (!owner) return null;
  try {
    const { data, error } = await supabase.rpc("deal_kolik", { p_owner: owner });
    if (error) throw error;
    return (data && data[0]) || null;
  } catch (e) {
    selhalo("kolikZakazek", e);
    return null;
  }
}

export async function prirustekZakazek(owner, mesicu = 12) {
  if (!owner) return [];
  try {
    const { data, error } = await supabase.rpc("deal_prirustek", {
      p_owner: owner, p_mesicu: mesicu,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("prirustekZakazek", e);
    return [];
  }
}

/* ── Sdílení ─────────────────────────────────────────────
   Přepínače jsou uložené u každého sdílení zvlášť. S Davidem
   můžeš sdílet víc než s někým, koho zatím neznáš. */

export const PREPINACE = [
  { k: "vidi_souhrn",       t: "Souhrn projektu" },
  { k: "vidi_podklady",     t: "Podklady a odkaz na složku" },
  { k: "vidi_cenu",         t: "Akviziční cena" },
  { k: "vidi_stav",         t: "Stav jednání" },
  { k: "vidi_jmena",        t: "Jména oslovených (bez kontaktů)" },
  { k: "vidi_retezec",      t: "Provizní řetězec" },
  { k: "vidi_ceny_jednani", t: "Vyjednané ceny a podíly" },
];

export const SABLONY = {
  "Jen projekt":      { vidi_souhrn: true, vidi_stav: true },
  "Investor po NDA":  { vidi_souhrn: true, vidi_stav: true, vidi_podklady: true, vidi_cenu: true },
  "Parťák":           { vidi_souhrn: true, vidi_stav: true, vidi_podklady: true, vidi_cenu: true, vidi_jmena: true },
  "Spolupráce":       { spolupracuje: true },
};

export function zeSablony(nazev) {
  const zaklad = { spolupracuje: false };
  for (const p of PREPINACE) zaklad[p.k] = false;
  return { ...zaklad, ...(SABLONY[nazev] || {}), sablona: nazev };
}

export async function nactiSdileni(projectId) {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase
      .from("deal_shares").select("*").eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("nactiSdileni", e);
    return [];
  }
}

export async function ulozSdileni(owner, data) {
  if (!owner || !data?.project_id || !data?.grantee) {
    return { ok: false, chyba: "Chybí zakázka nebo komu." };
  }
  const telo = {
    sablona: data.sablona || null,
    poznamka: data.poznamka || null,
    spolupracuje: !!data.spolupracuje,
  };
  for (const p of PREPINACE) telo[p.k] = !!data[p.k];
  try {
    const q = data.id
      ? supabase.from("deal_shares").update(telo).eq("id", data.id)
      : supabase.from("deal_shares").insert({
          ...telo, owner, project_id: data.project_id, grantee: data.grantee,
        });
    const { data: row, error } = await q.select("*").single();
    if (error) throw error;
    return { ok: true, sdileni: row };
  } catch (e) {
    if (String(e?.code) === "23505") {
      return { ok: false, chyba: "S tímhle člověkem už tahle zakázka sdílená je." };
    }
    return selhalo("ulozSdileni", e);
  }
}

export async function zrusSdileni(id) {
  if (!id) return { ok: false, chyba: "Chybí ID." };
  try {
    const { data, error } = await supabase
      .from("deal_shares").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, chyba: "Nenašlo se." };
    return { ok: true };
  } catch (e) {
    return selhalo("zrusSdileni", e);
  }
}

/* Co sdílí někdo se mnou. Čte se přes funkci, ne z tabulky —
   nepovolené sloupce se z databáze vůbec nevrátí. */

export async function sdileneSeMnou() {
  try {
    const { data, error } = await supabase.rpc("deal_sdilene_se_mnou");
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("sdileneSeMnou", e);
    return [];
  }
}

export async function sdileneOsloveni(projectId) {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase.rpc("deal_sdilene_osloveni", {
      p_project_id: projectId,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
    return [];
  }
}

export async function sdilenyRetezec(projectId) {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase.rpc("deal_sdileny_retezec", {
      p_project_id: projectId,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
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
