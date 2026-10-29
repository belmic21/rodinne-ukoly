/* ═══════════════════════════════════════════════════════
   TÉMATA K PROBRÁNÍ

   Michal: „chtěl bych evidovat témata v hovoru, která jsme
   nedokončili, abych je mohl odškrtávat pro budoucí hovory…
   něco podobného jako poznámkový blok na Google Keep, aby měl
   zaškrtávací tlačítka — když se zaškrtne, tak nezmizí, ale dá
   se do vyřízených."

   Stálá agenda k jednomu člověku. Otevřeš ji před hovorem,
   odškrtáváš během něj.

   Tři věci, které tahle obrazovka musí dělat jinak než zbytek
   aplikace:

   1. ODŠKRTNUTÍ NEMAŽE. Vyřízené téma se přesune dolů a zůstane
      tam. Za půl roku je to jediný doklad, že jste se na tom
      domluvili.

   2. ZÁPIS MUSÍ BÝT RYCHLEJŠÍ NEŽ MYŠLENKA. Během hovoru není
      čas vybírat kategorie. Píšeš text, mačkáš Enter. Kategorie
      a poznámka se doplňují až potom, když na ně dojde.

   3. KDYŽ SE Z TÉMATU STANE ZÁVAZEK, PŘESTANE BÝT TÉMATEM.
      Jedním klikem z něj uděláš úkol s termínem a téma se označí
      jako předané. Jinak bys stejnou věc hlídal na dvou místech
      a nevěděl, které věřit — to je past, kterou má tahle
      aplikace už dvakrát obejitou.
   ═══════════════════════════════════════════════════════ */

import { useState, useEffect, useMemo, useRef } from "react";
import {
  nactiTemata, pridejTema, upravTema, stavTematu, smazTema,
  popis, aktivni,
} from "./api.js";
import { card, input, btn, btnMain, btnGhost, label, jakDavno } from "./ui.js";

const OTEVRENE = "otevrene";

/* Kategorie se nabízí jen ta, která v číselníku opravdu je.
   Když si Michal „pozemek" přejmenuje nebo vypne, tenhle seznam
   se změní s ním — proto se nikde nepíše natvrdo. */
function Kategorie({ theme, ciselniky, hodnota, onZmena, maleAno = false, popisek = "Kategorie tématu" }) {
  const volby = aktivni(ciselniky, "tema");
  if (volby.length === 0) return null;
  return (
    <select value={hodnota || ""} onChange={e => onZmena(e.target.value || null)}
      aria-label={popisek}
      style={{
        ...input(theme), cursor: "pointer",
        flex: maleAno ? "0 1 130px" : "1 1 140px",
        fontSize: maleAno ? "12px" : "13px",
        minHeight: maleAno ? 32 : undefined,
      }}>
      <option value="">bez kategorie</option>
      {volby.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
    </select>
  );
}

export default function Temata({
  theme, owner, personId, osobaJmeno, ciselniky,
  /* Povýšení na úkol. Když prop chybí, tlačítko se nekreslí —
     poloviční tlačítko, které nic neudělá, je horší než žádné. */
  onNovyUkol = null,
  onZmena = null,
}) {
  const [radky, setRadky] = useState([]);
  const [nacitam, setNacitam] = useState(true);
  const [novy, setNovy] = useState("");
  const [novaKat, setNovaKat] = useState(null);
  const [ukladam, setUkladam] = useState(false);
  const [chyba, setChyba] = useState(null);
  const [rozbaleno, setRozbaleno] = useState(null);   // id tématu v úpravě
  const [filtr, setFiltr] = useState("");             // kategorie
  const [vyrizenaVidet, setVyrizenaVidet] = useState(false);
  const poleRef = useRef(null);

  const nacti = () => {
    if (!owner || !personId) { setRadky([]); setNacitam(false); return; }
    setNacitam(true);
    nactiTemata(owner, personId).then(r => { setRadky(r || []); setNacitam(false); });
  };
  useEffect(nacti, [owner, personId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const otevrena = useMemo(
    () => radky.filter(t => t.stav === OTEVRENE && (!filtr || t.tema === filtr)),
    [radky, filtr]);
  const hotova = useMemo(
    () => radky.filter(t => t.stav !== OTEVRENE && (!filtr || t.tema === filtr))
      .sort((a, b) => String(b.vyrizeno_at || "").localeCompare(String(a.vyrizeno_at || ""))),
    [radky, filtr]);

  /* Do filtru jen kategorie, které tu opravdu jsou. Nabízet
     prázdný filtr znamená nabízet cestu do prázdného seznamu. */
  const kategorieVPouziti = useMemo(() => {
    const k = new Set(radky.map(t => t.tema).filter(Boolean));
    return aktivni(ciselniky, "tema").filter(v => k.has(v.key));
  }, [radky, ciselniky]);

  const hlas = (res) => {
    if (!res.ok) { setChyba(res.chyba || "Nepovedlo se."); return false; }
    setChyba(null); onZmena?.(); return true;
  };

  const pridej = async () => {
    const text = novy.trim();
    if (!text || ukladam) return;
    setUkladam(true);
    const res = await pridejTema(owner, { personId, text, tema: novaKat });
    setUkladam(false);
    if (!hlas(res)) return;
    setRadky(p => [res.tema, ...p]);
    setNovy("");
    // Kategorie zůstává — při zápisu z hovoru jdou témata v sériích.
    poleRef.current?.focus();
  };

  const prepni = async (t) => {
    const cil = t.stav === OTEVRENE ? "vyrizene" : OTEVRENE;
    // Překreslí se hned, teprve pak se čeká na databázi. Při
    // odškrtávání během hovoru je čekání na odpověď znát.
    setRadky(p => p.map(x => x.id === t.id ? { ...x, stav: cil } : x));
    const res = await stavTematu(t.id, cil);
    if (!res.ok) { setRadky(p => p.map(x => x.id === t.id ? t : x)); hlas(res); return; }
    setRadky(p => p.map(x => x.id === t.id ? res.tema : x));
    onZmena?.();
  };

  const uprav = async (id, data) => {
    const res = await upravTema(id, data);
    if (!hlas(res)) return;
    setRadky(p => p.map(x => x.id === id ? res.tema : x));
  };

  const smaz = async (id) => {
    const res = await smazTema(id);
    if (!hlas(res)) return;
    setRadky(p => p.filter(x => x.id !== id));
    setRozbaleno(null);
  };

  /* Dvojklik na tlačítku, které zakládá úkol, by založil úkoly
     dva. Hlídá to ref, ne stav: stav se projeví až při dalším
     vykreslení, takže druhý klik ve stejném tiku by viděl ještě
     prázdno a prošel. Stav je vedle jen kvůli tomu, aby šlo
     tlačítko zešednout. */
  const delamRef = useRef(null);
  const [delam, setDelam] = useState(null);

  const naUkol = async (t) => {
    if (!onNovyUkol || delamRef.current) return;
    delamRef.current = t.id;
    setDelam(t.id);
    try {
      const taskId = await onNovyUkol({ text: t.text, poznamka: t.poznamka, personId, osobaJmeno });
      if (!taskId) { setChyba("Úkol se nepodařilo založit."); return; }
      const res = await stavTematu(t.id, "predane", taskId);
      if (!hlas(res)) return;
      setRadky(p => p.map(x => x.id === t.id ? res.tema : x));
      setRozbaleno(null);
    } finally {
      delamRef.current = null;
      setDelam(null);
    }
  };

  /* Zpátky mezi otevřená. Předané téma nejde odškrtnout — hlídá
     ho úkol — takže bez téhle cesty by jediný omylem trefený
     klik nešel vzít zpět jinak než smazáním úkolu.

     Úkol zůstává. Smazat ho odtud by znamenalo sáhnout do cizí
     agendy; tohle jen vrátí téma tam, kde bylo. */
  const zpetMeziOtevrena = async (t) => {
    if (delamRef.current) return;
    delamRef.current = t.id;
    setDelam(t.id);
    try {
      const res = await stavTematu(t.id, "otevrene");
      if (!hlas(res)) return;
      setRadky(p => p.map(x => x.id === t.id ? res.tema : x));
    } finally {
      delamRef.current = null;
      setDelam(null);
    }
  };

  const radek = (t) => {
    const hotove = t.stav !== OTEVRENE;
    const predane = t.stav === "predane";
    const vUprave = rozbaleno === t.id;
    return (
      <div key={t.id} style={{
        border: `1px solid ${vUprave ? theme.accentBorder : theme.cardBorder}`,
        borderRadius: 9, marginBottom: 5,
        background: vUprave ? theme.accentSoft : "transparent",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px" }}>
          {/* Zaškrtávátko. Předané se odškrtnout nedá — hlídá ho
              úkol, a kdyby šlo odškrtnout tady, byly by dvě pravdy. */}
          <button onClick={() => !predane && prepni(t)}
            disabled={predane}
            title={predane ? "Hlídá to úkol — odškrtni ho tam"
                   : hotove ? "Vrátit mezi otevřená" : "Odškrtnout — zůstane ve vyřízených"}
            aria-label={hotove ? "Vrátit mezi otevřená" : "Odškrtnout téma"}
            style={{
              ...btn(), flexShrink: 0, width: 20, height: 20, padding: 0,
              marginTop: 1, borderRadius: 5, fontSize: "12px", lineHeight: "18px",
              border: `1.5px solid ${hotove ? theme.green : theme.inputBorder}`,
              background: hotove ? theme.green : "transparent",
              color: "#fff", cursor: predane ? "default" : "pointer",
              opacity: predane ? 0.55 : 1,
            }}>{hotove ? "✓" : ""}</button>

          <button onClick={() => setRozbaleno(vUprave ? null : t.id)}
            title="Poznámka, kategorie, úkol"
            style={{
              ...btn(), flex: 1, minWidth: 0, textAlign: "left",
              background: "transparent", padding: 0,
            }}>
            <div style={{
              fontSize: "13px", color: hotove ? theme.textSub : theme.text,
              textDecoration: hotove ? "line-through" : "none",
              lineHeight: 1.45, wordBreak: "break-word",
            }}>{t.text}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 3, alignItems: "center" }}>
              {t.tema && (
                <span style={{
                  fontSize: "10px", fontWeight: 700, color: theme.textSub,
                  border: `1px solid ${theme.cardBorder}`, borderRadius: 10, padding: "1px 7px",
                }}>{popis(ciselniky, "tema", t.tema)}</span>
              )}
              {t.zakazka?.kod && (
                <span style={{ fontSize: "10.5px", color: theme.accent }}>{t.zakazka.kod}</span>
              )}
              {predane && (
                <span style={{ fontSize: "10.5px", color: theme.yellow }}>→ je z toho úkol</span>
              )}
              {t.poznamka && !vUprave && (
                <span style={{
                  fontSize: "11px", color: theme.textSub, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220,
                }}>{t.poznamka}</span>
              )}
              <span style={{ fontSize: "10.5px", color: theme.textMid }}>
                {hotove && t.vyrizeno_at ? jakDavno(t.vyrizeno_at) : jakDavno(t.created_at)}
              </span>
            </div>
          </button>

          {/* Michal 29. 10.: „co kdybych chtěl z poznámek k probrání
              automaticky vytvořit úkol jedním kliknutím?"

              Tlačítko existovalo, ale až po rozkliknutí tématu —
              tedy dvě kliknutí a člověk musel vědět, že tam je.
              Patří do řádku: povýšit téma na úkol je to druhé
              nejčastější, co se s ním dělá, hned po odškrtnutí. */}
          {onNovyUkol && !hotove && (
            <button onClick={() => naUkol(t)}
              disabled={delam === t.id}
              title="Založí úkol s tímhle textem a připojí ho k člověku. Bez termínu — ten si dáš v úkolu."
              aria-label="Udělat z tématu úkol"
              style={{
                ...btn(), flexShrink: 0, minHeight: 24, padding: "0 8px",
                borderRadius: 7, fontSize: "11px", marginTop: 1,
                background: "transparent", color: theme.accent,
                border: `1px solid ${theme.cardBorder}`,
                opacity: delam === t.id ? 0.5 : 1,
              }}>{delam === t.id ? "…" : "→ úkol"}</button>
          )}

          {/* Předané téma nejde odškrtnout, takže bez téhle cesty
              by omylem trefený klik nešel vzít zpět. */}
          {predane && (
            <button onClick={() => zpetMeziOtevrena(t)}
              disabled={delam === t.id}
              /* Ne „Vrátit mezi otevřená" — tak se jmenuje
                 odškrtávátko u vyřízených a dva stejné popisky
                 v jednom řádku se pletou. */
              title="Zpátky mezi otevřená — úkol zůstane, smaž ho v úkolech, pokud ho nechceš."
              aria-label="Zpátky mezi otevřená"
              style={{
                ...btn(), flexShrink: 0, minHeight: 24, padding: "0 8px",
                borderRadius: 7, fontSize: "11px", marginTop: 1,
                background: "transparent", color: theme.textSub,
                border: `1px solid ${theme.cardBorder}`,
              }}>↩</button>
          )}
        </div>

        {vUprave && (
          <div style={{ padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
            <textarea defaultValue={t.poznamka || ""} rows={2}
              placeholder="Poznámka — co přesně zaznělo, na čem jste zůstali"
              onBlur={e => {
                const v = e.target.value;
                if ((t.poznamka || "") !== v) uprav(t.id, { poznamka: v });
              }}
              style={{ ...input(theme), resize: "vertical", fontSize: "12.5px" }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <Kategorie theme={theme} ciselniky={ciselniky} hodnota={t.tema} maleAno
                onZmena={(v) => uprav(t.id, { tema: v })} />
              {/* „Udělat z toho úkol" bývalo tady. Teď je v řádku,
                  který je vidět i rozbalený — dvě tlačítka na tutéž
                  věc by jen nutila vybírat. */}
              <span style={{ flex: 1 }} />
              <button onClick={() => smaz(t.id)}
                title="Smazat téma úplně. Odškrtnutí je skoro vždycky to, co chceš."
                style={{
                  ...btn(), minHeight: 32, padding: "0 10px", fontSize: "12px",
                  background: "transparent", color: theme.red,
                  border: `1px solid ${theme.red}44`, borderRadius: 7,
                }}>Smazat</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (nacitam) {
    return <div style={{ fontSize: "12px", color: theme.textSub, padding: "6px 2px" }}>Načítám témata…</div>;
  }

  return (
    <div style={{ ...card(theme), padding: "11px 12px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 8 }}>
        <span style={{ fontSize: "13px", fontWeight: 700, color: theme.text }}>
          Témata k probrání
        </span>
        {otevrena.length > 0 && (
          <span style={{
            fontSize: "11px", fontWeight: 700, color: theme.accent,
            background: theme.accentSoft, borderRadius: 9, padding: "1px 7px",
          }}>{otevrena.length}</span>
        )}
      </div>

      {/* Zápis co nejrychleji: text a Enter. Kategorie je vedle,
          ne před tím — během hovoru se nevybírá, doplní se potom. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 7 }}>
        <input ref={poleRef} value={novy}
          onChange={e => { setNovy(e.target.value); setChyba(null); }}
          onKeyDown={e => { if (e.key === "Enter") pridej(); }}
          placeholder="Co jste nedořešili? Napiš a dej Enter"
          aria-label="Nové téma k probrání"
          style={{ ...input(theme), flex: "1 1 200px" }} />
        <Kategorie theme={theme} ciselniky={ciselniky} hodnota={novaKat} onZmena={setNovaKat}
          popisek="Kategorie nového tématu" />
        <button onClick={pridej} disabled={!novy.trim() || ukladam}
          title={novy.trim() ? "Přidat téma" : "Nejdřív napiš, o co jde"}
          style={{
            ...btnMain(theme), minHeight: 38, padding: "0 14px",
            opacity: novy.trim() && !ukladam ? 1 : 0.5,
          }}>{ukladam ? "…" : "Přidat"}</button>
      </div>

      {chyba && (
        <div style={{ fontSize: "11.5px", color: theme.red, marginBottom: 7 }}>{chyba}</div>
      )}

      {kategorieVPouziti.length > 1 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
          {[{ key: "", label: "vše" }, ...kategorieVPouziti].map(v => {
            const zap = filtr === v.key;
            return (
              <button key={v.key || "vse"} onClick={() => setFiltr(v.key)}
                style={{
                  ...btn(), fontSize: "11.5px", padding: "3px 9px", borderRadius: 13,
                  background: zap ? theme.accentSoft : "transparent",
                  border: `1px solid ${zap ? theme.accentBorder : theme.cardBorder}`,
                  color: zap ? theme.accent : theme.textSub,
                  fontWeight: zap ? 700 : 500,
                }}>{v.label}</button>
            );
          })}
        </div>
      )}

      {otevrena.length === 0 && hotova.length === 0 ? (
        <div style={{ fontSize: "12px", color: theme.textSub, lineHeight: 1.6 }}>
          Zatím nic. Sem si piš, co jste spolu nedořešili — před
          dalším hovorem to najdeš pohromadě.
        </div>
      ) : (
        <>
          {otevrena.length > 0 ? otevrena.map(radek) : (
            <div style={{ fontSize: "12px", color: theme.textSub, padding: "2px 0 4px" }}>
              {filtr ? "V téhle kategorii nic otevřeného." : "Všechno probrané."}
            </div>
          )}

          {hotova.length > 0 && (
            <>
              <button onClick={() => setVyrizenaVidet(v => !v)}
                title={vyrizenaVidet ? "Schovat vyřízená" : "Ukázat, co už jste probrali"}
                style={{
                  ...btn(), background: "transparent", padding: "6px 0 2px",
                  color: theme.textSub, fontSize: "11px", fontWeight: 700,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                }}>
                {vyrizenaVidet ? "▾" : "▸"} Vyřízená ({hotova.length})
              </button>
              {vyrizenaVidet && <div style={{ marginTop: 4 }}>{hotova.map(radek)}</div>}
            </>
          )}
        </>
      )}
    </div>
  );
}
