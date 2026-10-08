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
  upravZakazku, smazZakazku, popis, aktivni, rozeberVetu,
} from "./api.js";
import {
  FONT, card, input, btn, btnMain, btnGhost, label,
  useEscapeKey, penizeKratce, penizePresne, parsePenize, jakDavno, OBCHOD_VERZE,
} from "./ui.js";
import Site from "./Site.jsx";
import { Retezec, Geneze } from "./Zakazka.jsx";
import { SdileniZakazky, SdilenoSeMnou, Uzivatele } from "./Sdileni.jsx";
import Ciselniky from "./Ciselniky.jsx";
import Osoba from "./Osoba.jsx";
import { TerminySekce, TerminyPrehled } from "./Terminy.jsx";

const PRAZDNY_FILTR = {
  typ: "", kraj: "", faze: "", stav: "",
  cenaOd: null, cenaDo: null, velikostOd: null, hledat: "",
};

export default function ObchodSheet({ currentUser, theme, initialDraft = "",
  initialOsoba = null, initialZakazka = null, onClose }) {
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
  const [zalozka, setZalozka] = useState("zakazky");   // zakazky | sit | sdilene
  const [nastaveni, setNastaveni] = useState(null);   // uzivatele | ciselniky
  // Přehled člověka se otevírá jako překryv nad vším ostatním.
  // Schválně: co máš rozepsané v zakázce, zůstane pod ním nedotčené.
  const [osobaId, setOsobaId] = useState(initialOsoba);
  const hledatRef = useRef(null);

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
      const dotaz = { ...filtr };
      if (String(filtr.kraj || "").startsWith("oblast:")) {
        const g = filtr.kraj.slice(7);
        dotaz.kraje = (ciselniky.kraj || [])
          .filter(k => (k.skupina || "") === g).map(k => k.key);
        dotaz.kraj = "";
      }
      const [z, p] = await Promise.all([
        nactiZakazky(owner, dotaz, kolik + 1, 0),
        nactiPanel(owner),
      ]);
      if (zrus) return;
      setVice(z.length > kolik);
      setZakazky(z.slice(0, kolik));
      setPanel(p);
      setBusy(false);
    }, filtr.hledat ? 280 : 0);
    return () => { zrus = true; clearTimeout(id); };
  }, [owner, filtr, kolik, obnov, zalozka, ciselniky]);

  const zmenFiltr = useCallback((k, v) => {
    setKolik(KROK);
    setFiltr(f => ({ ...f, [k]: v }));
  }, []);

  const filtrAktivni = useMemo(
    () => Object.entries(filtr).some(([k, v]) => v !== PRAZDNY_FILTR[k]),
    [filtr]
  );

  const zavri = () => { setOtevrena(null); setNova(null); setObnov(k => k + 1); };

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
              <button onClick={() => setNastaveni(null)} title="Zpět" style={{
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
              <button onClick={onClose} style={{
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
            theme={theme} owner={owner} ciselniky={ciselniky}
            predvyplneno={nova} onBack={zavri} onClose={onClose}
            onOtevriOsobu={setOsobaId}
          />
        ) : otevrena ? (
          <Detail
            theme={theme} owner={owner} ciselniky={ciselniky}
            zakazka={otevrena} onBack={zavri} onClose={onClose}
            onOtevriOsobu={setOsobaId}
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
                    { k: "sit",     t: "Síť" },
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
                  <button onClick={() => setNastaveni("uzivatele")} title="Nastavení" style={{
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
                <button onClick={onClose} style={{
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
                    {filtrAktivni && (
                      <button onClick={() => { setFiltr(PRAZDNY_FILTR); setKolik(KROK); }}
                        style={{ ...btnGhost(theme), whiteSpace: "nowrap" }}>zrušit</button>
                    )}
                  </div>

                  {vicFiltru && (
                    <Filtry theme={theme} ciselniky={ciselniky} filtr={filtr} zmen={zmenFiltr} />
                  )}
                </>
              )}
            </div>

            {zalozka === "sit" ? (
              <Site theme={theme} owner={owner} ciselniky={ciselniky}
                onOtevriOsobu={setOsobaId} />
            ) : zalozka === "terminy" ? (
              <TerminyPrehled theme={theme} owner={owner}
                onOtevriZakazku={otevriZakazku} onOtevriOsobu={setOsobaId} />
            ) : zalozka === "sdilene" ? (
              <SdilenoSeMnou theme={theme} ciselniky={ciselniky} />
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
                    onOpen={() => setOtevrena(z)} />
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

/* ── Filtry ────────────────────────────────────────── */

function Filtry({ theme, ciselniky, filtr, zmen }) {
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
      <Select theme={theme} nadpis="Typ" hodnota={filtr.typ}
        polozky={aktivni(ciselniky, "typ")} onZmena={v => zmen("typ", v)} />
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

function Select({ theme, nadpis, hodnota, polozky, onZmena, skupiny = false }) {
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
        <option value="">vše</option>
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

/* ── Řádek seznamu ─────────────────────────────────── */

function Radek({ z, theme, ciselniky, onOpen }) {
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
          ].filter(Boolean).join(" · ")}
        </div>
      </div>

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
  onBack, onClose, onOtevriOsobu }) {
  const novy = !zakazka;
  const [f, setF] = useState(() => {
    const z = {
      nazev: "", typ: "", velikost: "", jednotka: "byt",
      zeme: "CZ", kraj: "", mesto: "", lokalita_text: "",
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
        <button onClick={onBack} title="Zpět" style={{
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
        <button onClick={onClose} style={{
          background: "none", border: "none", fontSize: "20px",
          cursor: "pointer", color: theme.textSub, padding: "0 4px",
        }}>×</button>
      </div>

      <div style={{ padding: "14px 16px 20px" }}>
        <div style={{ marginBottom: 10 }}>
          <span style={label(theme)}>Název</span>
          <input ref={nazevRef} value={f.nazev || ""} onChange={e => uprav("nazev", e.target.value)}
            placeholder="Rezidence Zličín" style={{ ...input(theme), fontWeight: 700, fontSize: "14px" }} />
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 9, marginBottom: 10,
        }}>
          <Select theme={theme} nadpis="Typ" hodnota={f.typ}
            polozky={aktivni(ciselniky, "typ")} onZmena={v => uprav("typ", v)} />
          <Select theme={theme} nadpis="Fáze přípravy" hodnota={f.faze}
            polozky={aktivni(ciselniky, "faze")} onZmena={v => uprav("faze", v)} />
          <Select theme={theme} nadpis="Stav zakázky" hodnota={f.stav}
            polozky={aktivni(ciselniky, "stav_zakazky")} onZmena={v => uprav("stav", v)} />

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

          <Select theme={theme} nadpis="Kraj" hodnota={f.kraj} skupiny
            polozky={aktivni(ciselniky, "kraj")} onZmena={v => uprav("kraj", v)} />

          <div>
            <span style={label(theme)}>Město</span>
            <input value={f.mesto || ""} onChange={e => uprav("mesto", e.target.value)}
              placeholder="Praha" style={input(theme)} />
          </div>

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

        <div style={{ marginBottom: 10 }}>
          <span style={label(theme)}>Souhrn — o co jde</span>
          <textarea value={f.souhrn || ""} onChange={e => uprav("souhrn", e.target.value)}
            rows={6} placeholder="Co to je, co k tomu je za dokumentaci, na co si dát pozor."
            style={{ ...input(theme), resize: "vertical", lineHeight: 1.6 }} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <span style={label(theme)}>Odkaz na složku s podklady</span>
          <input value={f.slozka_odkaz || ""} onChange={e => uprav("slozka_odkaz", e.target.value)}
            placeholder="https://… (OneDrive, Dropbox)" style={input(theme)} />
          {f.slozka_odkaz && (
            <a href={f.slozka_odkaz} target="_blank" rel="noreferrer"
              style={{ fontSize: "11px", color: theme.accent, marginTop: 3, display: "inline-block" }}>
              otevřít složku →
            </a>
          )}
        </div>

        {chyba && (
          <div style={{
            background: `${theme.red}18`, border: `1px solid ${theme.red}44`,
            borderRadius: 8, padding: "8px 11px", fontSize: "12px",
            color: theme.red, marginBottom: 10,
          }}>{chyba}</div>
        )}

        <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={uloz} disabled={uklada} style={{
            ...btnMain(theme), opacity: uklada ? 0.6 : 1,
          }}>{uklada ? "UKLÁDÁM…" : "ULOŽIT"}</button>

          <span style={{ flex: 1 }} />

          {zakazkaId && (
            <Smazat theme={theme} mazu={mazu} onSmaz={smaz} />
          )}
        </div>

        {ulozeno && !chyba && (
          <div style={{ fontSize: "11px", color: theme.green, marginTop: 8 }}>
            Uloženo {jakDavno(ulozeno.updated_at)}.
          </div>
        )}

        {zakazkaId && (
          <>
            <Retezec theme={theme} owner={owner} ciselniky={ciselniky}
              projectId={zakazkaId} onOtevriOsobu={onOtevriOsobu} />
            <Geneze theme={theme} owner={owner} ciselniky={ciselniky}
              zakazka={{ id: zakazkaId, nazev: f.nazev }}
              onOtevriOsobu={onOtevriOsobu} />
            <TerminySekce theme={theme} owner={owner} projectId={zakazkaId}
              nazevZakazky={f.nazev} onOtevriOsobu={onOtevriOsobu} />
            <SdileniZakazky theme={theme} owner={owner} projectId={zakazkaId} />
          </>
        )}

        {!zakazkaId && (
          <div style={{
            fontSize: "11.5px", color: theme.textSub, marginTop: 14, lineHeight: 1.7,
          }}>
            Až zakázku uložíš, přibude sem řetězec lidí a seznam oslovených.
          </div>
        )}
      </div>
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
      }}>🗑 smazat</button>
    );
  }
  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: "11px", color: theme.textSub }}>Opravdu?</span>
      <button onClick={onSmaz} disabled={mazu} style={{
        ...btnMain(theme), background: theme.red, opacity: mazu ? 0.6 : 1,
      }}>{mazu ? "MAŽU…" : "ANO"}</button>
      <button onClick={() => setPtam(false)} style={btnGhost(theme)}>Ne</button>
    </span>
  );
}
