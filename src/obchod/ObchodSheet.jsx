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
  nactiCiselniky, nactiPanel, nactiZakazky, zalozZakazku,
  upravZakazku, smazZakazku, komuToPasuje, popis, aktivni, rozeberVetu,
} from "./api.js";
import {
  FONT, card, input, btn, btnMain, btnGhost, label,
  useEscapeKey, penizeKratce, penizePresne, parsePenize, jakDavno,
} from "./ui.js";

const PRAZDNY_FILTR = {
  typ: "", kraj: "", faze: "", stav: "",
  cenaOd: null, cenaDo: null, velikostOd: null, hledat: "",
};

export default function ObchodSheet({ currentUser, theme, initialDraft = "", onClose }) {
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
  const hledatRef = useRef(null);

  const KROK = 25;
  const [kolik, setKolik] = useState(KROK);

  // Číselníky stačí jednou — je jich pár desítek řádků.
  useEffect(() => {
    if (!owner) return;
    let zrus = false;
    nactiCiselniky(owner).then(c => { if (!zrus) setCiselniky(c); });
    return () => { zrus = true; };
  }, [owner]);

  // Rychlé zadání z lomítka: otevře rovnou formulář s předvyplněným,
  // co se z věty dalo přečíst. Nic se neukládá bez tvého potvrzení.
  useEffect(() => {
    if (!initialDraft || !ciselniky.typ) return;
    setNova(rozeberVetu(initialDraft, ciselniky));
  }, [initialDraft, ciselniky.typ]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Kurzor rovnou v hledání, ať se dá psát bez klikání.
  useEffect(() => {
    if (!otevrena && !nova) setTimeout(() => hledatRef.current?.focus(), 80);
  }, [otevrena, nova]);

  useEffect(() => {
    if (!owner) return;
    let zrus = false;
    setBusy(true);
    const id = setTimeout(async () => {
      const [z, p] = await Promise.all([
        nactiZakazky(owner, filtr, kolik + 1, 0),
        nactiPanel(owner),
      ]);
      if (zrus) return;
      setVice(z.length > kolik);
      setZakazky(z.slice(0, kolik));
      setPanel(p);
      setBusy(false);
    }, filtr.hledat ? 280 : 0);
    return () => { zrus = true; clearTimeout(id); };
  }, [owner, filtr, kolik, obnov]);

  const zmenFiltr = useCallback((k, v) => {
    setKolik(KROK);
    setFiltr(f => ({ ...f, [k]: v }));
  }, []);

  const filtrAktivni = useMemo(
    () => Object.entries(filtr).some(([k, v]) => v !== PRAZDNY_FILTR[k]),
    [filtr]
  );

  const zavri = () => { setOtevrena(null); setNova(null); setObnov(k => k + 1); };

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
        {nova ? (
          <Detail
            theme={theme} owner={owner} ciselniky={ciselniky}
            predvyplneno={nova} onBack={zavri} onClose={onClose}
          />
        ) : otevrena ? (
          <Detail
            theme={theme} owner={owner} ciselniky={ciselniky}
            zakazka={otevrena} onBack={zavri} onClose={onClose}
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
                <div style={{ flex: 1, fontSize: "14px", fontWeight: 700, color: theme.text }}>
                  Obchod
                </div>
                <button onClick={() => setNova({ nazev: "" })} style={btnMain(theme)}>
                  + zakázka
                </button>
                <button onClick={onClose} style={{
                  background: "none", border: "none", fontSize: "20px",
                  cursor: "pointer", color: theme.textSub, padding: "0 4px",
                }}>×</button>
              </div>

              <Panel theme={theme} panel={panel} />

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
            </div>

            {/* ══ Seznam ══ */}
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
          </>
        )}
      </div>
    </div>
  );
}

/* ── Panel: co čeká na mě ──────────────────────────── */

function Panel({ theme, panel }) {
  const polozky = [
    { k: "zakazek_aktivnich", t: "aktivních", barva: theme.text },
    { k: "osloveni_ceka",     t: "čeká na ně", barva: theme.accent },
    { k: "pripominky_dnes",   t: "připomínky", barva: theme.yellow },
    { k: "bez_odezvy_14dni",  t: "ticho 14 dní", barva: theme.red },
  ];
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {polozky.map(p => {
        const n = panel ? Number(panel[p.k] || 0) : 0;
        return (
          <div key={p.k} style={{
            ...card(theme), flex: 1, padding: "7px 10px", textAlign: "center",
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
      <Select theme={theme} nadpis="Kraj" hodnota={filtr.kraj}
        polozky={aktivni(ciselniky, "kraj")} skupiny onZmena={v => zmen("kraj", v)} />
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

function Detail({ theme, owner, ciselniky, zakazka = null, predvyplneno = null, onBack, onClose }) {
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
  const [pasuje, setPasuje] = useState(null);
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

  const zjistiKomu = async () => {
    if (!zakazkaId) return;
    setPasuje(await komuToPasuje(zakazkaId, 30));
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

          {zakazkaId && (
            <button onClick={zjistiKomu} style={btnGhost(theme)}>komu to pasuje</button>
          )}

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

        {pasuje !== null && (
          <Pasuje theme={theme} seznam={pasuje} />
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

/* ── Komu to pasuje ────────────────────────────────── */

function Pasuje({ theme, seznam }) {
  if (seznam.length === 0) {
    return (
      <div style={{
        ...card(theme), padding: "14px", marginTop: 12,
        fontSize: "12px", color: theme.textSub, lineHeight: 1.6,
      }}>
        Nikdo z tvé sítě na tohle nesedí. Buď na to zatím nemáš investora,
        nebo u lidí chybí karta s tím, co hledají.
      </div>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ ...label(theme), marginBottom: 6 }}>
        Komu to pasuje ({seznam.length})
      </div>
      {seznam.map(r => (
        <div key={r.card_id} style={{
          ...card(theme), padding: "9px 11px", marginBottom: 6,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: theme.text }}>
              {r.jmeno}
              {r.nazev_karty && (
                <span style={{ fontWeight: 400, color: theme.textSub, fontSize: "11px" }}>
                  {" "}· {r.nazev_karty}
                </span>
              )}
            </div>
            <div style={{ fontSize: "11px", marginTop: 2 }}>
              {(r.sedi || []).length > 0 && (
                <span style={{ color: theme.green }}>sedí: {r.sedi.join(", ")}</span>
              )}
              {(r.nesedi || []).length > 0 && (
                <span style={{ color: theme.yellow }}>
                  {(r.sedi || []).length > 0 ? "  ·  " : ""}
                  {r.nesedi.join(", ")}
                </span>
              )}
            </div>
          </div>
          <div style={{
            fontSize: "15px", fontWeight: 700, color: theme.accent,
            fontVariantNumeric: "tabular-nums",
          }}>{Number(r.skore)}</div>
        </div>
      ))}
    </div>
  );
}
