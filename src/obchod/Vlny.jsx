/* ═══════════════════════════════════════════════════════
   TŘI VLNY

   Jeden motor (Vlna.jsx), tři otázky:

     Čekárna     → kdo to vůbec je        (role, nebo osobní)
     Developeři  → co staví a jak velké   (karta „má kolem sebe")
     Investoři   → co hledají a za kolik  (karta „hledá")

   Druhá a třetí vlna zapisují do deal_cards, protože „co hledá"
   už v aplikaci žije jako karta a podle ní funguje párování.
   Druhé, zjednodušené zadávání cílů by znamenalo dvě verze téže
   věci — té pasti se tahle aplikace vyhýbá důsledně.
   ═══════════════════════════════════════════════════════ */

import { useState, useEffect, useMemo, useCallback } from "react";
import Vlna from "./Vlna.jsx";
import {
  nactiCekarnu, zaradZCekarny, odlozZCekarny, vratZCekarny,
  lideKDoplneni, ulozKartu, smazKartu, aktivni, popis,
} from "./api.js";

/* ── PÁSMA MÍSTO ČÍSEL ───────────────────────────────────
   Michal 26. 10.: cena a velikost jsou čísla, a políčko na číslo
   vlnu zdrží stejně jako celý formulář.

   Pásmo se uloží jako cena_od / cena_do, takže párování funguje
   přesně tak jako u ručně vyplněné karty. Přesné číslo se dá
   kdykoli dopsat u konkrétního člověka — pásmo je první odhad,
   ne konečná pravda. */
const CENA_PASMA = [
  { key: "do10",   label: "do 10 mil",   od: null,       do: 10000000 },
  { key: "do50",   label: "10–50 mil",   od: 10000000,   do: 50000000 },
  { key: "do200",  label: "50–200 mil",  od: 50000000,   do: 200000000 },
  { key: "nad200", label: "nad 200 mil", od: 200000000,  do: null },
];

const VELIKOST_PASMA = [
  { key: "male",   label: "do 10 jednotek",  od: null, jednotka: "byt" },
  { key: "stredni", label: "10–50",          od: 10,   jednotka: "byt" },
  { key: "velke",  label: "50–200",          od: 50,   jednotka: "byt" },
  { key: "obri",   label: "nad 200",         od: 200,  jednotka: "byt" },
];

const pasmo = (seznam, klice) => seznam.find(p => (klice || []).includes(p.key)) || null;

/* ══ 1. ČEKÁRNA ══════════════════════════════════════════ */

export function VlnaCekarna({ theme, owner, ciselniky, onClose, onZmena }) {
  const [fronta, setFronta] = useState([]);
  const [nacitam, setNacitam] = useState(true);

  useEffect(() => {
    if (!owner) return;
    let zrus = false;
    setNacitam(true);
    nactiCekarnu(owner, { stav: "ceka" }, 500).then(r => {
      if (zrus) return;
      setFronta(r || []); setNacitam(false);
    });
    return () => { zrus = true; };
  }, [owner]);

  const kroky = useMemo(() => [{
    klic: "role",
    otazka: "Čím ti je?",
    vice: true,
    volby: [
      ...aktivni(ciselniky, "role").slice(0, 9).map(r => ({ key: r.key, label: r.label })),
      /* Osobní vylučuje role a role vylučují jeho — rodinu
         nezařazuješ jako investora. Vlastní klávesa 0, ať se
         nemíchá do číslování rolí. */
      { key: "__osobni", label: "🏠 Osobní", exkluzivni: true, klavesa: "0" },
    ],
  }], [ciselniky]);

  const potvrdit = useCallback(async (polozka, vyber) => {
    const vybrano = vyber.role || [];
    if (vybrano.length === 0) {
      const r = await odlozZCekarny(polozka.id);
      return { ok: r.ok, chyba: r.chyba, zpetnyKlic: null };
    }
    if (vybrano.includes("__osobni")) {
      const r = await zaradZCekarny(owner, polozka, { oblast: "osobni", role: [] });
      return { ok: r.ok, chyba: r.chyba, zpetnyKlic: r.osoba?.id || null };
    }
    const r = await zaradZCekarny(owner, polozka, { oblast: "prace", role: vybrano });
    return { ok: r.ok, chyba: r.chyba, zpetnyKlic: r.osoba?.id || null };
  }, [owner]);

  const zpet = useCallback(async (zaznam) => {
    const r = await vratZCekarny({ ...zaznam.polozka, person_id: zaznam.zpetnyKlic });
    onZmena?.();
    return {
      ok: r.ok, chyba: r.chyba,
      /* Člověka, u kterého už něco je, nemažeme — vzalo by to
         i tu poznámku. Musí to ale být vidět, jinak bys čekal,
         že je pryč. */
      hlaska: r.zustal
        ? `${zaznam.polozka.name} zůstal v Lidech — už u něj něco je. Smaž ho ručně, pokud ho tam nechceš.`
        : null,
    };
  }, [onZmena]);

  return (
    <Vlna theme={theme} nazev="Čekárna"
      napoveda="Nic tu nečeká. Kontakty se sem dostanou importem v Lidech — vezmi soubor z Google kontaktů nebo z telefonu."
      fronta={fronta} nacitam={nacitam}
      hlavicka={(p) => ({
        nazev: p.name,
        podnadpis: [p.firma, p.contact].filter(Boolean).join(" · "),
        dodatek: p.zdroj ? `z ${p.zdroj}` : null,
      })}
      kroky={kroky}
      onPotvrdit={async (p, v) => { const r = await potvrdit(p, v); onZmena?.(); return r; }}
      onZpet={zpet}
      onClose={onClose}
      upravitJmeno
      patka={<>
        Role se berou z tvého číselníku — přehodíš-li je v Nastavení →
        Seznamy, přehodí se i klávesy. Kritéria („co hledá") se tady
        nevyplňují schválně; na ně jsou vlny pro developery a investory.
        <br />
        Jméno se dá přepsat — jmenovci se v Lidech musí rozlišit,
        proto „Novák Pardubice" a „Novák Brno". Do čekárny se zápis
        nepropisuje, tam zůstane podoba ze souboru.
      </>} />
  );
}

/* ══ 2. a 3. KRITÉRIA ════════════════════════════════════
   Developer i investor jedou tutéž vlnu, liší se jen směrem
   karty a tím, na co se ptá druhý krok.

   smer = nabidka  → „má kolem sebe", tedy co staví
   smer = poptavka → „hledá", tedy co kupuje                */

export function VlnaKriterii({ theme, owner, ciselniky, role, onClose, onZmena }) {
  const [fronta, setFronta] = useState([]);
  const [nacitam, setNacitam] = useState(true);
  const developer = role === "developer";

  useEffect(() => {
    if (!owner) return;
    let zrus = false;
    setNacitam(true);
    lideKDoplneni(owner, role).then(r => {
      if (zrus) return;
      setFronta(r || []); setNacitam(false);
    });
    return () => { zrus = true; };
  }, [owner, role]);

  const kroky = useMemo(() => [
    {
      klic: "typy",
      otazka: developer ? "Co staví?" : "Co hledá?",
      vice: true,
      volby: aktivni(ciselniky, "typ").slice(0, 9).map(t => ({ key: t.key, label: t.label })),
    },
    developer
      ? {
          klic: "velikost",
          otazka: "Jak velké projekty?",
          vice: false,
          volby: VELIKOST_PASMA.map(p => ({ key: p.key, label: p.label })),
        }
      : {
          klic: "cena",
          otazka: "Za kolik?",
          vice: false,
          volby: CENA_PASMA.map(p => ({ key: p.key, label: p.label })),
        },
  ], [ciselniky, developer]);

  const potvrdit = useCallback(async (osoba, vyber) => {
    const typy = vyber.typy || [];
    // Bez typů není co zapsat — karta „cokoli za cokoli" neřekne nic.
    if (typy.length === 0) return { ok: true, zpetnyKlic: null };

    const data = {
      person_id: osoba.id,
      smer: developer ? "nabidka" : "poptavka",
      typy,
      kraje: [],
      aktivni: true,
    };
    if (developer) {
      const p = pasmo(VELIKOST_PASMA, vyber.velikost);
      if (p) { data.velikost_od = p.od; data.jednotka = p.jednotka; }
    } else {
      const p = pasmo(CENA_PASMA, vyber.cena);
      if (p) { data.cena_od = p.od; data.cena_do = p.do; }
    }
    const r = await ulozKartu(owner, data);
    return { ok: r.ok, chyba: r.chyba, zpetnyKlic: r.karta?.id || null };
  }, [owner, developer]);

  const zpet = useCallback(async (zaznam) => {
    // Karta vznikla jen tehdy, když se něco označilo.
    if (zaznam.zpetnyKlic) {
      const r = await smazKartu(zaznam.zpetnyKlic);
      if (!r.ok) return { ok: false, chyba: r.chyba };
    }
    onZmena?.();
    return { ok: true };
  }, [onZmena]);

  return (
    <Vlna theme={theme}
      nazev={developer ? "Developeři" : "Investoři"}
      napoveda={developer
        ? "Všichni developeři už mají vyplněné, co staví. Nové přibudou, až někoho označíš jako developera."
        : "Všichni investoři už mají kartu. Noví přibudou, až někoho označíš jako investora."}
      fronta={fronta} nacitam={nacitam}
      hlavicka={(p) => ({
        nazev: p.name,
        podnadpis: [p.firma, p.mesto || (p.kraj ? popis(ciselniky, "kraj", p.kraj) : null), p.contact]
          .filter(Boolean).join(" · "),
        dodatek: (p.role_tagy || []).map(r => popis(ciselniky, "role", r)).join(" · ") || null,
      })}
      kroky={kroky}
      onPotvrdit={async (p, v) => { const r = await potvrdit(p, v); onZmena?.(); return r; }}
      onZpet={zpet}
      onClose={onClose}
      patka={<>
        Pásma se ukládají jako rozsah na kartě, takže párování funguje
        hned. Přesná čísla, kraje i formu vstupu dopíšeš u konkrétního
        člověka — tahle vlna je první nástřel, ne konečná pravda.
        Koho přeskočíš Enterem, zůstane ve frontě na příště.
      </>} />
  );
}
