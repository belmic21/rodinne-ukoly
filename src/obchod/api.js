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
    // !inner znamená "bez projektu řádek nevracej". Teprve s ním jde
    // filtrovat na projekt.deleted_at — jinak PostgREST filtr zahodí.
    const projektInner = "projekt:deal_projects!inner (id, kod, nazev, typ, kraj, mesto, cena, stav, faze, created_at, deleted_at)";
    /* Karta člověka ukazuje i firmu a místo — bez nich by u nově
       založeného kontaktu nebylo vidět vůbec nic. Sloupce ale
       nemusí existovat (skript s místem neproběhl), a kdyby se
       tenhle dotaz utopil v Promise.all, zmizel by celý člověk
       a karta by hlásila „nenašel se". Proto vlastní pojistka. */
    const osobaDotaz = (async () => {
      let r = await supabase.from("map_people")
        .select("id, name, aliases, note, met_at, contact, role_tagy, introduced_by, firma, kraj, okres, mesto, mesto_kod")
        .eq("id", personId).maybeSingle();
      if (r.error && chybiSloupec(r.error)) {
        r = await supabase.from("map_people")
          .select("id, name, aliases, note, met_at, contact, role_tagy, introduced_by")
          .eq("id", personId).maybeSingle();
      }
      return r;
    })();
    const [osoba, ucast, osloveni, karty, zaznamy] = await Promise.all([
      osobaDotaz,
      // Bez filtru na vlastníka: u zakázky ve spolupráci patří k člověku
      // i to, co zapsal partner. Co vidět nemáš, ti databáze nevydá.
      // !inner a filtr na deleted_at: bez nich zůstane u člověka viset
      // zakázka, kterou jsi mezitím smazal. Vložený vztah se totiž
      // sám nefiltruje — PostgREST vrátí řádek vazby a projekt v něm,
      // smazaný nebo ne.
      supabase.from("deal_participants")
        .select(`id, owner, role, podil, poradi, forma_dohody, poznamka, ${projektInner}`)
        .eq("person_id", personId)
        .is("projekt.deleted_at", null),
      supabase.from("deal_approaches")
        // kanal se tahá kvůli přehledu u člověka: "čím to odešlo"
        // je půlka odpovědi na otázku, co a kdy jsi komu poslal.
        .select(`id, owner, stav, aktualne, aktualne_at, odeslano_at, cena_jednana,
                 kanal, pripominka_at, poznamka, ${projektInner}`)
        .eq("person_id", personId)
        .is("deleted_at", null)
        .is("projekt.deleted_at", null),
      supabase.from("deal_cards")
        .select("id, smer, nazev, typy, kraje, cena_od, cena_do, velikost_od, jednotka, aktivni, poznamka")
        .eq("owner", owner).eq("person_id", personId),
      /* Štítky a příznak trvalosti se tahají taky — karta člověka
         je dělí na „co o něm vím" a „co kdy zaznělo". Když sloupec
         trvale ještě není, dotaz se zopakuje bez něj a karta se
         chová jako dřív: všechno je osa. */
      (async () => {
        const pole = "id, owner, content, context, happened_at, tags, trvale, projekt:deal_projects (kod, nazev, deleted_at)";
        let r = await supabase.from("map_facts").select(pole)
          .eq("person_id", personId)
          .order("happened_at", { ascending: false }).limit(60);
        if (r.error && chybiSloupec(r.error)) {
          r = await supabase.from("map_facts")
            .select("id, owner, content, context, happened_at, projekt:deal_projects (kod, nazev, deleted_at)")
            .eq("person_id", personId)
            .order("happened_at", { ascending: false }).limit(60);
        }
        return r;
      })(),
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

/* ── Témata k probrání ───────────────────────────────────
   Michal: „chtěl bych evidovat témata v hovoru, která jsme
   nedokončili, abych je mohl odškrtávat pro budoucí hovory."

   Stálá agenda k jednomu člověku. Otevřeš ji před hovorem,
   odškrtáváš během něj — a odškrtnuté nemizí, jen se přesune
   mezi vyřízená. To je ten rozdíl proti úkolu, který zmizí,
   a proti časové ose, ze které se nic neodškrtává.

   Tři stavy: otevrene → vyrizene (probráno) nebo predane
   (stal se z toho úkol s termínem). Datum vyřízení nastavuje
   trigger v databázi, ne tohle — jedno místo, které by na to
   zapomnělo, by stačilo. */

/* Tabulka ještě nemusí existovat — skript temata_261023_0900.sql
   nemusel proběhnout. Mlčet by znamenalo nechat člověka klikat do
   prázdna; tohle mu rovnou řekne, co spustit. */
function chybiTabulka(e) {
  const kod = String(e?.code || "");
  return kod === "42P01" || kod === "PGRST205" || kod === "PGRST204";
}

const TEMA = `
  id, person_id, project_id, text, tema, poznamka, stav, task_id,
  poradi, created_at, updated_at, vyrizeno_at,
  zakazka:deal_projects (id, kod, nazev)
`;

export async function nactiTemata(owner, personId) {
  if (!owner || !personId) return [];
  try {
    const { data, error } = await supabase
      .from("map_temata").select(TEMA)
      .eq("owner", owner).eq("person_id", personId)
      /* Otevřená první, pak ruční pořadí, pak nejstarší nahoře.
         Nejdéle ležící téma má přednost — na to se zapomíná. */
      .order("poradi", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("nactiTemata", e);
    return [];
  }
}

export async function pridejTema(owner, d = {}) {
  if (!owner) return { ok: false, chyba: "Chybí přihlášení." };
  if (!d.personId) return { ok: false, chyba: "Téma musí patřit člověku." };
  const text = (d.text || "").trim();
  if (!text) return { ok: false, chyba: "Napiš, o co jde." };
  try {
    const { data, error } = await supabase
      .from("map_temata")
      .insert({
        owner,
        person_id: d.personId,
        project_id: d.projectId || null,
        text,
        tema: d.tema || null,
        poznamka: prazdnoNaNull(d.poznamka),
        // Nové téma nahoru: nejčerstvější věc je ta, kterou si
        // právě vybavil, a ta se nemá hledat na konci seznamu.
        poradi: Number.isFinite(d.poradi) ? d.poradi : -Date.now() / 1000 | 0,
      })
      .select(TEMA).single();
    if (error) throw error;
    return { ok: true, tema: data };
  } catch (e) {
    if (chybiTabulka(e)) {
      return { ok: false, chyba: "Témata zatím nemají v databázi tabulku. Pusť skript temata_261023_0900.sql." };
    }
    return selhalo("pridejTema", e);
  }
}

export async function upravTema(id, d = {}) {
  if (!id) return { ok: false, chyba: "Chybí téma." };
  const telo = {};
  if ("text" in d) {
    const t = (d.text || "").trim();
    if (!t) return { ok: false, chyba: "Téma nemůže být prázdné." };
    telo.text = t;
  }
  if ("tema" in d)      telo.tema = d.tema || null;
  if ("poznamka" in d)  telo.poznamka = prazdnoNaNull(d.poznamka);
  if ("projectId" in d) telo.project_id = d.projectId || null;
  if ("poradi" in d)    telo.poradi = d.poradi;
  if (Object.keys(telo).length === 0) return { ok: false, chyba: "Není co uložit." };
  try {
    const { data, error } = await supabase
      .from("map_temata").update(telo).eq("id", id).select(TEMA);
    if (error) throw error;
    if (!data || data.length === 0) {
      return { ok: false, chyba: "Téma se nepodařilo uložit — není tvoje." };
    }
    return { ok: true, tema: data[0] };
  } catch (e) {
    return selhalo("upravTema", e);
  }
}

/* Odškrtnutí a vrácení zpět. `taskId` se předává jen při povýšení
   na úkol — ukládá se jako text schválně, viz komentář u tabulky:
   téma musí přežít smazání úkolu. */
export async function stavTematu(id, stav, taskId = null) {
  if (!id) return { ok: false, chyba: "Chybí téma." };
  if (!["otevrene", "vyrizene", "predane"].includes(stav)) {
    return { ok: false, chyba: "Neznámý stav tématu." };
  }
  const telo = { stav };
  // Vrácení mezi otevřená odpojí i úkol — jinak by u otevřeného
  // tématu visel odkaz na úkol, který ho už nehlídá.
  if (stav === "predane") telo.task_id = taskId ? String(taskId) : null;
  else if (stav === "otevrene") telo.task_id = null;
  try {
    const { data, error } = await supabase
      .from("map_temata").update(telo).eq("id", id).select(TEMA);
    if (error) throw error;
    if (!data || data.length === 0) {
      return { ok: false, chyba: "Téma se nepodařilo změnit — není tvoje." };
    }
    return { ok: true, tema: data[0] };
  } catch (e) {
    return selhalo("stavTematu", e);
  }
}

export async function smazTema(id) {
  if (!id) return { ok: false, chyba: "Chybí téma." };
  try {
    const { error } = await supabase.from("map_temata").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return selhalo("smazTema", e);
  }
}

/* Kolik otevřených témat má kdo. Pro odznáček u lidí — aby bylo
   vidět, s kým máš co probrat, ještě než ho otevřeš. */
export async function otevrenaTemataPoLidech(owner) {
  if (!owner) return {};
  try {
    const { data, error } = await supabase
      .from("map_temata").select("person_id")
      .eq("owner", owner).eq("stav", "otevrene").limit(2000);
    if (error) throw error;
    const out = {};
    for (const r of data || []) out[r.person_id] = (out[r.person_id] || 0) + 1;
    return out;
  } catch (e) {
    selhalo("otevrenaTemataPoLidech", e);
    return {};
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
      // Smazané zakázky a skrytá oslovení se počítat nesmí: jinak
      // položka číselníku hlásí "používá se u 3 záznamů", ty tři
      // zakázky jsou dávno smazané a smazat ji nejde nikdy.
      if (tabulka === "deal_projects" || tabulka === "deal_approaches") {
        q = q.is("deleted_at", null);
      }
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
  zeme, kraj, okres, mesto, mesto_kod, lokalita_text, faze, cena, mena,
  odmena, stav, duvod_nerealizace, spi_do, uzavreno_at,
  souhrn, slozka_odkaz, navazuje_na,
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

/* Skládání filtru. Je schválně samostatně: používá ho seznam
   zakázek i mapa okresů, a kdyby to byly dvě kopie, mapa by
   dřív nebo později ukazovala jiná čísla než seznam pod ní.
   Dostane rozdělaný dotaz a vrátí ho s podmínkami. */
function pouzijFiltr(q, filtr = {}) {
    /* Víc typů naráz — „nemocnice NEBO alzheimer centrum NEBO LDN".
     Jeden typ zůstává kvůli starým uloženým filtrům a odkazům;
     nové obrazovky posílají typy. Stejný vzor jako u krajů. */
  if (filtr.typy && filtr.typy.length) q = q.in("typ", filtr.typy);
  else if (filtr.typ)  q = q.eq("typ", filtr.typ);
  /* Okresy. Pole okres u zakázky se dopočítává z města, takže
     filtr na okres je spolehlivější než na město — „průmyslové
     parky na jihu Čech" se neptá na konkrétní obec. */
  if (filtr.okresy && filtr.okresy.length) q = q.in("okres", filtr.okresy);
  // Jeden kraj, nebo celá oblast (Čechy, Morava) jako seznam krajů.
  if (filtr.kraje && filtr.kraje.length) q = q.in("kraj", filtr.kraje);
  else if (filtr.kraj) q = q.eq("kraj", filtr.kraj);
  if (filtr.faze)      q = q.eq("faze", filtr.faze);
  if (filtr.stav)      q = q.eq("stav", filtr.stav);
  // Hotové, padlé a spící z výchozího seznamu pryč. Nemažou se,
  // jen netříští pozornost — a dají se kdykoli zapnout.
  //
  // Ten "stav.is.null" tam musí být. V SQL je NULL not in (…) zase
  // NULL, ne pravda — takže zakázka bez vyplněné fáze by se ze
  // seznamu tiše ztratila. Přesně to se stalo zakázkám založeným
  // dřív, než fáze vůbec existovaly: v databázi byly, v seznamu ne.
  else if (!filtr.archiv) {
    /* Tip je od 14. 10. ve výchozím seznamu taky schovaný. Není to
       archiv, ale není to ani živá zakázka — na tipu nepracuješ,
       zatím o něm jen víš. Kdyby se pletl mezi živé, kazil by
       odpověď na otázku „na čem teď dělám". Zobrazí se kliknutím
       na dlaždici Tip v pásu fází. */
    q = q.or("stav.is.null,stav.not.in.(vyplaceno,nerealizovano,spi,tip)");
  }
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
  return q;
}

export async function nactiZakazky(owner, filtr = {}, limit = 50, offset = 0) {
  if (!owner) return [];
  try {
    let q = supabase
      .from("deal_projects")
      .select(SLOUPCE)
      .eq("owner", owner)
      .is("deleted_at", null);

    q = pouzijFiltr(q, filtr);

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

/* Pozor na .is("deleted_at", null): bez něj se smazaná zakázka vrátí
   při hledání do seznamu a otevře se jako plný editovatelný detail —
   dal by se do ní zapsat termín i sdílení. Tohle je jediná cesta
   k detailu, takže filtr musí být přímo tady. */
/* ── Mapa: kolik zakázek je ve kterém okrese ───────────
   Odpověď na „kde mám pokrytí". Používá stejný filtr jako seznam,
   takže mapa a seznam pod ní nemůžou ukazovat jiná čísla.

   Tahá se jen sloupec okres, ne celé zakázky — i při tisícovce
   zakázek je to pár desítek kilobajtů. Strop deset tisíc řádků
   je pojistka, ne očekávání; kdyby se na něj narazilo, mapa by
   byla stejně nečitelná a problém by byl jinde. */
export async function prehledOkresu(owner, filtr = {}) {
  if (!owner) return {};
  try {
    let q = supabase
      .from("deal_projects")
      .select("okres")
      .eq("owner", owner)
      .is("deleted_at", null);
    q = pouzijFiltr(q, filtr);
    const { data, error } = await q.limit(10000);
    if (error) throw error;
    const out = {};
    for (const r of data || []) {
      // Zakázka bez okresu se nepočítá nikam — na mapě by neměla
      // kam sednout a tiše by zvedla číslo u náhodného okresu.
      if (r.okres) out[r.okres] = (out[r.okres] || 0) + 1;
    }
    return out;
  } catch (e) {
    selhalo("prehledOkresu", e);
    return {};
  }
}

export async function nactiZakazku(id) {
  if (!id) return null;
  try {
    const { data, error } = await supabase
      .from("deal_projects").select(SLOUPCE).eq("id", id)
      .is("deleted_at", null).maybeSingle();
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
    // Napřed si schovat termíny i s jejich připomínkami. Kdyby se to
    // dělalo až po smazání zakázky, nemusely by už být vidět.
    //
    // Tohle byla tichá vada: smazala se zakázka, ale připomínky jejích
    // termínů zůstaly a za dva dny zazvonily — „Termín: zavolat —
    // Zakázka X“ k zakázce, která už nikde není a není kam kliknout.
    let terminy = [];
    try {
      const { data: t } = await supabase
        .from("deal_terminy").select("id, reminder_id").eq("project_id", id);
      terminy = t || [];
    } catch (e) { /* úklid nesmí shodit samotné mazání */ }

    const { data, error } = await supabase
      .from("deal_projects")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return { ok: false, chyba: "Zakázka se nenašla nebo ti nepatří." };
    }

    // Úklid běží až po úspěšném smazání a jeho selhání se nehlásí:
    // zakázka už smazaná je a tohle jsou jen zbytky.
    const ted = new Date().toISOString();
    for (const t of terminy) {
      if (t.reminder_id) await zrusPripominku(t.reminder_id);
    }
    try {
      await supabase.from("deal_terminy")
        .update({ hotovo_at: ted, reminder_id: null }).eq("project_id", id);
    } catch (e) { /* zbytek */ }
    try {
      await supabase.from("deal_approaches")
        .update({ deleted_at: ted }).eq("project_id", id).is("deleted_at", null);
    } catch (e) { /* zbytek */ }

    return { ok: true, uklizeno: terminy.length };
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
  // Razí je databáze, ne formulář. Kdyby je aplikace poslala zpátky,
  // přepsala by kód, který je na disku v názvu složky.
  delete out.uzavreno_at;
  return out;
}

/* ── Obce ────────────────────────────────────────────────
   Našeptávač měst. Vybráním města se doplní okres i kraj, takže
   si nemůžou protiřečit — a kód zakázky z nich pak vyjde správně.

   Hledá se nejdřív na začátek názvu, a teprve když to nic nevrátí,
   i uvnitř. Jinak by „nad“ vysypalo dvě stě obcí s „nad Labem“
   dřív než samotný Nadějkov. */

export async function hledejObce(dotaz, limit = 15) {
  const q = (dotaz || "").trim();
  if (q.length < 2) return [];
  try {
    const { data, error } = await supabase.rpc("obce_hledej", { p_dotaz: q, p_limit: limit });
    if (error) throw error;
    if (data && data.length) return data;
    const volne = await supabase.rpc("obce_hledej_volne", { p_dotaz: q, p_limit: limit });
    if (volne.error) throw volne.error;
    return volne.data || [];
  } catch (e) {
    selhalo("hledejObce", e);
    return [];
  }
}

/* ── Fáze zakázky ───────────────────────────────────────
   Pás s počty nad seznamem. Vrací všechny fáze včetně prázdných,
   aby pás nepřeskakoval pokaždé, když se poslední zakázka ve fázi
   posune dál. */

export async function prehledFazi(kdo = null) {
  try {
    const { data, error } = await supabase.rpc("deal_prehled_fazi", { p_kdo: kdo || null });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("prehledFazi", e);
    return [];
  }
}

/* Spící zakázky, kterým nastal den probuzení, se vrátí mezi živé.
   Volá se při otevření seznamu — cron by na to byl zbytečný. */
export async function probudSpici() {
  try {
    const { data, error } = await supabase.rpc("deal_probud_spici");
    if (error) throw error;
    return Number(data) || 0;
  } catch (e) {
    selhalo("probudSpici", e);
    return 0;
  }
}

/* Přerazit kód. Jde jen u zakázky ve fázi Nová — dál už na disku
   existuje složka a kód je na ni jediná cesta. */
export async function prerazitKod(projectId) {
  if (!projectId) return { ok: false, chyba: "Chybí zakázka." };
  try {
    const { data, error } = await supabase.rpc("deal_prerazit_kod", { p_project_id: projectId });
    if (error) throw error;
    return { ok: true, kod: data };
  } catch (e) {
    return selhalo("prerazitKod", e);
  }
}

/* Název složky na disk. Kód zůstává čistý, složka čitelná:
   ST-PZ_2610_00042 — Hala Rudná (David Jedlička) */
export function nazevSlozky(z, zdroj = null) {
  const casti = [z?.kod, z?.nazev].filter(Boolean).join(" — ");
  return zdroj ? `${casti} (${zdroj})` : casti;
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
const OSOBA = "id, name, aliases, note, met_at, contact, role_tagy, introduced_by, firma, kraj, okres, mesto, mesto_kod";

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
  /* Kde sedí. Stejná čtyři pole jako u zakázky — schválně, aby
     existovala jedna slovní zásoba pro místo. Vyplněná může být
     kterákoli úroveň: město → okres → kraj. Kraj je vyplněný
     vždycky, když je vyplněno cokoli pod ním. */
  if ("kraj" in d)      telo.kraj = t(d.kraj);
  if ("okres" in d)     telo.okres = t(d.okres);
  if ("mesto" in d)     telo.mesto = t(d.mesto);
  if ("mesto_kod" in d) telo.mesto_kod = t(d.mesto_kod);
  // Firma a pozice. Dřív se psaly do „Kontakt" vedle telefonu,
  // takže se podle nich nedalo hledat.
  if ("firma" in d)     telo.firma = t(d.firma);
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
/* ══ SLOUPEC, KTERÝ V DATABÁZI JEŠTĚ NENÍ ══
   16. 10.: formulář člověka začal posílat místo dřív, než byl
   v databázi sloupec — a databáze kvůli jednomu neznámému poli
   odmítla CELÝ zápis. Výsledek: u člověka nešlo uložit vůbec nic,
   ani jméno, i když s obcí nikdo nepracoval.

   Načítání úkolů má na tuhle situaci pojistku odjakživa; zápis
   osoby ji neměl. Tohle je ona: když databáze hlásí neznámý
   sloupec, pole se vyhodí a zkusí se to znovu. Tím se ztratí
   místo — ale jméno a telefon se uloží, a to je to, co člověk
   zrovna psal. Pole se vypisují níž ručně; odvozovat je z hlášky
   databáze nejde, ta jmenuje jen to první, o které zakopla.

   Rozpozná se to podle kódu PGRST204 („schema cache"), případně
   podle 42703 z Postgresu. Nehádá se podle textu hlášky. */
function chybiSloupec(e) {
  const kod = String(e?.code || "");
  return kod === "PGRST204" || kod === "42703";
}

const NEPOVINNA_POLE = ["kraj", "okres", "mesto", "mesto_kod", "firma"];

function bezNepovinnych(telo) {
  const out = { ...telo };
  for (const k of NEPOVINNA_POLE) delete out[k];
  return out;
}

export async function zalozOsobu(owner, jmenoNeboData, kontakt = "") {
  const d = typeof jmenoNeboData === "string"
    ? { name: jmenoNeboData, contact: kontakt }
    : (jmenoNeboData || {});
  const telo = osobaDoDb(d);
  if (!owner) return { ok: false, chyba: "Chybí přihlášení." };
  const spatne = jmenoSedi(telo.name);
  if (spatne) return { ok: false, chyba: spatne };
  try {
    let { data, error } = await supabase
      .from("map_people")
      .insert({ ...telo, owner })
      .select(OSOBA)
      .single();
    let vynechano = false;
    if (error && chybiSloupec(error)) {
      /* Zápis prošel, ale bez místa a firmy — ty sloupce v databázi
         ještě nejsou. Volající to MUSÍ vědět: náhled nad polem
         slíbil „místo: Čistá" a bez téhle zprávy by to byla lež. */
      vynechano = true;
      ({ data, error } = await supabase
        .from("map_people")
        .insert({ ...bezNepovinnych(telo), owner })
        .select("id, name, aliases, note, met_at, contact, role_tagy")
        .single());
    }
    if (error) throw error;
    return { ok: true, osoba: data, vynechano };
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
    let { data: row, error } = await supabase
      .from("map_people").update(telo).eq("id", id).select(OSOBA);
    if (error && chybiSloupec(error)) {
      ({ data: row, error } = await supabase
        .from("map_people").update(bezNepovinnych(telo)).eq("id", id)
        .select("id, name, aliases, note, met_at, contact, role_tagy"));
    }
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
    // Člověk bez role může mít prázdné pole NEBO NULL — záleží na tom,
    // jak vznikl. Rychlé založení jménem do role_tagy nesahá vůbec,
    // takže zůstane NULL a filtr "bez role" takového člověka
    // nenašel — přesně na obrazovce, kde si role doplňuješ.
    if (filtr.bezRole) q = q.or("role_tagy.is.null,role_tagy.eq.{}");

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
      /* Místo se ukládá rozepsané (město, okres, kraj), takže se
         nikam nepřipojuje — formulář i výpis mají rovnou názvy,
         ne holé kódy. Když sloupce ještě nejsou (skript s místem
         neproběhl), vrátí databáze chybu a zkusí se to bez nich. */
      .select("id, name, aliases, note, met_at, contact, role_tagy, firma, kraj, okres, mesto, mesto_kod")
      .eq("id", id).maybeSingle();
    if (error) {
      const { data: d2, error: e2 } = await supabase
        .from("map_people")
        .select("id, name, aliases, note, met_at, contact, role_tagy")
        .eq("id", id).maybeSingle();
      if (e2) throw e2;
      return d2;
    }
    return data;
  } catch (e) {
    selhalo("nactiOsobu", e);
    return null;
  }
}

// Profilové role: čím je člověk obecně. Role v konkrétní zakázce
// jsou jinde — Radek je obecně investor i developer, ale v jedné
// zakázce je právě jedním z nich.
/* ── Soukromá poznámka ────────────────────────────────────
   Leží ve vlastní tabulce, ne jako sloupec u člověka. Důvod je
   v databázi: pravidla v Postgresu chrání ŘÁDKY, ne sloupce.
   Kdyby to byl sloupec na map_people, viděl by ho každý, kdo vidí
   toho člověka — tedy i ten, komu jsi sdílel zakázku. Vypadalo by
   to soukromě a nebylo by. */

export async function nactiSoukromou(owner, personId) {
  if (!owner || !personId) return "";
  try {
    const { data, error } = await supabase
      .from("map_people_soukrome")
      .select("note")
      .eq("owner", owner)
      .eq("person_id", personId)
      .maybeSingle();
    if (error) throw error;
    return data?.note || "";
  } catch (e) {
    // Dokud neproběhne SQL, tabulka neexistuje. Prázdná poznámka
    // je lepší než rozbitá obrazovka člověka.
    return "";
  }
}

export async function ulozSoukromou(owner, personId, note) {
  if (!owner || !personId) return { ok: false, chyba: "Chybí člověk." };
  const text = (note || "").trim();
  try {
    if (!text) {
      const { error } = await supabase
        .from("map_people_soukrome")
        .delete().eq("owner", owner).eq("person_id", personId);
      if (error) throw error;
      return { ok: true };
    }
    const { error } = await supabase
      .from("map_people_soukrome")
      .upsert({ person_id: personId, owner, note: text, updated_at: new Date().toISOString() },
              { onConflict: "person_id,owner" });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return selhalo("ulozSoukromou", e);
  }
}

/* ── Stav lidí pro chytré seznamy ─────────────────────────
   Má kartu? Má kontakt? Kdy jsme se naposled potkali? Kolikrát
   byl osloven? Čtyři údaje, které by se jinak musely tahat ze
   čtyř tabulek zvlášť. */
export async function prehledStavuLidi() {
  try {
    const { data, error } = await supabase.rpc("lide_prehled_stav");
    if (error) throw error;
    const m = {};
    for (const r of data || []) m[r.person_id] = r;
    return m;
  } catch (e) {
    selhalo("prehledStavuLidi", e);
    return {};
  }
}

export async function neosloveni(projectId) {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase.rpc("lide_neosloveni", { p_project: projectId });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("lide_neosloveni", e);
    return [];
  }
}

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
  forma, tiket_od, tiket_do, ltv_max, rychlost_dni, vystup, nebere,
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
    // Pole, která rozhodují o obchodu víc než cena.
    forma: data.forma || [],
    tiket_od: cislo(data.tiket_od),
    tiket_do: cislo(data.tiket_do),
    ltv_max: cislo(data.ltv_max),
    rychlost_dni: cislo(data.rychlost_dni),
    vystup: prazdnoNaNull(data.vystup),
    nebere: data.nebere || [],
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
  id, owner, project_id, person_id, nazev, datum, cas, poznamka, dulezite, komu,
  hotovo_at, reminder_id, created_at,
  osoba:map_people (id, name)
`;

export async function nactiTerminy(projectId) {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase
      .from("deal_terminy").select(TERMIN)
      .eq("project_id", projectId)
      .order("datum", { ascending: true })
      .order("cas", { ascending: true, nullsFirst: false });
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
    cas: prazdnoNaNull(data.cas),
    komu: prazdnoNaNull(data.komu),
    poznamka: prazdnoNaNull(data.poznamka),
    dulezite: !!data.dulezite,
  };

  try {
    // Připomínka jede přes stávající systém připomínek, aby se ozvala
    // i když aplikaci neotevřeš. Ukládá se zvlášť a termín si na ni
    // drží odkaz, takže se dá posunout nebo zrušit zároveň s ním.
    let reminderId = data.reminder_id || null;
    if (data.pripomenout) {
      const text = `Termín: ${telo.nazev}${popisZakazky ? ` — ${popisZakazky}` : ""}`;
      const kdy = kdyPripomenout(telo.datum, telo.cas);
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

/* Kdy se ozvat. Termín bez hodiny platí na celý den a připomínka
   se ozve ráno; s hodinou se ozve v tu hodinu.

   Počítá se z místního času prohlížeče — new Date("2026-10-09T12:00")
   bez Z je úmysl "dvanáct u mě", ne v Greenwichi. */
export function kdyPripomenout(datum, cas) {
  const h = (cas || "09:00").slice(0, 5);
  const d = new Date(`${datum}T${h}:00`);
  return isNaN(d.getTime())
    ? new Date(`${datum}T09:00:00`).toISOString()
    : d.toISOString();
}

/* Hotové termíny — koš. Odškrtnutý termín nemizí, spadne sem
   a dá se vrátit. */
export async function hotoveTerminy(dni = 60) {
  try {
    const { data, error } = await supabase.rpc("deal_terminy_hotove", { p_dni: dni });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("hotoveTerminy", e);
    return [];
  }
}

/* Posunutí termínu. Klient zavolá, že to stihne až ve tři — tohle
   přepíše datum i hodinu a rovnou posune i připomínku, aby se
   neozvala ve dvanáct na něco, co je domluvené na patnáctou. */
export async function posunTermin(id, datum, cas, reminderId = null) {
  if (!id || !datum) return { ok: false, chyba: "Chybí termín." };
  try {
    const { data, error } = await supabase
      .from("deal_terminy")
      .update({ datum, cas: cas || null })
      .eq("id", id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, chyba: "Nenašlo se." };
    if (reminderId) {
      await supabase.from("reminders")
        .update({ remind_at: kdyPripomenout(datum, cas), notified: false, dismissed_at: null })
        .eq("id", reminderId);
    }
    return { ok: true };
  } catch (e) {
    return selhalo("posunTermin", e);
  }
}

/* Hvězdička u termínu. Píše se jedním klikem ze seznamu, proto
   zvlášť — načítat a ukládat kvůli ní celý termín by bylo zbytečné. */
export async function oznacTermin(id, dulezite = true) {
  if (!id) return { ok: false, chyba: "Chybí ID." };
  try {
    const { data, error } = await supabase
      .from("deal_terminy")
      .update({ dulezite: !!dulezite })
      .eq("id", id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, chyba: "Nenašlo se." };
    return { ok: true };
  } catch (e) {
    return selhalo("oznacTermin", e);
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

/* ── Lidé ────────────────────────────────────────────────
   Jeden řádek na člověka: role, kolik má karet, kdy jsi ho naposledy
   oslovil a — to podstatné — kolik rozdělaných zakázek mu teď sedí.
   To poslední číslo je rozdíl mezi seznamem kontaktů a nástrojem. */

export async function prehledLidi(role = null, limit = 500) {
  try {
    const { data, error } = await supabase.rpc("deal_lide_prehled", {
      p_role: role || null, p_limit: limit,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("prehledLidi", e);
    return [];
  }
}

/* Párování obráceně: co z rozdělaného sedí tomuhle člověku.
   Zakázky, které už mu jednou poslané byly, vynechává — nabídnout
   podruhé totéž je horší než nenabídnout nic. */
export async function zakazkyProOsobu(personId, limit = 20) {
  if (!personId) return [];
  try {
    const { data, error } = await supabase.rpc("deal_match_projects", {
      p_person_id: personId, p_limit: limit,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("zakazkyProOsobu", e);
    return [];
  }
}

/* Komu jsi dlouho nic neposlal, i když mu něco sedí. */
export async function zanedbani(dni = 90, limit = 30) {
  try {
    const { data, error } = await supabase.rpc("deal_zanedbani", {
      p_dni: dni, p_limit: limit,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("zanedbani", e);
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
/* Hledání napříč obsahem zakázky — jméno, telefon, text poznámky,
   úkol, termín. Vrací mapu id → { kde, ukazka }, ať se dá v seznamu
   ukázat, proč se zakázka našla. */
export async function hledejVObsahu(dotaz) {
  const q = (dotaz || "").trim();
  if (!q) return {};
  try {
    const { data, error } = await supabase.rpc("deal_hledej", { p_dotaz: q });
    if (error) throw error;
    const mapa = {};
    for (const r of (data || [])) mapa[r.project_id] = { kde: r.kde, ukazka: r.ukazka };
    return mapa;
  } catch (e) {
    selhalo("hledejVObsahu", e);
    return {};
  }
}

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
        terminDni: r.termin_dni === null || r.termin_dni === undefined
          ? null : Number(r.termin_dni),
        terminNazev: r.termin_nazev || null,
        terminKdo: r.termin_kdo || null,
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
  const ja = { name: owner, ja: true, vidi: true };
  try {
    const [lide, sdileni] = await Promise.all([
      supabase.from("profiles").select("name").order("name"),
      projectId
        ? supabase.from("deal_shares").select("grantee").eq("project_id", projectId)
        : Promise.resolve({ data: [] }),
    ]);
    if (lide.error) throw lide.error;
    const maPristup = new Set((sdileni.data || []).map(r => r.grantee));
    const dalsi = (lide.data || [])
      .map(r => r.name)
      .filter(n => n && n !== owner)
      // Nabízíme všechny uživatele, ne jen ty se sdílenou zakázkou.
      // Kdo ji nevidí, dostane u jména hvězdičku — úkol mu přijde,
      // ale na zakázku se nepodívá, dokud mu ji nenasdílíš.
      .map(name => ({ name, ja: false, vidi: maPristup.has(name) }));
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

/* Velká a malá česká písmena VÝČTEM, ne rozsahem.
   [A-ZÁ-Ž] vypadá jako velká písmena, ale rozsah od Á (U+00C1)
   po Ž (U+017D) zahrnuje i malá á, č, š, ů. Kvůli tomu se ze
   „slyšel jsem od Fera" stalo město „šel". */
const VELKA = "A-Z\u00c1\u010c\u010e\u00c9\u011a\u00cd\u0147\u00d3\u0158\u0160\u0164\u00da\u016e\u00dd\u017d";
const MALA  = "a-z0-9\u00e1\u010d\u010f\u00e9\u011b\u00ed\u0148\u00f3\u0159\u0161\u0165\u00fa\u016f\u00fd\u017e";

/* Jak se o typech mluví nahlas. Klíč je klíč z číselníku typ,
   hodnoty jsou slova, kterými to člověk doopravdy řekne.

   Popisek z číselníku se hledá jako celý řetězec, takže
   „alzheimer centrum Jičín" by nenašlo nic — popisek zní
   „Senior / Alzheimer centrum". A nikdo neřekne „rodinný dům
   Beroun", když může říct „RD Beroun".

   Když typ v číselníku není, jeho synonyma se neuplatní. Tabulka
   se tím pádem nemusí držet v souladu s databází. */
const SYNONYMA_TYPU = {
  nemocnice:        ["nemocnice", "nemocnici", "nemocnicni"],
  poliklinika:      ["poliklinika", "polikliniku"],
  ldn:              ["ldn", "lecebna", "nasledna pece", "dlouhodobe nemocnych"],
  ordinace:         ["ordinace", "klinika", "kliniku", "zdravotnicke stredisko"],
  senior:           ["alzheimer", "senior", "senioru", "domov pro seniory", "dps", "pecovatelsky"],
  prumyslovy_park:  ["prumyslovy park", "prumyslova zona", "prumyslova zona", "zona"],
  logistika:        ["logisticke centrum", "logistika", "logisticky", "sklad", "skladovy"],
  hala:             ["hala", "halu", "haly", "vyrobni"],
  retail_park:      ["retail park", "retail"],
  obchodni_centrum: ["obchodni centrum", "nakupni centrum", "galerie"],
  kancelare:        ["kancelare", "kancelar", "administrativni", "offices"],
  hotel:            ["hotel", "penzion", "apartmany"],
  rodinny_dum:      ["rodinny dum", "rodinne domy", "rd "],
  bytovy_dum:       ["bytovy dum", "bytovka", "bytove domy"],
  rezidencni:       ["rezidencni", "rezidence", "bytovy projekt"],
  pozemek:          ["pozemek", "pozemky", "parcela", "parcely"],
};

/* ── Import kontaktů ──────────────────────────────────────
   Michal má kontakty v telefonu a v tabulkách; most tam nevede
   a bez lidí nemá polovina obchodního modulu co dělat.

   Umí dva tvary, protože víc jich není potřeba:
     vCard (.vcf) — co vyexportuje každý telefon
     CSV / TSV    — co vyexportuje každá tabulka

   Rozbor je čistá funkce bez databáze: vrátí seznam lidí a ty se
   před uložením ukážou. Nic se nenahrává naslepo. */

function vcardOdradkuj(text) {
  /* vCard láme dlouhé řádky a pokračování značí mezerou nebo
     tabulátorem na začátku. Bez slepení by se dlouhý e-mail
     rozpadl na dva kusy. */
  return String(text || "").replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function vcardHodnota(radek) {
  const i = radek.indexOf(":");
  if (i < 0) return "";
  let v = radek.slice(i + 1).trim();
  // Některé telefony kódují diakritiku quoted-printable.
  if (/ENCODING=QUOTED-PRINTABLE/i.test(radek)) {
    try {
      v = decodeURIComponent(v.replace(/=([0-9A-F]{2})/gi, "%$1"));
    } catch (e) { /* nechat jak je, radši divný text než spadlý import */ }
  }
  return v;
}

export function rozeberVCard(text) {
  const radky = vcardOdradkuj(text).split("\n");
  const ven = [];
  let akt = null;
  for (const r of radky) {
    const R = r.trim();
    if (/^BEGIN:VCARD/i.test(R)) { akt = { name: "", tel: [], mail: [], org: "", note: "" }; continue; }
    if (/^END:VCARD/i.test(R)) {
      if (akt && akt.name) ven.push(akt);
      akt = null; continue;
    }
    if (!akt) continue;
    const klic = R.split(/[;:]/)[0].toUpperCase();
    const v = vcardHodnota(R);
    if (!v) continue;
    if (klic === "FN") akt.name = v;
    // N je příjmení;jméno;… — bere se jen když FN chybí.
    else if (klic === "N" && !akt.name) {
      const [prijmeni, jmeno] = v.split(";");
      akt.name = [jmeno, prijmeni].filter(Boolean).join(" ").trim();
    }
    else if (klic === "TEL") akt.tel.push(v.replace(/[^\d+]/g, ""));
    else if (klic === "EMAIL") akt.mail.push(v);
    else if (klic === "ORG") akt.org = v.replace(/;+$/, "");
    else if (klic === "NOTE") akt.note = v;
  }
  return ven.map(x => ({
    name: x.name.trim(),
    contact: [...new Set([...x.tel, ...x.mail])].filter(Boolean).join(", "),
    note: [x.org, x.note].filter(Boolean).join(" · "),
  })).filter(x => x.name);
}

/* CSV i TSV. Oddělovač se pozná z prvního řádku — kdo exportuje
   z českého Excelu, dostane středníky, kdo odjinud čárky. */
function csvRozdel(radek, odd) {
  const ven = []; let akt = ""; let vUvozovkach = false;
  for (let i = 0; i < radek.length; i++) {
    const z = radek[i];
    if (z === '"') {
      if (vUvozovkach && radek[i + 1] === '"') { akt += '"'; i++; }
      else vUvozovkach = !vUvozovkach;
    } else if (z === odd && !vUvozovkach) { ven.push(akt); akt = ""; }
    else akt += z;
  }
  ven.push(akt);
  return ven.map(x => x.trim());
}

export function rozeberCSV(text) {
  const radky = String(text || "").replace(/\r\n/g, "\n").split("\n").filter(r => r.trim());
  if (radky.length < 2) return [];
  const odd = [";", "\t", ","]
    .map(o => ({ o, n: csvRozdel(radky[0], o).length }))
    .sort((a, b) => b.n - a.n)[0].o;

  const bez = (x) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const hlavicka = csvRozdel(radky[0], odd).map(bez);

  /* Jak se sloupce jmenují v praxi. Google, Outlook i ručně
     psaná tabulka — každý si to pojmenuje po svém. */
  const najdi = (varianty) => hlavicka.findIndex(h => varianty.some(v => h.includes(v)));
  const iJmeno  = najdi(["jmeno a prijmeni", "cele jmeno", "jmeno", "name", "nazev", "kontakt"]);
  const iPrijmeni = najdi(["prijmeni", "last name", "surname"]);
  const iTel    = najdi(["telefon", "mobil", "phone", "tel", "cislo"]);
  const iMail   = najdi(["mail", "e-mail"]);
  const iPozn   = najdi(["poznamka", "note", "popis", "firma", "organizace", "company"]);
  if (iJmeno < 0) return [];

  const ven = [];
  for (const r of radky.slice(1)) {
    const c = csvRozdel(r, odd);
    const jmeno = [c[iJmeno], iPrijmeni >= 0 ? c[iPrijmeni] : ""].filter(Boolean).join(" ").trim();
    if (!jmeno) continue;
    ven.push({
      name: jmeno,
      contact: [iTel >= 0 ? (c[iTel] || "").replace(/[^\d+]/g, "") : "",
                iMail >= 0 ? c[iMail] : ""].filter(Boolean).join(", "),
      note: iPozn >= 0 ? (c[iPozn] || "") : "",
    });
  }
  return ven;
}

export function rozeberKontakty(text, nazevSouboru = "") {
  const t = String(text || "");
  if (/BEGIN:VCARD/i.test(t) || /\.vcf$/i.test(nazevSouboru)) return rozeberVCard(t);
  return rozeberCSV(t);
}

/* Duplicita: stejné jméno, nebo stejné telefonní číslo. Jméno se
   porovnává bez diakritiky a bez ohledu na velikost písmen, aby
   „Ondřej Fer" a „ondrej fer" nebyli dva lidi. */
export function oznacDuplicity(noviLide, stavajici) {
  const bez = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
  const cisla = (x) => (String(x || "").match(/\+?\d[\d\s]{7,}\d/g) || [])
    .map(c => c.replace(/[^\d]/g, "").slice(-9));
  const jmena = new Set((stavajici || []).map(p => bez(p.name)));
  const tel = new Set((stavajici || []).flatMap(p => cisla(p.contact)));
  return (noviLide || []).map(x => ({
    ...x,
    duplicita: jmena.has(bez(x.name)) || cisla(x.contact).some(c => tel.has(c)),
  }));
}

export async function naimportujLidi(owner, lide) {
  if (!owner || !lide?.length) return { ok: false, chyba: "Není co importovat.", pocet: 0 };
  try {
    const davka = lide.map(x => ({
      owner,
      name: (x.name || "").trim().slice(0, 200),
      contact: (x.contact || "").trim().slice(0, 500) || null,
      note: (x.note || "").trim().slice(0, 1000) || null,
    })).filter(x => x.name);
    if (!davka.length) return { ok: false, chyba: "Nikdo s vyplněným jménem.", pocet: 0 };
    // Po stovkách — jeden velký insert umí spadnout na časový limit
    // a pak se neví, kolik se jich uložilo.
    let hotovo = 0;
    for (let i = 0; i < davka.length; i += 100) {
      const { error } = await supabase.from("map_people").insert(davka.slice(i, i + 100));
      if (error) throw error;
      hotovo += Math.min(100, davka.length - i);
    }
    return { ok: true, pocet: hotovo };
  } catch (e) {
    return { ...selhalo("naimportujLidi", e), pocet: 0 };
  }
}

/* ── Rychlé zadání člověka ────────────────────────────────
   Michal: zakázku hodíš jednou větou, člověka musíš proklikat
   formulářem. Zadávání je ten skutečný brzdič, ne algoritmy.

   Z řádku „Ondřej Fer, 603 123 456, investor, od Davida"
   vytáhne, co umí, a zbytek nechá na tobě. Nic nehádá do
   databáze — obrazovka ukáže, co pochopila, ještě než uložíš.

   Pořadí v textu je libovolné. Telefon a mail se poznají podle
   tvaru, role podle číselníku, „od koho" podle slova od. Co
   zbyde, je jméno. */
export function rozeberOsobu(text, ciselniky) {
  const puvodni = (text || "").trim();
  if (!puvodni) return { name: "" };
  let zbytek = puvodni;
  const out = { role: [] };

  // Mail — nejjednoznačnější tvar, jde první.
  const mMail = zbytek.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
  if (mMail) { out.mail = mMail[0]; zbytek = zbytek.replace(mMail[0], " "); }

  /* Telefon. Devět číslic je české číslo, s předvolbou dvanáct.
     Kratší se nebere — „2026" nebo „50 mil" telefon není. */
  const mTel = zbytek.match(/(\+?\d[\d\s/-]{7,15}\d)/);
  if (mTel) {
    const cisla = mTel[1].replace(/[^\d+]/g, "");
    const delka = cisla.replace(/^\+/, "").length;
    if (delka >= 9 && delka <= 15) {
      out.telefon = cisla;
      zbytek = zbytek.replace(mTel[1], " ");
    }
  }

  // Od koho — stejné pravidlo jako u tipu.
  const mOd = zbytek.match(new RegExp(
    `\\bod\\s+(?:pana\\s+|pan\u00ed\\s+)?([${VELKA}][${MALA}]+)(?:\\s+([${VELKA}][${MALA}]+))?`, "u"));
  if (mOd) {
    out.odKoho = [mOd[1], mOd[2]].filter(Boolean).join(" ");
    zbytek = zbytek.replace(mOd[0], " ");
  }

  /* Role podle číselníku. Hledá se celý popisek s hranicemi slova,
     aby „investor" nenašlo uvnitř jiného slova. Rolí může být víc. */
  const bezDiakritiky = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const r of (ciselniky?.role || []).filter(x => x.active)) {
    const ln = bezDiakritiky(r.label);
    if (ln.length < 3) continue;
    const re = new RegExp(`(^|[^${MALA}${VELKA}])${ln.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")}`, "i");
    const mm = bezDiakritiky(zbytek).match(re);
    if (mm) {
      out.role.push(r.key);
      const i = mm.index + mm[1].length;
      zbytek = zbytek.slice(0, i) + " " + zbytek.slice(i + ln.length);
    }
  }

  /* ══ CO ZBYLO: JMÉNO, A CO JE ZA ČÁRKOU ══
     Michal 17. 10.: „zadal jsem Michal Trnka, Čistá a podívej se,
     jak se kontakt přidal." Přidal se jako jeden člověk jménem
     „Michal Trnka Čistá", protože tenhle řádek všechny čárky
     zahodil a co zbylo, prohlásil za jméno. Stejně dopadl
     „Zdeněk Mudra, Karlovy Vary".

     Jenže čárka něco znamená. Lidé ji píšou mezi údaje, ne uvnitř
     jména — jméno je skoro vždycky první. Co zůstane za čárkou
     a není telefon, mail, role ani „od koho", je skoro jistě
     místo. Nesmí se to ale hádat: text se jen oddělí a nabídne
     k dohledání v číselníku obcí (viz mistoText). Když se nenajde,
     neztratí se — zůstane vidět a člověk si ho zařadí sám.

     Bez čárky se nic nedělí. „Jan Novák Dvořák" je jméno, ne
     člověk z Dvořáku. */
  const useky = zbytek.split(/[,;]/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  out.name = (useky[0] || "").trim();
  out.mistoText = useky.slice(1).join(" ").trim() || null;
  // Bez čárky zůstává všechno jménem — tak, jak to bylo dřív.
  if (useky.length <= 1) out.mistoText = null;

  /* Kontakt je jedno volné pole — tam, kde je uložený, se nedělí
     na telefon a mail. Skládá se zpátky v pořadí telefon, mail. */
  out.contact = [out.telefon, out.mail].filter(Boolean).join(", ");
  return out;
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

  // Typ nemovitosti podle popisku v číselníku nebo podle synonyma.
  //
  // Samotný popisek nestačí: „alzheimer centrum Jičín" by se nenašlo,
  // protože popisek zní „Senior / Alzheimer centrum" a hledá se celý
  // řetězec. Mluvená řeč používá zkratky — RD, OC, zóna, bytovka.
  const typy = (ciselniky?.typ || []).filter(t => t.active);
  const bezDiakritiky = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const zbytekN = bezDiakritiky(zbytek);
  let nejdelsi = null, nalezenyText = null;

  // Nejdřív celé popisky z číselníku — ty jsou nejpřesnější. Delší
  // výhra: „obchodni centrum" má přednost před „centrum".
  for (const t of typy) {
    const ln = bezDiakritiky(t.label);
    if (ln.length < 4) continue;
    /* Hranice slova z OBOU stran. Dřív se hledalo prostým
       includes() a popisek „Jiné" se našel uvnitř slova „jiného" —
       z věty „něco úplně jiného" zbyl název „něco úplně ho".
       Stejně tak „Hala" sedělo v „Michala".

       Skloňování řeší synonyma níž, ne tohle; popisek je psaná
       podoba a ta se v textu objeví celá, nebo vůbec. */
    const re = new RegExp(
      `(^|[^${MALA}${VELKA}])${ln.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^${MALA}${VELKA}])`, "i");
    const mm = zbytekN.match(re);
    if (mm && (!nejdelsi || ln.length > (nalezenyText || "").length)) {
      nejdelsi = t; nalezenyText = ln;
      out._zacatekTypu = mm.index + mm[1].length;
    }
  }

  // Když popisek nesedl, zkusí se synonyma. Jsou vázaná na klíč
  // v číselníku, takže když typ v databázi není, synonymum se
  // neuplatní a nic se nerozbije.
  if (!nejdelsi) {
    for (const [klic, slova] of Object.entries(SYNONYMA_TYPU)) {
      const t = typy.find(x => x.key === klic);
      if (!t) continue;
      for (const w of slova) {
        const wn = bezDiakritiky(w);
        // Hranice slova zleva, aby „hala" nenašlo v „Michala".
        const re = new RegExp(`(^|[^a-z0-9])${wn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
        const mm = zbytekN.match(re);
        if (mm) {
          const zacatek = mm.index + mm[1].length;
          if (!nejdelsi || wn.length > (nalezenyText || "").length) {
            nejdelsi = t; nalezenyText = wn;
            out._zacatekTypu = zacatek;
          }
        }
      }
    }
  }

  if (nejdelsi) {
    out.typ = nejdelsi.key;
    const i = out._zacatekTypu !== undefined
      ? out._zacatekTypu
      : zbytekN.indexOf(nalezenyText);
    zbytek = zbytek.slice(0, i) + " " + zbytek.slice(i + nalezenyText.length);
    delete out._zacatekTypu;
  }

  // Velikost: "85 bytů", "8000 m2"
  // \w v JS nezahrnuje české znaky, takže „85 bytů" se odebralo
  // jen jako „85 byt" a v názvu zůstalo osiřelé „ů".
  const velRe = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(byt[${MALA}]*|m2|m\u00b2|ha|l\u016f\u017ek[${MALA}]*|luzk[${MALA}]*)`, "i");
  const mv = zbytek.match(velRe);
  if (mv) {
    out.velikost = parseFloat(mv[1].replace(",", "."));
    const j = mv[2].toLowerCase();
    out.jednotka = j.startsWith("byt") ? "byt"
      : (j === "m2" || j === "m²") ? "m2"
      : j === "ha" ? "ha" : "luzko";
    zbytek = zbytek.replace(mv[0], " ");
  }

  /* ── Od koho to vím ──
     „slyšel jsem od Fera", „od pana Nováka", „od Ondřeje Fera".
     U tipu je tohle nejcennější údaj — bez něj je tip jen zvěst.
     Vrací se jméno tak, jak bylo napsané, včetně skloňování;
     dohledání člověka je věc hledání, které umí kmeny. */
  const mOd = zbytek.match(new RegExp(
    `\\bod\\s+(?:pana\\s+|pan\u00ed\\s+)?([${VELKA}][${MALA}]+)(?:\\s+([${VELKA}][${MALA}]+))?`, "u"));
  if (mOd) {
    out.odKoho = [mOd[1], mOd[2]].filter(Boolean).join(" ");
    zbytek = zbytek.replace(mOd[0], " ");
  }

  /* ── Město ──
     Schválně se tu NEHÁDÁ. Vrací se jen seznam slov, která by
     městem být mohla — velká písmena uprostřed věty. Obrazovka
     je pak jedno po druhém zkusí v číselníku obcí a vezme první
     shodu; co se nenajde, zůstane v názvu.

     Kdyby se město dohadovalo tady, dopadlo by to jako „Bělá"
     v názvu zakázky „Bělá pod Bezdězem" — dvě různá místa. */
  // Dvouslovné názvy musí držet pohromadě — s předložkou
  // („Bělá pod Bezdězem") i bez ní („Mladá Boleslav"). Jinak se
  // z jednoho města stanou dva nesmyslné kandidáti.
  out.mestoKandidati = (zbytek.match(new RegExp(
    `[${VELKA}][${MALA}]{2,}(?:\\s+(?:pod|nad|na|u|za|v|ve)\\s+[${VELKA}][${MALA}]+|\\s+[${VELKA}][${MALA}]{2,})?`,
    "gu")) || []).slice(0, 4);

  /* Jak se o tipu mluví: „slyšel jsem", „říkal mi", „vím o".
     Do názvu zakázky to nepatří — tam má být věc, ne způsob,
     jakým jsem se o ní dozvěděl. Zůstane to v poznámce. */
  const VYCPAVKY = /\b(sly\u0161el jsem|sly\u0161el|\u0159\u00edkal mi|\u0159\u00edkal|v\u00edm o|v\u00edm \u017ee|mluvil jsem s|volal mi|psal mi|dozv\u011bd\u011bl jsem se|prej|\u00fadajn\u011b)\b/giu;
  /* Osiřelé obecné slovo na začátku. Když synonymum sebralo
     „alzheimer" z „alzheimer centrum Jičín", zůstalo „centrum
     Jičín" — a to „centrum" už nese typ, takže v názvu přebývá. */
  const OSIRELE = /^\s*(centrum|centra|park|z\u00f3na|zona|d\u016fm|domy|projekt|objekt)\s+/iu;
  out.nazev = zbytek
    .replace(VYCPAVKY, " ")
    .replace(/\s+/g, " ").trim()
    .replace(OSIRELE, "")
    .replace(/\s+[,;]/g, ",")
    .replace(/[,;]\s*$/, "")
    .replace(/^[,;\s]+/, "")
    .replace(/\s+/g, " ")
    .trim() || puvodni;
  return out;
}


/* ════════════════════════════════════════════════════════
   CO TIŠE UVADÁ

   Úkol neuvadá — má termín, nebo nemá. Ale rozjednaná zakázka
   a oslovený člověk uvadají tak, že si toho nikdo nevšimne,
   protože se prostě nic nestane.

   Obě funkce jsou security invoker, takže filtrování podle
   vlastníka dělá databáze, ne tahle vrstva.
   ════════════════════════════════════════════════════════ */

// Koho jsi oslovil a od té doby se stav nehnul.
export async function osloveniTicho(dni = 14) {
  try {
    const { data, error } = await supabase.rpc("deal_osloveni_ticho", { p_dni: dni });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("osloveniTicho", e);
    return [];
  }
}

/* Zakázky, které se nehýbou. Dva důvody a každý stačí sám:
   nemají budoucí krok, nebo visí ve stejné fázi moc dlouho.

   Michal: „aby se projekty hýbaly nebo daly uspat, pokud se na
   nich nepracuje." Druhý důvod je přesně tohle — zakázka může mít
   termín za termínem a v obchodu se neposunout. */
export async function zakazkyBezKroku(dni = 7, dniFaze = 45) {
  try {
    const { data, error } = await supabase.rpc("deal_bez_kroku", {
      p_dni: dni, p_dni_faze: dniFaze,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("zakazkyBezKroku", e);
    return [];
  }
}

/* Uspat zakázku jedním krokem. Fázi si najde databáze podle
   skupiny v číselníku, ne podle klíče napevno — kdybys ji
   přejmenoval, funguje to dál. */
export async function uspiZakazku(id, doKdy) {
  if (!id || !doKdy) return { ok: false, chyba: "Chybí zakázka nebo datum." };
  try {
    const { data, error } = await supabase.rpc("deal_uspi", {
      p_id: id, p_do: doKdy,
    });
    if (error) throw error;
    return data === "ok" ? { ok: true } : { ok: false, chyba: data };
  } catch (e) {
    return selhalo("uspiZakazku", e);
  }
}


/* ════════════════════════════════════════════════════════
   LIDÉ I S MÍSTEM

   Michal: „teď mi napsal kamarád, majitel velké firmy z Brna,
   a to jsem v Brně byl nedávno a zapomněl jsem na něj."

   Vzdálenosti se nepočítají tady ani v databázi, ale až nad
   výsledkem — těžiště okresů jsou v mapě (okresy_body.js) a mít
   je na dvou místech by znamenalo dvě verze téhož čísla.
   ════════════════════════════════════════════════════════ */

export async function lideSMistem() {
  try {
    const { data, error } = await supabase.rpc("lide_s_mistem");
    if (error) throw error;
    return data || [];
  } catch (e) {
    selhalo("lideSMistem", e);
    return [];
  }
}

/* Uloží člověku místo. Všechna čtyři pole najednou — kdyby se
   ukládala po jednom, dalo by se dojet do stavu „město Karlovy
   Vary, kraj Jihomoravský". Prázdno znamená „nevím", ne „nikde".

   `misto` je to, co vrátí našeptávač: { kraj, okres, mesto,
   mesto_kod }. Null nebo prázdný objekt místo smaže. */
export async function ulozMistoOsoby(id, misto) {
  if (!id) return { ok: false, chyba: "Chybí člověk." };
  const m = misto || {};
  try {
    const { error } = await supabase
      .from("map_people").update({
        kraj: m.kraj || null,
        okres: m.okres || null,
        mesto: m.mesto || null,
        mesto_kod: m.mesto_kod || null,
      }).eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return selhalo("ulozMistoOsoby", e);
  }
}

/* Kolik lidí nemá ani kraj. Jedno číslo místo stahování všech
   lidí do prohlížeče — pruh na úvodní obrazovce se ptá pokaždé. */
export async function lideBezMista() {
  try {
    const { data, error } = await supabase.rpc("lide_bez_mista");
    if (error) throw error;
    return data || 0;
  } catch (e) {
    selhalo("lideBezMista", e);
    return 0;
  }
}
