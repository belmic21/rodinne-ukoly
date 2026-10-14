/* ═══════════════════════════════════════════════════════
   OBCHOD — hlavní okno

   Tři části pod sebou:
     panel   — co čeká na mě
     filtry  — typ, kraj, fáze, stav, cena, velikost
     seznam  — zakázky, klik otevře detail

   Detail je ve stejném okně, ne v dalším překryvu — zpět
   se vracíš šipkou vlevo nahoře.
   ═══════════════════════════════════════════════════════ */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  nactiCiselniky, nactiPanel, nactiZakazky, nactiZakazku, zalozZakazku,
  upravZakazku, smazZakazku, popis, aktivni, rozeberVetu, jsemSpravce,
  kolikZakazek, prirustekZakazek, prehledPrilepenych, hledejVObsahu, nactiZakazku as nactiCelou,
  prehledFazi, probudSpici, prerazitKod, nazevSlozky, hledejObce,
} from "./api.js";
import {
  FONT, card, input, btn, btnMain, btnGhost, label,
  useEscapeKey, penizeKratce, penizePresne, parsePenize, jakDavno,
  kdyZadano, mesicKratce, pocet, zvyrazni, OBCHOD_VERZE,
} from "./ui.js";
import Site from "./Site.jsx";
import { Retezec, Geneze } from "./Zakazka.jsx";
import { SdileniZakazky, SdilenoSeMnou, Uzivatele } from "./Sdileni.jsx";
import Ciselniky from "./Ciselniky.jsx";
import Osoba from "./Osoba.jsx";
import { TerminySekce, TerminyPrehled } from "./Terminy.jsx";
import Lide from "./Lide.jsx";
import Prilepene, { Odznaky } from "./Prilepene.jsx";

const PRAZDNY_FILTR = {
  // typy a okresy jsou pole — „nemocnice NEBO alzheimer centrum",
  // „jižní Čechy A Plzeňsko". Jedno typ/kraj zůstává kvůli starým
  // uloženým filtrům; api.js bere pole přednostně.
  typy: [], okresy: [],
  typ: "", kraj: "", faze: "", stav: "",
  cenaOd: null, cenaDo: null, velikostOd: null, hledat: "",
  obdobi: "",   // "" | dnes | 7 | 30 | letos
};

/* Od kdy brát zakázky. Hranice se počítá tady, v prohlížeči —
   "dnes" se má řídit půlnocí u tebe, ne na serveru v Americe. */
const OBDOBI = [
  { k: "",      t: "Vše" },
  { k: "dnes",  t: "Dnes" },
  { k: "7",     t: "7 dní" },
  { k: "30",    t: "30 dní" },
  { k: "letos", t: "Letos" },
];

function odKdy(obdobi) {
  if (!obdobi) return null;
  const d = new Date();
  if (obdobi === "dnes")  { d.setHours(0, 0, 0, 0); return d.toISOString(); }
  if (obdobi === "letos") return new Date(d.getFullYear(), 0, 1).toISOString();
  const dni = Number(obdobi);
  if (!isFinite(dni)) return null;
  d.setDate(d.getDate() - dni);
  return d.toISOString();
}

export default function ObchodSheet({ currentUser, theme, initialDraft = "",
  initialOsoba = null, initialZakazka = null, initialZalozka = null,
  onClose, onDataZmena }) {
  useEscapeKey(onClose);
  const owner = currentUser?.name;

  const [ciselniky, setCiselniky] = useState({});
  const [panel, setPanel] = useState(null);
  const [filtr, setFiltr] = useState(PRAZDNY_FILTR);
  const [zakazky, setZakazky] = useState([]);
  const [vice, setVice] = useState(false);
  const [busy, setBusy] = useState(true);
  const [obnov, setObnov] = useState(0);
  const [otevrena, setOtevrena] = useState(null);
  const [nova, setNova] = useState(null);
  const [vicFiltru, setVicFiltru] = useState(false);
  const [statistika, setStatistika] = useState(false);
  const [faze, setFaze] = useState([]);
  const [prilepene, setPrilepene] = useState({});   // počty u řádků seznamu
  const [nalezy, setNalezy] = useState({});        // kde se co našlo při hledání
  const [zalozka, setZalozka] = useState(initialZalozka || "zakazky");
  // zakazky | lide | sit | terminy | sdilene
  const [nastaveni, setNastaveni] = useState(null);   // uzivatele | ciselniky
  // Přehled člověka se otevírá jako překryv nad vším ostatním.
  // Schválně: co máš rozepsané v zakázce, zůstane pod ním nedotčené.
  const [osobaId, setOsobaId] = useState(initialOsoba);
  // Na kterou sekci v detailu odrolovat — klik na odznak u řádku.
  const [skocNa, setSkocNa] = useState(null);
  // Správce se ptáme databáze, ne přihlášení. Rozhoduje o tom, jestli
  // smíš sáhnout i na to, co zapsal někdo jiný.
  const [spravce, setSpravce] = useState(false);
  const hledatRef = useRef(null);

  useEffect(() => {
    let zrus = false;
    jsemSpravce().then(v => { if (!zrus) setSpravce(v); });
    return () => { zrus = true; };
  }, []);

  const KROK = 25;
  const [kolik, setKolik] = useState(KROK);

  // Číselníky se načtou při otevření a po každé úpravě v nastavení.
  const [ciselnikyKlic, setCiselnikyKlic] = useState(0);
  useEffect(() => {
    if (!owner) return;
    let zrus = false;
    nactiCiselniky(owner).then(c => { if (!zrus) setCiselniky(c); });
    return () => { zrus = true; };
  }, [owner, ciselnikyKlic]);

  // Rychlé zadání z lomítka: otevře rovnou formulář s předvyplněným,
  // co se z věty dalo přečíst. Nic se neukládá bez tvého potvrzení.
  useEffect(() => {
    if (!initialDraft || !ciselniky.typ) return;
    setNova(rozeberVetu(initialDraft, ciselniky));
  }, [initialDraft, ciselniky.typ]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Kurzor rovnou v hledání, ať se dá psát bez klikání.
  useEffect(() => {
    if (!otevrena && !nova && zalozka === "zakazky") {
      setTimeout(() => hledatRef.current?.focus(), 80);
    }
  }, [otevrena, nova, zalozka]);

  useEffect(() => {
    if (!owner || zalozka !== "zakazky") return;
    let zrus = false;
    setBusy(true);
    const id = setTimeout(async () => {
      // Výběr oblasti se tady rozpadne na kraje, které do ní patří.
      const dotaz = { ...filtr, odKdy: odKdy(filtr.obdobi) };
      if (String(filtr.kraj || "").startsWith("oblast:")) {
        const g = filtr.kraj.slice(7);
        dotaz.kraje = (ciselniky.kraj || [])
          .filter(k => (k.skupina || "") === g).map(k => k.key);
        dotaz.kraj = "";
      }
      // Hledá se dvakrát: běžný dotaz na sloupce zakázky a vedle
      // toho napříč vším, co k ní patří — lidé, poznámky, úkoly,
      // termíny. Výsledky se slučují, ať "komín" z poznámky najde
      // zakázku stejně jako slovo z názvu.
      const [z, p, pri, nal] = await Promise.all([
        nactiZakazky(owner, dotaz, kolik + 1, 0),
        nactiPanel(owner),
        prehledPrilepenych(owner),
        hledejVObsahu(filtr.hledat),
      ]);
      if (zrus) return;
      let seznam = z;
      const chybi = Object.keys(nal).filter(id => !z.some(x => x.id === id));
      if (chybi.length) {
        const doplnene = (await Promise.all(chybi.slice(0, 20).map(nactiCelou)))
          .filter(Boolean);
        seznam = [...z, ...doplnene];
      }
      setVice(seznam.length > kolik);
      setZakazky(seznam.slice(0, kolik));
      setPanel(p);
      setPrilepene(pri);
      setNalezy(nal);
      setBusy(false);
    }, filtr.hledat ? 280 : 0);
    return () => { zrus = true; clearTimeout(id); };
  }, [owner, filtr, kolik, obnov, zalozka, ciselniky]);

  /* Fáze a probuzení spících. Spící zakázka se v den D vrátí mezi
     živé sama — řeší se to tady při otevření seznamu, aby na to
     nemusel běžet cron kvůli pár řádkům. */
  useEffect(() => {
    if (!owner || zalozka !== "zakazky") return;
    let zrus = false;
    (async () => {
      const probuzeno = await probudSpici();
      if (zrus) return;
      const f = await prehledFazi();
      if (zrus) return;
      setFaze(f || []);
      if (probuzeno > 0) setObnov(k => k + 1);
    })();
    return () => { zrus = true; };
  }, [owner, zalozka, obnov]);

  const zmenFiltr = useCallback((k, v) => {
    setKolik(KROK);
    setFiltr(f => ({ ...f, [k]: v }));
  }, []);

  const filtrAktivni = useMemo(
    () => Object.entries(filtr).some(([k, v]) => v !== PRAZDNY_FILTR[k]),
    [filtr]
  );

  const zavri = () => { setOtevrena(null); setNova(null); setSkocNa(null); setObnov(k => k + 1); };

  // Zakázka otevřená zvenku (z lupy). Načítá se celá, ne zkráceně.
  useEffect(() => {
    if (!initialZakazka) return;
    let zrus = false;
    nactiZakazku(initialZakazka).then(z => { if (!zrus && z) setOtevrena(z); });
    return () => { zrus = true; };
  }, [initialZakazka]);

  // Z přehledu člověka na zakázku. Načítáme ji celou — v přehledu
  // je jen zkrácená, a kdyby se uložila takhle, přepsala by
  // ostatní pole prázdnem.
  const otevriZakazku = async (zkracena) => {
    if (!zkracena?.id) return;
    const cela = await nactiZakazku(zkracena.id);
    if (!cela) return;
    setZalozka("zakazky");
    setOtevrena(cela);
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start",
      animation: "slideUp 0.25s",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: "860px", maxHeight: "92vh",
        marginTop: "20px", background: theme.bg, borderRadius: "16px",
        overflow: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
        fontFamily: FONT,
      }}>
        {nastaveni ? (
          <>
            <div style={{
              position: "sticky", top: 0, zIndex: 3, background: theme.bg,
              padding: "14px 16px", borderBottom: `1px solid ${theme.cardBorder}`,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <button onClick={() => setNastaveni(null)} title="Zpět" aria-label="Zpět" style={{
                ...btn(), background: "transparent", color: theme.textSub,
                fontSize: "15px", padding: "2px 6px",
              }}>←</button>
              <div style={{ display: "flex", gap: 4, flex: 1 }}>
                {[
                  { k: "uzivatele", t: "Uživatelé" },
                  { k: "ciselniky", t: "Seznamy" },
                ].map(v => {
                  const zap = nastaveni === v.k;
                  return (
                    <button key={v.k} onClick={() => setNastaveni(v.k)} style={{
                      ...btn(),
                      background: zap ? theme.accentSoft : "transparent",
                      border: `1px solid ${zap ? theme.accentBorder : "transparent"}`,
                      color: zap ? theme.accent : theme.textSub,
                      fontSize: "13px", fontWeight: 700, padding: "4px 11px", borderRadius: 8,
                    }}>{v.t}</button>
                  );
                })}
              </div>
              <button title="Zavřít" aria-label="Zavřít" onClick={onClose} style={{
                background: "none", border: "none", fontSize: "20px",
                cursor: "pointer", color: theme.textSub, padding: "0 4px",
              }}>×</button>
            </div>
            <div style={{ padding: "12px 16px 18px" }}>
              {nastaveni === "ciselniky"
                ? <Ciselniky theme={theme} owner={owner}
                    onZmena={() => setCiselnikyKlic(k => k + 1)} />
                : <Uzivatele theme={theme} owner={owner} />}
            </div>
          </>
        ) : nova ? (
          <Detail
            theme={theme} owner={owner} ciselniky={ciselniky} spravce={spravce}
            predvyplneno={nova} onBack={zavri} onClose={onClose}
            onOtevriOsobu={setOsobaId}
          />
        ) : otevrena ? (
          <Detail
            theme={theme} owner={owner} ciselniky={ciselniky} spravce={spravce}
            zakazka={otevrena} onBack={zavri} onClose={onClose}
            onOtevriOsobu={setOsobaId} skocNa={skocNa} onDataZmena={onDataZmena}
          />
        ) : (
          <>
            {/* ══ Hlavička a panel ══ */}
            <div style={{
              position: "sticky", top: 0, zIndex: 3, background: theme.bg,
              padding: "14px 16px", borderBottom: `1px solid ${theme.cardBorder}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: "16px" }}>💼</span>
                <div style={{ display: "flex", gap: 4, flex: 1 }}>
                  {[
                    { k: "zakazky", t: "Zakázky" },
                    { k: "lide",    t: "Lidé" },
                    { k: "sit",     t: "Karty" },
                    { k: "terminy", t: "Termíny" },
                    { k: "sdilene", t: "Sdíleno se mnou" },
                  ].map(z => {
                    const zap = zalozka === z.k;
                    return (
                      <button key={z.k} onClick={() => setZalozka(z.k)} style={{
                        ...btn(),
                        background: zap ? theme.accentSoft : "transparent",
                        border: `1px solid ${zap ? theme.accentBorder : "transparent"}`,
                        color: zap ? theme.accent : theme.textSub,
                        fontSize: "13px", fontWeight: 700, padding: "4px 11px",
                        borderRadius: 8,
                      }}>{z.t}</button>
                    );
                  })}
                </div>
                {currentUser?.admin && (
                  <button onClick={() => setNastaveni("uzivatele")} title="Nastavení" aria-label="Nastavení" style={{
                    ...btn(), background: "transparent", color: theme.textSub,
                    fontSize: "14px", padding: "2px 6px",
                  }}>⚙</button>
                )}
                <span title={`modul obchod ${OBCHOD_VERZE}`} style={{
                  fontSize: "9.5px", color: theme.textDim,
                  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                }}>{OBCHOD_VERZE}</span>
                {zalozka === "zakazky" && (
                  <button onClick={() => setNova({ nazev: "" })} style={btnMain(theme)}>
                    + zakázka
                  </button>
                )}
                <button title="Zavřít" aria-label="Zavřít" onClick={onClose} style={{
                  background: "none", border: "none", fontSize: "20px",
                  cursor: "pointer", color: theme.textSub, padding: "0 4px",
                }}>×</button>
              </div>

              {zalozka === "zakazky" && (
                <>
                  <Panel theme={theme} panel={panel}
                    onTerminy={() => setZalozka("terminy")} />

                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <input
                      ref={hledatRef}
                      value={filtr.hledat}
                      onChange={e => zmenFiltr("hledat", e.target.value)}
                      placeholder="Hledat — číslo zakázky, název, město…"
                      style={{ ...input(theme), flex: 1 }}
                    />
                    <button onClick={() => setVicFiltru(v => !v)} style={{
                      ...btnGhost(theme),
                      background: vicFiltru || filtrAktivni ? theme.accentSoft : "transparent",
                      color: vicFiltru || filtrAktivni ? theme.accent : theme.textSub,
                      borderColor: vicFiltru || filtrAktivni ? theme.accentBorder : theme.cardBorder,
                      whiteSpace: "nowrap",
                    }}>filtry</button>
                    <button onClick={() => setStatistika(v => !v)} title="Kolik zakázek v čase" aria-label="Kolik zakázek v čase"
                      style={{
                        ...btnGhost(theme),
                        background: statistika ? theme.accentSoft : "transparent",
                        color: statistika ? theme.accent : theme.textSub,
                        borderColor: statistika ? theme.accentBorder : theme.cardBorder,
                        whiteSpace: "nowrap",
                      }}>statistika</button>
                    {filtrAktivni && (
                      <button onClick={() => { setFiltr(PRAZDNY_FILTR); setKolik(KROK); }}
                        style={{ ...btnGhost(theme), whiteSpace: "nowrap" }}>Zrušit</button>
                    )}
                  </div>

                  {/* Kdy byla zakázka zadaná. Nejčastější filtr vůbec,
                      proto je na ráně a ne schovaný pod „filtry". */}
                  <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
                    {OBDOBI.map(o => {
                      const zap = filtr.obdobi === o.k;
                      return (
                        <button key={o.k || "vse"} onClick={() => zmenFiltr("obdobi", o.k)} style={{
                          ...btn(),
                          background: zap ? theme.accentSoft : "transparent",
                          border: `1px solid ${zap ? theme.accentBorder : theme.cardBorder}`,
                          color: zap ? theme.accent : theme.textSub,
                          fontSize: "11.5px", padding: "3px 10px", borderRadius: 13,
                          fontWeight: zap ? 700 : 600,
                        }}>{o.t}</button>
                      );
                    })}
                  </div>

                  {/* Pás s fázemi. Odpověď na „na čem se dělá“ bez
                      otevírání čehokoli — a klik je rovnou filtr.
                      Archiv je na konci, oddělený a sbalený: hotové
                      a padlé zakázky nemají tříštit pozornost. */}
                  <PasFazi theme={theme} faze={faze} filtr={filtr} zmen={zmenFiltr} />

                  {/* Rychlý tip. Je přímo tady, ne za tlačítkem
                      „+ ZAKÁZKA" — tipů bude desítky a každý klik
                      navíc je důvod ho nezapsat. */}
                  <RychlyTip theme={theme} owner={owner} ciselniky={ciselniky}
                    onZalozeno={() => setObnov(k => k + 1)} />

                  {statistika && <Statistika theme={theme} owner={owner} />}

                  {vicFiltru && (
                    <Filtry theme={theme} ciselniky={ciselniky} filtr={filtr} zmen={zmenFiltr} />
                  )}
                </>
              )}
            </div>

            {zalozka === "lide" ? (
              <Lide theme={theme} owner={owner} ciselniky={ciselniky}
                onOtevriOsobu={setOsobaId} />
            ) : zalozka === "sit" ? (
              <Site theme={theme} owner={owner} ciselniky={ciselniky}
                onOtevriOsobu={setOsobaId} />
            ) : zalozka === "terminy" ? (
              <TerminyPrehled theme={theme} owner={owner}
                onOtevriZakazku={otevriZakazku} onOtevriOsobu={setOsobaId}
                onNaZakazky={() => setZalozka("zakazky")} />
            ) : zalozka === "sdilene" ? (
              <SdilenoSeMnou theme={theme} ciselniky={ciselniky}
                onOtevriSpolupraci={otevriZakazku} />
            ) : (
              /* ══ Seznam zakázek ══ */
              <div style={{ padding: "10px 16px 18px" }}>
                {busy && zakazky.length === 0 && (
                  <Prazdno theme={theme}>Načítám…</Prazdno>
                )}
                {!busy && zakazky.length === 0 && (
                  <Prazdno theme={theme}>
                    {filtrAktivni
                      ? "Nic nesedí. Zkus ubrat filtr."
                      : "Zatím tu nic není. Tlačítkem nahoře založ první zakázku."}
                  </Prazdno>
                )}
                {zakazky.map(z => (
                  <Radek key={z.id} z={z} theme={theme} ciselniky={ciselniky}
                    pocty={prilepene[z.id]} nalez={nalezy[z.id]} hledano={filtr.hledat}
                    onOpen={() => { setSkocNa(null); setOtevrena(z); }}
                    onOdznak={() => { setSkocNa("prilepene"); setOtevrena(z); }} />
                ))}
                {vice && (
                  <button onClick={() => setKolik(k => k + KROK)} style={{
                    ...btnGhost(theme), width: "100%", marginTop: 8, padding: "9px",
                  }}>načíst další</button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {osobaId && (
        <div onClick={(e) => { e.stopPropagation(); setOsobaId(null); }} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          zIndex: 1001, display: "flex", justifyContent: "center", alignItems: "flex-start",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "100%", maxWidth: "720px", maxHeight: "88vh", marginTop: "26px",
            background: theme.bg, borderRadius: "16px", overflow: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)", fontFamily: FONT,
          }}>
            <Osoba theme={theme} owner={owner} personId={osobaId} ciselniky={ciselniky}
              onZpet={() => setOsobaId(null)}
              onOtevriZakazku={(p) => { setOsobaId(null); otevriZakazku(p); }} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Panel: co čeká na mě ──────────────────────────── */

function Panel({ theme, panel, onTerminy }) {
  const polozky = [
    { k: "zakazek_aktivnich", t: "aktivních", barva: theme.text },
    { k: "osloveni_ceka",     t: "čeká na ně", barva: theme.accent },
    { k: "terminy_po",        t: "po termínu", barva: theme.red,    kam: "terminy" },
    { k: "terminy_tyden",     t: "do týdne",   barva: theme.yellow, kam: "terminy" },
    { k: "bez_odezvy_14dni",  t: "ticho 14 dní", barva: theme.textSub },
  ];
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {polozky.map(p => {
        const n = panel ? Number(panel[p.k] || 0) : 0;
        return (
          <div key={p.k}
            onClick={() => { if (p.kam === "terminy") onTerminy?.(); }}
            style={{
            ...card(theme), flex: 1, padding: "7px 10px", textAlign: "center",
            cursor: p.kam ? "pointer" : "default",
            borderColor: p.kam && n > 0 ? `${p.barva}55` : theme.cardBorder,
          }}>
            <div style={{
              fontSize: "17px", fontWeight: 700, lineHeight: 1.1,
              color: n > 0 ? p.barva : theme.textDim,
            }}>{n}</div>
            <div style={{ fontSize: "10px", color: theme.textSub, marginTop: 1 }}>{p.t}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Statistika: kolik zakázek v čase ───────────────────
   Jedna veličina, jeden graf. Objem v korunách se do stejného
   obrázku nevejde — osy by byly dvě a každý sloupec by se dal
   číst dvěma způsoby. Proto je objem jen číslo pod grafem.

   Sloupec, ne čára: měsíční přírůstky jsou oddělené události,
   ne plynulý průběh. Prázdné měsíce v řadě zůstávají, jinak by
   tři zakázky ze tří různých měsíců vypadaly jako souvislý tok. */

function Statistika({ theme, owner }) {
  const [cisla, setCisla] = useState(null);
  const [rada, setRada] = useState([]);
  const [busy, setBusy] = useState(true);
  const [najeto, setNajeto] = useState(null);

  useEffect(() => {
    if (!owner) return;
    let zrus = false;
    setBusy(true);
    Promise.all([kolikZakazek(owner), prirustekZakazek(owner, 12)])
      .then(([c, r]) => { if (!zrus) { setCisla(c); setRada(r); setBusy(false); } });
    return () => { zrus = true; };
  }, [owner]);

  const maximum = useMemo(
    () => Math.max(1, ...rada.map(r => Number(r.pocet) || 0)),
    [rada]
  );
  const celkemObjem = useMemo(
    () => rada.reduce((s, r) => s + (Number(r.objem) || 0), 0),
    [rada]
  );
  const zaRok = useMemo(
    () => rada.reduce((s, r) => s + (Number(r.pocet) || 0), 0),
    [rada]
  );

  if (busy) {
    return (
      <div style={{ ...card(theme), padding: "12px 14px", marginTop: 9,
        fontSize: "12px", color: theme.textSub }}>Počítám…</div>
    );
  }

  const prehled = [
    { k: "dnes",   t: "dnes" },
    { k: "tyden",  t: "za 7 dní" },
    { k: "mesic",  t: "za 30 dní" },
    { k: "letos",  t: "letos" },
    { k: "celkem", t: "celkem" },
  ];

  return (
    <div style={{ ...card(theme), padding: "12px 14px", marginTop: 9 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        {prehled.map(p => (
          <div key={p.k}>
            <div style={{
              fontSize: "17px", fontWeight: 700, lineHeight: 1.1,
              color: theme.text, fontVariantNumeric: "tabular-nums",
            }}>{cisla ? Number(cisla[p.k] || 0) : 0}</div>
            <div style={{ fontSize: "10px", color: theme.textSub, marginTop: 1 }}>{p.t}</div>
          </div>
        ))}
      </div>

      <div style={{
        ...label(theme), marginBottom: 7,
        display: "flex", alignItems: "baseline", gap: 8,
      }}>
        <span>Nové zakázky po měsících</span>
        <span style={{
          marginLeft: "auto", textTransform: "none", letterSpacing: 0,
          fontWeight: 400, fontSize: "11px", color: theme.textSub,
        }}>
          {najeto
            ? `${mesicKratce(najeto.mesic)} — ${pocet(Number(najeto.pocet) || 0, "zakázka", "zakázky", "zakázek")}`
            : `${pocet(zaRok, "zakázka", "zakázky", "zakázek")} za 12 měsíců`}
        </span>
      </div>

      {/* Sloupce. Tenké, zaoblené nahoře, ukotvené k základní lince.
          Číslo se píše jen nad nejvyšší sloupec — popisek na každém
          by z grafu udělal tabulku. */}
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 2,
        height: 86, paddingBottom: 2,
        borderBottom: `1px solid ${theme.cardBorder}`,
      }}>
        {rada.map((r, i) => {
          const n = Number(r.pocet) || 0;
          const vyska = n === 0 ? 2 : Math.max(5, Math.round((n / maximum) * 72));
          const zvyraznit = najeto ? najeto.mesic === r.mesic : n === maximum && n > 0;
          return (
            <div key={i}
              onMouseEnter={() => setNajeto(r)}
              onMouseLeave={() => setNajeto(null)}
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "flex-end",
                height: "100%", cursor: "default",
              }}>
              {zvyraznit && n > 0 && (
                <div style={{
                  fontSize: "10px", fontWeight: 700, color: theme.text,
                  marginBottom: 2, fontVariantNumeric: "tabular-nums",
                }}>{n}</div>
              )}
              {/* Tenký sloupec, ne široký blok. Plocha nenese informaci,
                  nese ji výška — široké bloky jen dělají graf těžkým. */}
              <div style={{
                width: "62%", maxWidth: 26, height: vyska,
                background: n === 0 ? theme.cardBorder : theme.accent,
                opacity: najeto && najeto.mesic !== r.mesic ? 0.45 : 1,
                borderRadius: n === 0 ? 1 : "4px 4px 0 0",
                transition: "opacity 0.12s",
              }} />
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
        {rada.map((r, i) => (
          <div key={i} style={{
            flex: 1, textAlign: "center", fontSize: "9px",
            color: theme.textDim, whiteSpace: "nowrap", overflow: "hidden",
          }}>
            {/* Popisek jen u každého druhého měsíce, jinak se slijí. */}
            {i % 2 === 0 ? mesicKratce(r.mesic) : ""}
          </div>
        ))}
      </div>

      {celkemObjem > 0 && (
        <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 9, lineHeight: 1.6 }}>
          Objem zakázek za těch 12 měsíců: {penizeKratce(celkemObjem)}.
          Počítají se jen zakázky s vyplněnou cenou.
        </div>
      )}
    </div>
  );
}

/* ── Filtry ────────────────────────────────────────── */

function Filtry({ theme, ciselniky, filtr, zmen }) {
  /* Oba výběry se skládají pod rodiny, ale rodina znamená u každého
     něco jiného — a klíč v databázi je strojový, ne čitelný:

       typ   → skupina je rodina ('zdravotnictvi'), názvy drží
               číselník rodina_typu
       okres → skupina je klíč kraje ('stredocesky'), názvy drží
               číselník kraj

     Bez těchhle dvou slovníků by v panelu svítily nadpisy
     „zdravotnictvi" a „stredocesky". */
  const rodinyTypu = useMemo(() => Object.fromEntries(
    (ciselniky?.rodina_typu || []).map(r => [r.key, r.label])
  ), [ciselniky]);
  const rodinyOkresu = useMemo(() => Object.fromEntries(
    (ciselniky?.kraj || []).map(r => [r.key, r.label])
  ), [ciselniky]);

  // Prahy velikosti: zaškrtnutí "nad 50" vrátí i 85 a 100.
  const prahy = [
    { v: 50,  t: "50+" },
    { v: 100, t: "100+" },
    { v: 200, t: "200+" },
  ];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
      gap: 8, marginTop: 9,
    }}>
      <VyberVice theme={theme} nadpis="Typ" vybrane={filtr.typy}
        polozky={aktivni(ciselniky, "typ")}
        nazvyRodin={rodinyTypu} onZmena={v => zmen("typy", v)} />
      <VyberVice theme={theme} nadpis="Okres" vybrane={filtr.okresy}
        polozky={aktivni(ciselniky, "okres")}
        nazvyRodin={rodinyOkresu} onZmena={v => zmen("okresy", v)} />
      <SelectKraj theme={theme} hodnota={filtr.kraj}
        polozky={aktivni(ciselniky, "kraj")} onZmena={v => zmen("kraj", v)} />
      <Select theme={theme} nadpis="Fáze" hodnota={filtr.faze}
        polozky={aktivni(ciselniky, "faze")} onZmena={v => zmen("faze", v)} />
      <Select theme={theme} nadpis="Stav" hodnota={filtr.stav}
        polozky={aktivni(ciselniky, "stav_zakazky")} onZmena={v => zmen("stav", v)} />

      <div>
        <span style={label(theme)}>Cena od</span>
        <input defaultValue={filtr.cenaOd ? penizePresne(filtr.cenaOd) : ""}
          onBlur={e => zmen("cenaOd", parsePenize(e.target.value))}
          placeholder="50 mil" style={input(theme)} />
      </div>
      <div>
        <span style={label(theme)}>Cena do</span>
        <input defaultValue={filtr.cenaDo ? penizePresne(filtr.cenaDo) : ""}
          onBlur={e => zmen("cenaDo", parsePenize(e.target.value))}
          placeholder="100 mil" style={input(theme)} />
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <span style={label(theme)}>Velikost nejméně</span>
        <div style={{ display: "flex", gap: 5 }}>
          {prahy.map(p => {
            const zap = filtr.velikostOd === p.v;
            return (
              <button key={p.v}
                onClick={() => zmen("velikostOd", zap ? null : p.v)}
                style={{
                  ...btnGhost(theme),
                  background: zap ? theme.accentSoft : "transparent",
                  color: zap ? theme.accent : theme.textSub,
                  borderColor: zap ? theme.accentBorder : theme.cardBorder,
                }}>{p.t}</button>
            );
          })}
          <input
            value={filtr.velikostOd && !prahy.some(p => p.v === filtr.velikostOd)
              ? filtr.velikostOd : ""}
            onChange={e => {
              const n = parseFloat(e.target.value.replace(",", "."));
              zmen("velikostOd", isFinite(n) ? n : null);
            }}
            placeholder="vlastní" style={{ ...input(theme), maxWidth: 90 }} />
        </div>
      </div>
    </div>
  );
}

/* Kraj, nebo rovnou celá oblast. Investor, který bere Prahu
   a střední Čechy, nemá vybírat dva kraje zvlášť. */
function SelectKraj({ theme, hodnota, polozky, onZmena }) {
  const skupiny = useMemo(() => {
    const m = new Map();
    for (const p of polozky) {
      const g = p.skupina || "Ostatní";
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(p);
    }
    return [...m.entries()];
  }, [polozky]);

  return (
    <div>
      <span style={label(theme)}>Kraj nebo oblast</span>
      <select value={hodnota || ""} onChange={e => onZmena(e.target.value)}
        style={{ ...input(theme), cursor: "pointer" }}>
        <option value="">kdekoli</option>
        {skupiny.map(([g, items]) => (
          <optgroup key={g} label={g}>
            <option value={`oblast:${g}`}>— celá oblast {g} —</option>
            {items.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function Select({ theme, nadpis, hodnota, polozky, onZmena, skupiny = false,
  bezPrazdne = false, prazdne = "vše" }) {
  const sk = useMemo(() => {
    if (!skupiny) return null;
    const m = new Map();
    for (const p of polozky) {
      const g = p.skupina || "Ostatní";
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(p);
    }
    return [...m.entries()];
  }, [polozky, skupiny]);

  return (
    <div>
      <span style={label(theme)}>{nadpis}</span>
      <select value={hodnota || ""} onChange={e => onZmena(e.target.value)}
        style={{ ...input(theme), cursor: "pointer" }}>
        {!bezPrazdne && <option value="">{prazdne}</option>}
        {sk
          ? sk.map(([g, items]) => (
              <optgroup key={g} label={g}>
                {items.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </optgroup>
            ))
          : polozky.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
    </div>
  );
}

/* ── Rychlý tip ─────────────────────────────────────────
   Michal má v systému jednu živou zakázku a desítky věcí, o kterých
   ví a nemá na ně kontakt. Dokud se tip zadával plným formulářem,
   nezadal se — devět polí za zvěst je moc.

   Tady je jedno pole. Napíšeš, jak to řekneš nahlas:

     „nemocnice Jičín, slyšel jsem od Fera"

   a pod polem je VIDĚT, co z toho aplikace pochopila, ještě než
   cokoli uložíš. To je ten rozdíl proti hádání: nic se nestane
   potichu. Co nerozpozná, zůstane v názvu a opravíš to v detailu.

   Zakládá se vždycky ve stavu tip. Tip není živá zakázka — na tipu
   nepracuješ, zatím o něm jen víš. */
function RychlyTip({ theme, owner, ciselniky, onZalozeno }) {
  const [text, setText] = useState("");
  const [uklada, setUklada] = useState(false);
  const [chyba, setChyba] = useState(null);
  const [hotovo, setHotovo] = useState(null);
  const [obec, setObec] = useState(null);

  const rozbor = useMemo(
    () => (text.trim() ? rozeberVetu(text, ciselniky) : null),
    [text, ciselniky]);

  /* Město se dohledává v číselníku obcí, ne hádá. Zkouší se
     kandidáti v pořadí, jak stáli ve větě, a bere se první shoda —
     kdo se nenajde, zůstane v názvu. Bez tohohle by z „Bělá"
     vznikla „Bělá pod Bezdězem" nebo „Bělá nad Radbuzou", což
     jsou dvě různá místa stě kilometrů od sebe. */
  useEffect(() => {
    let zrus = false;
    const kand = rozbor?.mestoKandidati || [];
    if (!kand.length) { setObec(null); return; }
    (async () => {
      for (const k of kand) {
        const n = await hledejObce(k, 3);
        if (zrus) return;
        const presne = n.find(o =>
          o.nazev.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
          === k.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
        if (presne || n.length === 1) { setObec(presne || n[0]); return; }
      }
      setObec(null);
    })();
    return () => { zrus = true; };
  }, [rozbor]);

  const uloz = async () => {
    if (!rozbor?.nazev) return;
    setUklada(true); setChyba(null);
    const data = {
      nazev: rozbor.nazev,
      stav: "tip",
      typ: rozbor.typ || null,
      cena: rozbor.cena ?? null,
      velikost: rozbor.velikost ?? null,
      jednotka: rozbor.jednotka || null,
      // Co se nepodařilo dohledat v číselníku obcí, jde do volného
      // textu. Zahodit to by znamenalo ztratit jedinou informaci
      // o tom, kde ta věc vlastně je.
      mesto: obec?.nazev || null,
      mesto_kod: obec?.kod || null,
      okres: obec?.okres || null,
      kraj: obec?.kraj || null,
      lokalita_text: obec ? null : (rozbor.mestoKandidati?.[0] || null),
      // Odkud to vím. U tipu je to nejcennější údaj — bez něj je
      // tip jen zvěst, se kterou se nedá nic dělat.
      souhrn: rozbor.odKoho ? `Tip od: ${rozbor.odKoho}` : null,
    };
    const res = await zalozZakazku(owner, data);
    setUklada(false);
    if (!res.ok) { setChyba(res.chyba || "Nepovedlo se uložit."); return; }
    setHotovo(rozbor.nazev);
    setText("");
    onZalozeno?.();
    setTimeout(() => setHotovo(null), 4000);
  };

  const znacka = (co, hodnota, barva) => (
    <span style={{
      fontSize: 11.5, fontWeight: 400, color: theme.textSub,
      background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
      borderRadius: 7, padding: "3px 8px", whiteSpace: "nowrap",
    }}>
      {co}{" "}
      <strong style={{ fontWeight: 600, color: barva || theme.text }}>{hodnota}</strong>
    </span>
  );

  return (
    <div style={{ marginTop: 9 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <input
          value={text}
          onChange={e => { setText(e.target.value); setChyba(null); }}
          onKeyDown={e => { if (e.key === "Enter" && rozbor?.nazev && !uklada) uloz(); }}
          placeholder="nemocnice Jičín, slyšel jsem od Fera"
          title="Napiš tip jednou větou. Co z toho aplikace pochopí, uvidíš pod polem."
          aria-label="Rychlé zadání tipu jednou větou"
          style={{ ...input(theme), flex: 1 }} />
        <button
          onClick={uloz}
          disabled={!rozbor?.nazev || uklada}
          title={rozbor?.nazev
            ? `Založit tip „${rozbor.nazev}" — ve stavu Tip, nikam se neodesílá`
            : "Nejdřív napiš, o čem tip je"}
          aria-label="Založit tip"
          style={{
            ...btnMain(theme), minHeight: 40, padding: "0 16px",
            whiteSpace: "nowrap",
            background: rozbor?.nazev ? theme.accent : theme.inputBg,
            color: rozbor?.nazev ? "#fff" : theme.textSub,
            cursor: rozbor?.nazev && !uklada ? "pointer" : "default",
          }}>{uklada ? "Ukládám…" : "+ TIP"}</button>
      </div>

      {/* Co aplikace pochopila. Schválně PŘED uložením — kdyby se
          to ukazovalo až potom, bylo by to hlášení, ne kontrola. */}
      {rozbor && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7, alignItems: "center" }}>
          {znacka("název", rozbor.nazev)}
          {rozbor.typ && znacka("typ", popis(ciselniky, "typ", rozbor.typ))}
          {obec && znacka("místo", `${obec.nazev} · ${popis(ciselniky, "okres", obec.okres) || obec.okres}`)}
          {!obec && rozbor.mestoKandidati?.length > 0 && znacka("místo", rozbor.mestoKandidati[0], theme.yellow)}
          {rozbor.odKoho && znacka("od", rozbor.odKoho)}
          {rozbor.cena != null && znacka("cena", penizeKratce(rozbor.cena))}
          {rozbor.velikost != null && znacka("velikost", `${rozbor.velikost} ${popis(ciselniky, "jednotka", rozbor.jednotka) || rozbor.jednotka || ""}`)}
          {!rozbor.typ && (
            <span style={{ fontSize: 11.5, color: theme.textSub }}>
              typ nerozpoznán — doplníš v detailu
            </span>
          )}
        </div>
      )}

      {chyba && (
        <div style={{ marginTop: 6, fontSize: 12, color: theme.red }}>{chyba}</div>
      )}
      {hotovo && (
        <div style={{ marginTop: 6, fontSize: 12, color: theme.green }}>
          Založeno jako tip: <strong style={{ fontWeight: 600 }}>{hotovo}</strong>.
          {" "}Najdeš ho pod dlaždicí <strong style={{ fontWeight: 600 }}>Tip</strong> nad seznamem.
        </div>
      )}
    </div>
  );
}

/* ── Výběr více položek ─────────────────────────────────
   Michal: „že bych si např. vyfiltroval jen nemocnice nebo
   alzheimer centra v Praze? Nebo např. průmyslové parky na jihu
   čech a v plzni?"

   To jsou dvě otázky, na které jeden rozbalovací seznam neumí
   odpovědět — obě chtějí víc hodnot naráz. Proto zaškrtávací
   panel, který se rozbalí a zase zabalí.

   Typů je po doplnění oborů sedmnáct. Plochý seznam sedmnácti
   položek se nedá přečíst, proto se skládají pod rodiny (Bydlení,
   Zdravotnictví, Průmysl a logistika, Obchod a služby, Pozemky).
   Rodina má vlastní zaškrtávátko — „celé zdravotnictví" je jedno
   kliknutí, ne pět.

   Zavřený stav vždycky řekne, co je vybrané. „Typ: vše" nebo
   „Typ: Nemocnice +2" — nikdy jen „Typ", protože pak člověk
   nevidí, že filtruje, a divil by se prázdnému seznamu. */
function VyberVice({ theme, nadpis, vybrane = [], polozky, nazvyRodin, onZmena }) {
  const [otevreno, setOtevreno] = useState(false);

  const rodiny = useMemo(() => {
    const m = new Map();
    for (const p of polozky) {
      const g = p.skupina || "";
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(p);
    }
    return [...m.entries()];
  }, [polozky]);

  const prepni = (k) => {
    const s = new Set(vybrane);
    if (s.has(k)) s.delete(k); else s.add(k);
    onZmena([...s]);
  };

  const prepniRodinu = (klice) => {
    const s = new Set(vybrane);
    const vseZapnuto = klice.every(k => s.has(k));
    for (const k of klice) { if (vseZapnuto) s.delete(k); else s.add(k); }
    onZmena([...s]);
  };

  const souhrn = vybrane.length === 0
    ? "vše"
    : (() => {
        const prvni = polozky.find(p => p.key === vybrane[0])?.label || vybrane[0];
        return vybrane.length === 1 ? prvni : `${prvni} +${vybrane.length - 1}`;
      })();

  const ctverec = (zap) => ({
    width: 15, height: 15, flex: "0 0 auto", borderRadius: 4,
    border: `1.5px solid ${zap ? theme.inputFocus || theme.accent : theme.inputBorder}`,
    background: zap ? (theme.inputFocus || theme.accent) : theme.inputBg,
    color: "#fff", fontSize: 10, fontWeight: 900, lineHeight: "13px",
    textAlign: "center",
  });

  return (
    <div style={{ gridColumn: otevreno ? "1 / -1" : "auto" }}>
      <span style={label(theme)}>{nadpis}</span>
      <button
        onClick={() => setOtevreno(o => !o)}
        aria-expanded={otevreno}
        title={vybrane.length
          ? `Vybráno ${vybrane.length} — kliknutím ${otevreno ? "zabalíš" : "rozbalíš"} výběr`
          : `Nefiltruje se podle ${nadpis.toLowerCase()} — kliknutím vybereš`}
        aria-label={`${nadpis}: ${souhrn}`}
        style={{
          ...input(theme), cursor: "pointer", textAlign: "left",
          display: "flex", alignItems: "center", gap: 7,
          fontWeight: vybrane.length ? 700 : 400,
        }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {souhrn}
        </span>
        <span style={{ flex: "0 0 auto", color: theme.textSub, fontSize: 11 }}>
          {otevreno ? "▴" : "▾"}
        </span>
      </button>

      {otevreno && (
        <div style={{
          marginTop: 6, padding: "10px 11px",
          background: theme.card, border: `1px solid ${theme.cardBorder}`,
          borderRadius: 10,
        }}>
          {rodiny.map(([rodina, items]) => {
            const klice = items.map(i => i.key);
            const vseZap = klice.every(k => vybrane.includes(k));
            return (
              <div key={rodina || "bez"} style={{ marginBottom: 9 }}>
                {rodina && (
                  /* Celá rodina jedním kliknutím. Klikací je celý
                     řádek i s názvem, ne jen čtvereček — viz
                     JAZYK.md, oddíl 4. */
                  <button onClick={() => prepniRodinu(klice)}
                    title={vseZap ? `Odebrat celou rodinu ${nazvyRodin?.[rodina] || rodina}`
                                  : `Vybrat celou rodinu ${nazvyRodin?.[rodina] || rodina}`}
                    aria-label={`${vseZap ? "Odebrat" : "Vybrat"} celou rodinu ${nazvyRodin?.[rodina] || rodina}`}
                    aria-pressed={vseZap}
                    style={{
                      ...btn(), background: "transparent", padding: "2px 0",
                      display: "flex", alignItems: "center", gap: 7, width: "100%",
                      textAlign: "left", marginBottom: 4,
                    }}>
                    <span style={ctverec(vseZap)}>{vseZap ? "✓" : ""}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                      textTransform: "uppercase", color: theme.textSub,
                    }}>{nazvyRodin?.[rodina] || rodina}</span>
                  </button>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, paddingLeft: rodina ? 22 : 0 }}>
                  {items.map(p => {
                    const zap = vybrane.includes(p.key);
                    return (
                      <button key={p.key} onClick={() => prepni(p.key)}
                        aria-pressed={zap}
                        title={zap ? `Odebrat ${p.label} z filtru` : `Přidat ${p.label} do filtru`}
                        aria-label={p.label}
                        style={{
                          ...btn(), display: "flex", alignItems: "center", gap: 6,
                          padding: "6px 10px", fontSize: 12.5, fontWeight: zap ? 700 : 500,
                          background: zap ? `${theme.accent}18` : theme.inputBg,
                          color: zap ? theme.text : theme.textSub,
                          border: `1px solid ${zap ? theme.accent : theme.inputBorder}`,
                        }}>
                        <span style={ctverec(zap)}>{zap ? "✓" : ""}</span>
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {vybrane.length > 0 && (
            <button onClick={() => onZmena([])}
              title={`Přestat filtrovat podle ${nadpis.toLowerCase()}`}
              aria-label={`Zrušit filtr ${nadpis}`}
              style={{
                ...btn(), background: "transparent", color: theme.textSub,
                border: `1px solid ${theme.cardBorder}`, padding: "5px 11px", fontSize: 12,
              }}>Zrušit výběr</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Řádek seznamu ─────────────────────────────────── */

/* Odpočet do nejbližšího termínu. Barva se řídí tím, kolik zbývá —
   stejná logika jako v Termínech, ať se to po aplikaci nerozchází. */
function Odpocet({ theme, pocty }) {
  const d = pocty?.terminDni;
  if (d === null || d === undefined) return null;
  const barva = d < 0 ? theme.red : d <= 2 ? theme.red : d <= 7 ? theme.yellow : theme.textSub;
  const text = d < 0 ? `po termínu ${Math.abs(d)} d`
    : d === 0 ? "dnes" : d === 1 ? "zítra" : `za ${d} dní`;
  return (
    <div style={{ textAlign: "right", whiteSpace: "nowrap", minWidth: 0 }}>
      <div style={{ fontSize: "11.5px", fontWeight: 700, color: barva }}>{text}</div>
      <div style={{
        fontSize: "10px", color: theme.textSub, maxWidth: 150,
        overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {[pocty.terminKdo, pocty.terminNazev].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
}

function Radek({ z, theme, ciselniky, onOpen, onOdznak, pocty, nalez, hledano }) {
  const misto = [z.mesto, popis(ciselniky, "kraj", z.kraj)].filter(Boolean).join(", ");
  return (
    <div onClick={onOpen} style={{
      ...card(theme), padding: "10px 12px", marginBottom: 7, cursor: "pointer",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{
        fontSize: "10px", fontWeight: 700, color: theme.textSub,
        fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
      }}>{z.kod}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: "13px", fontWeight: 700, color: theme.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{z.nazev}</div>
        <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 1 }}>
          {[
            popis(ciselniky, "typ", z.typ),
            misto,
            z.velikost ? `${z.velikost} ${popis(ciselniky, "jednotka", z.jednotka)}` : "",
            popis(ciselniky, "faze", z.faze),
            kdyZadano(z.created_at),
          ].filter(Boolean).join(" · ")}
        </div>

        {/* Proč se zakázka našla. Bez tohohle řádku by u hledání
            "komín" vyskočila zakázka a nebylo by poznat proč. */}
        {nalez && (
          <div style={{
            fontSize: "11px", color: theme.textSub, marginTop: 3,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            <span style={{
              fontSize: "9.5px", fontWeight: 700, textTransform: "uppercase",
              color: theme.accent, marginRight: 6,
            }}>{nalez.kde}</span>
            {zvyrazni(nalez.ukazka, hledano).map((k, i) => (
              <span key={i} style={k.shoda ? {
                background: `${theme.yellow}40`, color: theme.text,
                fontWeight: 700, borderRadius: 3, padding: "0 2px",
              } : undefined}>{k.text}</span>
            ))}
          </div>
        )}
      </div>

      <Odpocet theme={theme} pocty={pocty} />

      <Odznaky theme={theme} pocty={pocty} onKlik={onOdznak} />

      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: theme.text }}>
          {penizeKratce(z.cena)}
        </div>
        {z.stav && (
          <div style={{ fontSize: "10px", color: theme.textSub, marginTop: 1 }}>
            {popis(ciselniky, "stav_zakazky", z.stav)}
          </div>
        )}
      </div>
    </div>
  );
}

function Prazdno({ theme, children }) {
  return (
    <div style={{
      ...card(theme), padding: "22px 16px", textAlign: "center",
      color: theme.textSub, fontSize: "12px",
    }}>{children}</div>
  );
}

/* ── Detail zakázky ────────────────────────────────── */

function Detail({ theme, owner, ciselniky, zakazka = null, predvyplneno = null,
  onBack, onClose, onOtevriOsobu, spravce = false, skocNa = null, onDataZmena }) {
  const novy = !zakazka;
  // Zakázka, kterou se mnou někdo sdílí ve spolupráci. Hlavička je jeho,
  // do průběhu zapisovat můžu. Správce může i hlavičku.
  const cizi = !novy && !!zakazka?.owner && zakazka.owner !== owner;
  const smimHlavicku = !cizi || spravce;
  const [f, setF] = useState(() => {
    const z = {
      nazev: "", typ: "", velikost: "", jednotka: "byt",
      zeme: "CZ", kraj: "", okres: "", mesto: "", mesto_kod: "", lokalita_text: "",
      faze: "", cena: "", odmena: "", stav: novy ? "novy" : "",
      souhrn: "", slozka_odkaz: "",
      ...(zakazka || {}),
      ...(predvyplneno || {}),
    };
    // V poli se cena ukazuje po tisících (3 500 000), ne jako holé číslo.
    // Mezery se při ukládání zase odeberou, takže se nic neztratí.
    if (typeof z.cena === "number") z.cena = penizePresne(z.cena);
    return z;
  });
  const [uklada, setUklada] = useState(false);
  const [chyba, setChyba] = useState(null);
  const [ulozeno, setUlozeno] = useState(null);
  const [mazu, setMazu] = useState(false);
  const [kopirovano, setKopirovano] = useState(false);
  const nazevRef = useRef(null);

  const zakazkaId = zakazka?.id || ulozeno?.id || null;
  const [novyTermin, setNovyTermin] = useState(0);
  const [zkopirovano, setZkopirovano] = useState(false);
  const terminyRef = useRef(null);
  const kod = zakazka?.kod || ulozeno?.kod || null;

  useEffect(() => { setTimeout(() => nazevRef.current?.focus(), 80); }, []);

  const uprav = (k, v) => { setF(p => ({ ...p, [k]: v })); setChyba(null); };

  const uloz = async () => {
    if (!f.nazev?.trim()) { setChyba("Název je potřeba vyplnit."); return; }
    setUklada(true); setChyba(null);
    const data = {
      ...f,
      cena: parsePenize(f.cena),
      velikost: f.velikost === "" || f.velikost === null ? null : Number(f.velikost),
    };
    const res = zakazkaId
      ? await upravZakazku(zakazkaId, data)
      : await zalozZakazku(owner, data);
    setUklada(false);
    if (!res.ok) { setChyba(res.chyba); return; }
    setUlozeno(res.zakazka);
    setF(p => ({ ...p, ...res.zakazka, cena: penizePresne(res.zakazka.cena) }));
  };

  const smaz = async () => {
    if (!zakazkaId) { onBack(); return; }
    setMazu(true);
    const res = await smazZakazku(zakazkaId);
    setMazu(false);
    if (res.ok) onBack();
    else setChyba(res.chyba);
  };

  const kopirujSlozku = async () => {
    if (!kod) return;
    const text = `${kod} ${f.nazev}`.trim();
    try {
      await navigator.clipboard.writeText(text);
      setKopirovano(true);
      setTimeout(() => setKopirovano(false), 1800);
    } catch (e) { /* schránka není vždy dostupná, nevadí */ }
  };

  return (
    <>
      <div style={{
        position: "sticky", top: 0, zIndex: 3, background: theme.bg,
        padding: "14px 16px", borderBottom: `1px solid ${theme.cardBorder}`,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <button onClick={onBack} title="Zpět" aria-label="Zpět" style={{
          ...btn(), background: "transparent", color: theme.textSub,
          fontSize: "15px", padding: "2px 6px",
        }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: theme.text }}>
            {novy && !ulozeno ? "Nová zakázka" : f.nazev || "Zakázka"}
          </div>
          {kod && (
            <div onClick={kopirujSlozku} title="Zkopírovat název složky pro disk"
              style={{ fontSize: "11px", color: theme.accent, cursor: "pointer", marginTop: 1 }}>
              {kod} {kopirovano ? "· zkopírováno" : "· kopírovat název složky"}
            </div>
          )}
        </div>
        <button title="Zavřít" aria-label="Zavřít" onClick={onClose} style={{
          background: "none", border: "none", fontSize: "20px",
          cursor: "pointer", color: theme.textSub, padding: "0 4px",
        }}>×</button>
      </div>

      <div style={{ padding: "14px 16px 20px" }}>
        {cizi && (
          <div style={{
            border: `1px solid ${theme.green}55`, background: `${theme.green}10`,
            borderRadius: 9, padding: "9px 12px", marginBottom: 12,
            fontSize: "11.5px", color: theme.textSub, lineHeight: 1.6,
          }}>
            <strong style={{ color: theme.green }}>Spolupráce.</strong>{" "}
            Zakázku vede {zakazka.owner}. {smimHlavicku
              ? "Jako správce můžeš měnit i jeho zápisy."
              : "Průběh sem zapisovat můžeš — oslovení, termíny, poznámky. Hlavičku mění jen on."}
          </div>
        )}

        {!smimHlavicku ? (
          <JenCist theme={theme} ciselniky={ciselniky} z={zakazka} />
        ) : (
        <>
        <div style={{ marginBottom: 10 }}>
          <span style={label(theme)}>Název</span>
          <input ref={nazevRef} value={f.nazev || ""} onChange={e => uprav("nazev", e.target.value)}
            placeholder="Rezidence Zličín" style={{ ...input(theme), fontWeight: 700, fontSize: "14px" }} />
        </div>

        <div style={{ marginBottom: 10 }}>
          <span style={label(theme)}>Souhrn — o co jde</span>
          <textarea value={f.souhrn || ""} onChange={e => uprav("souhrn", e.target.value)}
            rows={4} placeholder="Co to je, co k tomu je za dokumentaci, na co si dát pozor."
            style={{ ...input(theme), resize: "vertical", lineHeight: 1.6 }} />
        </div>

        {/* Parametry zakázky. U NOVÉ jsou rozbalené a vyplníš je spolu
            s názvem na jedné obrazovce — tohle byla chyba: celý blok byl
            zabalený v podmínce „jen u uložené zakázky“, takže při zakládání
            nebyl vidět vůbec a cenu ani lokalitu nešlo zadat.
            U uložené se sbalí do přehledu a otevírají se tužkou. */}
            <Podrobnosti theme={theme} ciselniky={ciselniky} f={f} otevreno={!zakazkaId}>
        <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 9, marginBottom: 10,
          }}>
            <Select theme={theme} nadpis="Typ" hodnota={f.typ}
              polozky={aktivni(ciselniky, "typ")} onZmena={v => uprav("typ", v)} />
            <Select theme={theme} nadpis="Fáze přípravy" hodnota={f.faze}
              polozky={aktivni(ciselniky, "faze")} onZmena={v => uprav("faze", v)} />

            <div>
              <span style={label(theme)}>Akviziční cena</span>
              <input value={f.cena ?? ""} onChange={e => uprav("cena", e.target.value)}
                placeholder="90 mil" style={input(theme)} />
            </div>

            <div>
              <span style={label(theme)}>Velikost</span>
              <div style={{ display: "flex", gap: 5 }}>
                <input value={f.velikost ?? ""} onChange={e => uprav("velikost", e.target.value)}
                  placeholder="85" style={{ ...input(theme), flex: 1 }} />
                <select value={f.jednotka || "byt"} onChange={e => uprav("jednotka", e.target.value)}
                  style={{ ...input(theme), width: 85, cursor: "pointer" }}>
                  {aktivni(ciselniky, "jednotka").map(j => (
                    <option key={j.key} value={j.key}>{j.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Země rozhoduje, co se ptá dál a jak se razí kód:
                doma kraj a okres, v zahraničí město. */}
            <Select theme={theme} nadpis="Země" hodnota={f.zeme || "CZ"} skupiny
              polozky={aktivni(ciselniky, "zeme")} bezPrazdne
              onZmena={v => uprav("zeme", v)} />

            {(f.zeme || "CZ") === "CZ" ? (
              <>
                {/* Kraj a okres se vyplní výběrem města. Měnit je jde
                    pořád — u pozemku mezi dvěma vesnicemi se hodí
                    zapsat okres a město nechat být. */}
                <Select theme={theme} nadpis="Kraj" hodnota={f.kraj} skupiny
                  polozky={aktivni(ciselniky, "kraj")}
                  onZmena={v => { uprav("kraj", v); uprav("okres", ""); }} />

                {/* Okres se nabízí jen z vybraného kraje. Bez toho
                    je to 77 položek v jednom seznamu. */}
                <Select theme={theme} nadpis="Okres" hodnota={f.okres}
                  polozky={aktivni(ciselniky, "okres")
                    .filter(o => !f.kraj || o.skupina === f.kraj)}
                  onZmena={v => uprav("okres", v)} />
              </>
            ) : (
              <div>
                <span style={label(theme)}>Zkratka města do kódu</span>
                <input value={f.mesto_kod || ""} maxLength={4}
                  onChange={e => uprav("mesto_kod", e.target.value.toUpperCase())}
                  placeholder="WIEN" style={input(theme)} />
                <div style={{ fontSize: "10.5px", color: theme.textSub, marginTop: 3 }}>
                  Nevyplníš-li, udělá se z názvu města.
                </div>
              </div>
            )}

            <VyberMesta theme={theme} f={f} uprav={uprav} ciselniky={ciselniky} />

            <div>
              <span style={label(theme)}>Odměna</span>
              <input value={f.odmena || ""} onChange={e => uprav("odmena", e.target.value)}
                placeholder="5 % / 100 tis." style={input(theme)} />
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <span style={label(theme)}>Přesná lokalita</span>
            <input value={f.lokalita_text || ""} onChange={e => uprav("lokalita_text", e.target.value)}
              placeholder="Ulice, parcela, odkaz na mapu" style={input(theme)} />
          </div>

            </Podrobnosti>

        {chyba && (
          <div style={{
            background: `${theme.red}18`, border: `1px solid ${theme.red}44`,
            borderRadius: 8, padding: "8px 11px", fontSize: "12px",
            color: theme.red, marginBottom: 10,
          }}>{chyba}</div>
        )}

        {/* Fáze je to, co se u zakázky mění nejčastěji, takže patří
            na oči a ne pod „víc“. Posun doprava znamená, že se obchod
            hýbe — proto jsou v řadě, ne v rozbalovátku. */}
        <FazeVolba theme={theme} ciselniky={ciselniky} f={f} uprav={uprav} />

        <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={uloz} disabled={uklada} style={{
            ...btnMain(theme), opacity: uklada ? 0.6 : 1,
          }}>{uklada ? "UKLÁDÁM…" : "ULOŽIT"}</button>

          <span style={{ flex: 1 }} />

          {zakazkaId && (
            <Smazat theme={theme} mazu={mazu} onSmaz={smaz} />
          )}
        </div>

        {/* Termín nahoře a velký. Nejčastější věc, kterou u otevřené
            zakázky uděláš, je slíbit někomu, že se ozveš — a dolů
            k sekci Termíny se cestou ten slib stihne zapomenout.
            Tlačítko otevře stejný editor dole a sjede k němu. */}
        {zakazkaId && (
          <button onClick={() => {
            setNovyTermin(k => k + 1);
            setTimeout(() => terminyRef.current?.scrollIntoView({
              behavior: "smooth", block: "start",
            }), 60);
          }} style={{
            ...btnMain(theme), width: "100%", marginTop: 10,
            padding: "12px 14px", fontSize: "14px", letterSpacing: "0.02em",
            background: theme.purple,
          }}>⏳ + TERMÍN — komu se mám ozvat a do kdy</button>
        )}

        {ulozeno && !chyba && (
          <div style={{ fontSize: "11px", color: theme.green, marginTop: 8 }}>
            Uloženo {jakDavno(ulozeno.updated_at)}.
          </div>
        )}

        </>
        )}

        {zakazkaId && (
          <>

            <Prilepene theme={theme} owner={owner} projectId={zakazkaId}
              kod={kod} spravce={spravce} skocSem={skocNa === "prilepene"}
              onZmena={onDataZmena} />
            <Retezec theme={theme} owner={owner} ciselniky={ciselniky} spravce={spravce}
              projectId={zakazkaId} onOtevriOsobu={onOtevriOsobu} />
            <Geneze theme={theme} owner={owner} ciselniky={ciselniky} spravce={spravce}
              zakazka={{ id: zakazkaId, nazev: f.nazev }}
              onOtevriOsobu={onOtevriOsobu} />
            <div ref={terminyRef} />
            <TerminySekce theme={theme} owner={owner} projectId={zakazkaId} spravce={spravce}
              spustitNovy={novyTermin}
              ciselniky={ciselniky} nazevZakazky={f.nazev} onOtevriOsobu={onOtevriOsobu} />

            {/* Odkaz na složku se zadá jednou a pak se jen otvírá —
                nahoře by zabíral místo, kde chceš vidět souhrn a úkoly. */}
            <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 14 }}>
          <span style={label(theme)}>Odkaz na složku s podklady</span>
          {/* Název složky do schránky. Kód zůstává čistý, složka
              čitelná — a na disku je hned vidět, o co jde. */}
          {zakazkaId && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <code style={{
                fontSize: "11.5px", color: theme.textSub, background: theme.inputBg,
                border: `1px solid ${theme.cardBorder}`, borderRadius: 6, padding: "3px 7px",
              }}>{nazevSlozky({ kod: ulozeno?.kod || zakazka?.kod, nazev: f.nazev })}</code>
              <button onClick={() => {
                const t = nazevSlozky({ kod: ulozeno?.kod || zakazka?.kod, nazev: f.nazev });
                try { navigator.clipboard.writeText(t); setZkopirovano(true); setTimeout(() => setZkopirovano(false), 2000); } catch (e) {}
              }} style={btnGhost(theme)}>{zkopirovano ? "✓ zkopírováno" : "kopírovat název složky"}</button>
            </div>
          )}
          <input value={f.slozka_odkaz || ""} onChange={e => uprav("slozka_odkaz", e.target.value)}
            placeholder="https://… (OneDrive, Dropbox)" style={input(theme)} />
          {f.slozka_odkaz && (
            <a href={f.slozka_odkaz} target="_blank" rel="noreferrer"
              style={{ fontSize: "11px", color: theme.accent, marginTop: 3, display: "inline-block" }}>
              otevřít složku →
            </a>
          )}
        </div>
            </div>

            {/* Komu je zakázka sdílená, rozhoduje její vlastník. Partner
                tuhle sekci nevidí — nemá co rozdávat cizí zakázku dál. */}
            {!cizi && (
              <SdileniZakazky theme={theme} owner={owner} projectId={zakazkaId} />
            )}
          </>
        )}

        {!zakazkaId && (
          <div style={{
            fontSize: "11.5px", color: theme.textSub, marginTop: 14, lineHeight: 1.7,
          }}>
            Až zakázku uložíš, přibude sem řetězec lidí, seznam oslovených,
            termíny, úkoly s poznámkami a nastavení sdílení.
          </div>
        )}
      </div>
    </>
  );
}

/* Sbalitelný blok s technickými údaji. Typ, fáze, cena, kraj —
   vyplní se při zakládání a pak se k nim člověk vrací málokdy.
   Nahoře má být to, co odpovídá na „o co jde" a „co je potřeba". */
/* Parametry zakázky. Zavřené se čtou jako věta, otevřené se
   editují. Dřív tu byly výběrové seznamy pořád — jenže typ a fázi
   vyplníš jednou při zakládání a pak chceš jen vidět, co to je. */
function Podrobnosti({ theme, ciselniky, f, otevreno = false, children }) {
  const [open, setOpen] = useState(otevreno);

  const radky = [
    ["Typ", popis(ciselniky, "typ", f.typ)],
    ["Velikost", f.velikost ? `${f.velikost} ${popis(ciselniky, "jednotka", f.jednotka)}` : null],
    ["Cena", f.cena ? `${f.cena} ${f.mena || "CZK"}` : null],
    ["Odměna", f.odmena],
    ["Lokalita", [f.mesto, popis(ciselniky, "kraj", f.kraj)].filter(Boolean).join(", ")],
    ["Adresa", f.lokalita_text],
    ["Fáze", popis(ciselniky, "faze", f.faze)],
    ["Stav", popis(ciselniky, "stav_zakazky", f.stav)],
  ].filter(([, v]) => v);

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span style={{ ...label(theme), marginBottom: 0, flex: 1 }}>O zakázce</span>
        <button onClick={() => setOpen(v => !v)}
          title={open ? "Zavřít úpravy" : "Upravit"} style={{
            ...btn(), background: "transparent", color: open ? theme.accent : theme.textSub,
            fontSize: "12px", padding: "2px 6px",
          }}>{open ? "hotovo" : "✎ upravit"}</button>
      </div>

      {!open && (
        <div style={{
          ...card(theme), padding: "10px 13px",
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: "5px 16px",
        }}>
          {radky.length === 0 ? (
            <span style={{ fontSize: "11.5px", color: theme.textSub }}>
              Zatím nevyplněno — tužkou doplníš typ, cenu a lokalitu.
            </span>
          ) : radky.map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: "11px", color: theme.textSub, minWidth: 62 }}>{k}</span>
              <span style={{ fontSize: "12.5px", color: theme.text, minWidth: 0 }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {open && <div style={{ marginTop: 9 }}>{children}</div>}
    </div>
  );
}

/* Hlavička cizí zakázky. Stejná data, jen k přečtení — formulář
   by sliboval uložení, které by databáze stejně odmítla. */
function JenCist({ theme, ciselniky, z }) {
  const Radek = ({ popisek, hodnota }) => hodnota ? (
    <div style={{ display: "flex", gap: 10, marginBottom: 5 }}>
      <span style={{ fontSize: "11px", color: theme.textSub, minWidth: 96 }}>{popisek}</span>
      <span style={{ fontSize: "12.5px", color: theme.text }}>{hodnota}</span>
    </div>
  ) : null;

  return (
    <>
      <div style={{ ...card(theme), padding: "12px 14px", marginBottom: 10 }}>
        <Radek popisek="Typ"      hodnota={popis(ciselniky, "typ", z.typ)} />
        <Radek popisek="Velikost" hodnota={z.velikost
          ? `${z.velikost} ${popis(ciselniky, "jednotka", z.jednotka)}` : null} />
        <Radek popisek="Lokalita" hodnota={[z.mesto, popis(ciselniky, "kraj", z.kraj)]
          .filter(Boolean).join(", ")} />
        <Radek popisek="Podrobně" hodnota={z.lokalita_text} />
        <Radek popisek="Fáze"     hodnota={popis(ciselniky, "faze", z.faze)} />
        <Radek popisek="Cena"     hodnota={z.cena != null ? penizeKratce(z.cena) : null} />
        <Radek popisek="Odměna"   hodnota={z.odmena} />
        <Radek popisek="Stav"     hodnota={popis(ciselniky, "stav_zakazky", z.stav)} />
      </div>

      {z.souhrn && (
        <div style={{ ...card(theme), padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ ...label(theme), marginBottom: 5 }}>Souhrn</div>
          <div style={{
            fontSize: "12.5px", color: theme.text, lineHeight: 1.7, whiteSpace: "pre-wrap",
          }}>{z.souhrn}</div>
        </div>
      )}

      {z.slozka_odkaz && (
        <a href={z.slozka_odkaz} target="_blank" rel="noreferrer" style={{
          ...card(theme), padding: "10px 14px", marginBottom: 10,
          display: "block", color: theme.accent, fontSize: "12.5px",
          textDecoration: "none", fontWeight: 600,
        }}>📂 otevřít podklady →</a>
      )}
    </>
  );
}

/* Mazání na dvě kliknutí. Okno prohlížeče se v nainstalované
   aplikaci chová nespolehlivě, tak potvrzení řešíme uvnitř. */
function Smazat({ theme, mazu, onSmaz }) {
  const [ptam, setPtam] = useState(false);
  if (!ptam) {
    return (
      <button onClick={() => setPtam(true)} style={{
        ...btnGhost(theme), color: theme.red, borderColor: `${theme.red}44`,
      }}>🗑 Smazat</button>
    );
  }
  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: "11px", color: theme.textSub }}>Opravdu?</span>
      <button onClick={onSmaz} disabled={mazu} style={{
        ...btnMain(theme), background: theme.red, opacity: mazu ? 0.6 : 1,
      }}>{mazu ? "MAŽU…" : "ANO"}</button>
      <button onClick={() => setPtam(false)} style={btnGhost(theme)}>Zrušit</button>
    </span>
  );
}


/* ── Pás s fázemi ────────────────────────────────────────
   Kolik zakázek je v které fázi, klik = filtr. Živé fáze jsou
   vždycky vidět, i prázdné — jinak by pás přeskakoval pokaždé,
   když se poslední zakázka ve fázi posune dál, a oko by ztratilo
   orientaci.

   Archiv je schválně až za oddělovačem a sbalený. Hotové a padlé
   zakázky mají být po ruce, ne na očích. */
function PasFazi({ theme, faze, filtr, zmen }) {
  const [archivOtevreny, setArchivOtevreny] = useState(false);
  if (!faze || faze.length === 0) return null;

  /* Tři skupiny, ne dvě. Tip není archiv — je to začátek cesty,
     ne její konec. Dokud byl v pásu jen „živé" a „všechno ostatní",
     tipy by se schovaly pod archiv vedle padlých zakázek, což je
     přesně obrácený význam.

     Tipy stojí před živými: nejdřív o zakázce víš, pak na ni
     seženeš kontakt a teprve pak na ní pracuješ. */
  const tipy = faze.filter(f => f.skupina === "tip");
  const zive = faze.filter(f => f.skupina === "zive");
  const jinde = faze.filter(f => f.skupina !== "zive" && f.skupina !== "tip");
  const vArchivu = jinde.reduce((a, f) => a + (f.pocet || 0), 0);

  const Dlazdice = ({ f }) => {
    const zap = filtr.stav === f.stav;
    return (
      <button onClick={() => zmen("stav", zap ? "" : f.stav)} style={{
        ...btn(),
        background: zap ? theme.accentSoft : "transparent",
        border: `1px solid ${zap ? theme.accentBorder : theme.cardBorder}`,
        color: zap ? theme.accent : (f.pocet ? theme.text : theme.textSub),
        fontSize: "11.5px", padding: "4px 10px", borderRadius: 13,
        fontWeight: zap ? 700 : 600, whiteSpace: "nowrap",
        display: "inline-flex", alignItems: "center", gap: 5,
        opacity: f.pocet ? 1 : 0.55,
      }}>
        {f.label}
        <span style={{
          fontVariantNumeric: "tabular-nums",
          color: zap ? theme.accent : theme.textSub, fontWeight: 700,
        }}>{f.pocet}</span>
        {/* Kolik z nich se dva týdny nehnulo. Tohle číslo odhalí
            problém dřív, než o něm někdo řekne. */}
        {f.nehybe_se > 0 && (
          <span title={`${f.nehybe_se} se nehýbe přes 14 dní`} style={{
            color: theme.yellow, fontWeight: 700,
          }}>⚠{f.nehybe_se}</span>
        )}
      </button>
    );
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
        {tipy.map(f => <Dlazdice key={f.stav} f={f} />)}
        {tipy.length > 0 && zive.length > 0 && (
          <span style={{ color: theme.cardBorder, padding: "0 2px" }}>|</span>
        )}
        {zive.map(f => <Dlazdice key={f.stav} f={f} />)}

        {jinde.length > 0 && (
          <>
            <span style={{ color: theme.cardBorder, padding: "0 2px" }}>|</span>
            <button onClick={() => setArchivOtevreny(v => !v)} style={{
              ...btn(), background: "transparent", color: theme.textSub,
              fontSize: "11.5px", padding: "4px 8px", fontWeight: 600,
            }}>{archivOtevreny ? "▲" : "▼"} archiv {vArchivu}</button>
          </>
        )}
      </div>

      {archivOtevreny && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
          {jinde.map(f => <Dlazdice key={f.stav} f={f} />)}
          <span style={{ fontSize: "10.5px", color: theme.textSub, alignSelf: "center" }}>
            Archiv se v seznamu neukazuje, dokud na fázi neklikneš.
          </span>
        </div>
      )}
    </div>
  );
}


/* ── Volba fáze ──────────────────────────────────────────
   Devět fází v řadě. Živé jsou vidět vždycky, ukončovací až po
   kliknutí na „ukončit“ — aby se omylem neodklepla hotová zakázka
   místo posunu o krok dál.

   Dvě fáze si vynucují doplnění: Nerealizováno chce důvod (jinak
   se nikdy nedozvíš, proč ti padá každá třetí zakázka) a Spí chce
   datum, kdy se má vrátit. */
function FazeVolba({ theme, ciselniky, f, uprav }) {
  const vse = aktivni(ciselniky, "stav_zakazky");
  /* Tip je vidět hned u zakládání — to je celý jeho smysl. Michal:
     „mohl bych zadat zakázky, o kterých vím, ale nemám na ně
     aktuální kontakt, tím pádem nemohou být živé, ale mohou být
     potenciální." Kdyby byl schovaný pod „… ukončit" vedle padlých
     zakázek, nikdo by ho nenašel a tipy by se zakládaly jako Nové. */
  const tipy = vse.filter(x => x.skupina === "tip");
  const zive = vse.filter(x => (x.skupina || "zive") === "zive");
  const konec = vse.filter(x => {
    const s = x.skupina || "zive";
    return s !== "zive" && s !== "tip";
  });
  const jeKonec = konec.some(x => x.key === f.stav);
  const [ukoncuji, setUkoncuji] = useState(jeKonec);

  const Dlazdice = ({ x, barva }) => {
    const zap = f.stav === x.key;
    return (
      <button onClick={() => uprav("stav", x.key)} style={{
        ...btn(),
        background: zap ? (barva ? `${barva}18` : theme.accentSoft) : "transparent",
        border: `1px solid ${zap ? (barva || theme.accentBorder) : theme.cardBorder}`,
        color: zap ? (barva || theme.accent) : theme.textSub,
        fontSize: "12px", padding: "5px 11px", borderRadius: 14,
        fontWeight: zap ? 700 : 600, whiteSpace: "nowrap",
      }}>{x.label}</button>
    );
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <span style={label(theme)}>Fáze zakázky</span>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
        {tipy.map(x => <Dlazdice key={x.key} x={x} barva={theme.yellow} />)}
        {tipy.length > 0 && (
          <span style={{ color: theme.cardBorder, padding: "0 2px" }}>|</span>
        )}
        {zive.map(x => <Dlazdice key={x.key} x={x} />)}
        {!ukoncuji && !jeKonec && (
          <button onClick={() => setUkoncuji(true)} style={{
            ...btn(), background: "transparent", color: theme.textSub,
            fontSize: "12px", padding: "5px 9px", fontWeight: 600,
          }}>… ukončit</button>
        )}
        {(ukoncuji || jeKonec) && konec.map(x => (
          <Dlazdice key={x.key} x={x}
            barva={x.key === "nerealizovano" ? theme.red
                 : x.key === "vyplaceno" ? theme.green : theme.textSub} />
        ))}
      </div>

      {f.stav === "nerealizovano" && (
        <div style={{ marginTop: 8 }}>
          <span style={label(theme)}>Proč to padlo</span>
          <select value={f.duvod_nerealizace || ""}
            onChange={e => uprav("duvod_nerealizace", e.target.value)}
            style={{ ...input(theme), cursor: "pointer", maxWidth: 280 }}>
            <option value="">— vyber důvod —</option>
            {aktivni(ciselniky, "duvod_nerealizace").map(d => (
              <option key={d.key} value={d.key}>{d.label}</option>
            ))}
          </select>
          {!f.duvod_nerealizace && (
            <div style={{ fontSize: "11px", color: theme.yellow, marginTop: 4 }}>
              Bez důvodu se nikdy nedozvíš, na čem ti obchody padají.
            </div>
          )}
        </div>
      )}

      {f.stav === "spi" && (
        <div style={{ marginTop: 8 }}>
          <span style={label(theme)}>Vrátit se k ní</span>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
            <input type="date" value={f.spi_do || ""}
              onChange={e => uprav("spi_do", e.target.value)}
              style={{ ...input(theme), maxWidth: 160, cursor: "pointer" }} />
            {[{ t: "za měsíc", d: 30 }, { t: "za čtvrt roku", d: 90 }, { t: "za půl roku", d: 180 }].map(v => (
              <button key={v.d} onClick={() => {
                const d = new Date(); d.setDate(d.getDate() + v.d);
                uprav("spi_do", d.toISOString().slice(0, 10));
              }} style={btnGhost(theme)}>{v.t}</button>
            ))}
          </div>
          <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 4 }}>
            V ten den se zakázka sama vrátí mezi živé jako Nová.
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Výběr města ─────────────────────────────────────────
   Píšeš název, vybereš ze seznamu a kraj s okresem se doplní samy.
   Jedna volba místo tří — a hlavně si nemůžou protiřečit.

   Že to není zbytečné: Rudná je v Česku dvakrát (Praha-západ
   a Svitavy), Čistá třikrát. Volný text by to tipl, seznam se ptá.

   V zahraničí se seznam nepoužívá — není kde ho vzít — a město
   zůstává volným polem. */
function VyberMesta({ theme, f, uprav, ciselniky }) {
  const [q, setQ] = useState("");
  const [nalezy, setNalezy] = useState([]);
  const [otevreno, setOtevreno] = useState(false);
  const [hleda, setHleda] = useState(false);
  const [mimo, setMimo] = useState(false);
  const zahranici = (f.zeme || "CZ") !== "CZ";

  useEffect(() => {
    if (zahranici || !otevreno) return;
    const text = q.trim();
    if (text.length < 2) { setNalezy([]); return; }
    let zrus = false;
    setHleda(true);
    const id = setTimeout(async () => {
      // Bere se víc řádků, než se ukáže: když je okres nebo kraj už
      // vybraný, většina nálezů se zahodí. "Nová Ves" je v Česku
      // přes třicetkrát a při limitu 15 by ta správná vypadla.
      const r = await hledejObce(text, 50);
      if (zrus) return;
      const vse = r || [];
      // Vybraný okres je tvrdší filtr než kraj. Když máš Mladou
      // Boleslav, nemá smysl nabízet Čistou u Rakovníka.
      const uzsi = f.okres ? vse.filter(o => o.okres === f.okres)
                 : f.kraj  ? vse.filter(o => o.kraj === f.kraj)
                 : vse;
      // Kdyby v tom okrese nic nebylo, ukáže se radši všechno než nic —
      // s poznámkou, že to je mimo vybraný okres.
      setNalezy((uzsi.length ? uzsi : vse).slice(0, 15));
      setMimo(uzsi.length === 0 && vse.length > 0 && !!(f.okres || f.kraj));
      setHleda(false);
    }, 220);
    return () => { zrus = true; clearTimeout(id); };
  }, [q, otevreno, zahranici, f.okres, f.kraj]);

  const vyber = (o) => {
    uprav("mesto", o.nazev);
    uprav("okres", o.okres);
    uprav("kraj", o.kraj);
    setOtevreno(false);
    setQ("");
  };

  if (zahranici) {
    return (
      <div>
        <span style={label(theme)}>Město</span>
        <input value={f.mesto || ""} onChange={e => uprav("mesto", e.target.value)}
          placeholder="Wien" style={input(theme)} />
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <span style={label(theme)}>Město</span>
      <input
        value={otevreno ? q : (f.mesto || "")}
        onChange={e => { setQ(e.target.value); setOtevreno(true); }}
        onFocus={() => { setQ(f.mesto || ""); setOtevreno(true); }}
        onBlur={() => setTimeout(() => setOtevreno(false), 150)}
        placeholder="Začni psát — Rudná, Čistá…"
        style={input(theme)} />

      {otevreno && q.trim().length >= 2 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          marginTop: 3, ...card(theme), padding: 3, maxHeight: 240,
          overflowY: "auto", boxShadow: "0 8px 22px rgba(0,0,0,0.22)",
        }}>
          {hleda && nalezy.length === 0 && (
            <div style={{ padding: "7px 9px", fontSize: "11.5px", color: theme.textSub }}>
              hledám…
            </div>
          )}

          {!hleda && nalezy.length === 0 && (
            <div style={{ padding: "7px 9px", fontSize: "11.5px", color: theme.textSub, lineHeight: 1.6 }}>
              Žádná obec toho jména.
              <button onMouseDown={(e) => { e.preventDefault(); uprav("mesto", q.trim()); setOtevreno(false); }}
                style={{
                  ...btn(), background: "transparent", color: theme.accent,
                  fontSize: "11.5px", fontWeight: 700, padding: "2px 4px",
                }}>zapsat „{q.trim()}“ ručně</button>
              <div style={{ color: theme.textSub, marginTop: 2 }}>
                Kraj a okres pak vyber sám.
              </div>
            </div>
          )}

          {mimo && (
            <div style={{
              padding: "6px 9px", fontSize: "10.5px", color: theme.yellow,
              lineHeight: 1.5,
            }}>
              Ve vybraném okrese žádná taková obec není — tohle je odjinud.
              Vybráním se okres i kraj přepíšou.
            </div>
          )}

          {nalezy.map(o => (
            <div key={o.kod} onMouseDown={(e) => { e.preventDefault(); vyber(o); }} style={{
              padding: "6px 9px", cursor: "pointer", borderRadius: 6,
              display: "flex", alignItems: "baseline", gap: 7,
            }}>
              <span style={{ fontSize: "12.5px", fontWeight: 600, color: theme.text }}>
                {o.nazev}
              </span>
              {/* Okres a kraj musí být vidět hned: při dvou Rudných
                  je to jediné, čím je od sebe rozeznáš. */}
              <span style={{ fontSize: "11px", color: theme.textSub }}>
                {[o.okres_nazev, o.kraj_nazev].filter(Boolean).join(" · ")}
              </span>
            </div>
          ))}
        </div>
      )}

      {f.mesto && !otevreno && f.okres && (
        <div style={{ fontSize: "10.5px", color: theme.textSub, marginTop: 3 }}>
          {popis(ciselniky, "okres", f.okres)} · {popis(ciselniky, "kraj", f.kraj)}
        </div>
      )}
    </div>
  );
}
