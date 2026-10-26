/* ═══════════════════════════════════════════════════════
   VLNA — jeden stroj, tři použití

   Michal 26. 10.: „rád bych potom určitě viděl podrobnou
   filtraci, kdy si vyfiltruju developery a budu jim přiřazovat,
   co staví za projekty a jaké velikosti. Pak si vyfiltruju
   investory a opět touhle rychlou volbou budu zadávat, jestli
   chtějí bytové domy, rodinné domy, pozemky."

   Popsal třikrát tentýž postup:

       fronta → rychlá volba → Enter → další

   Jednou pro čekárnu, podruhé pro developery, potřetí pro
   investory. Proto je to jeden motor a mění se mu jen fronta
   a otázky.

   ── PROČ PŘEPÍNAČ A ENTER, NE OKAMŽITÝ POSUN ──

   První verze zapisovala rovnou: zmáčkl jsi 2 a kontakt byl
   zařazený jako developer. Michal: „zabránili bychom tím
   nechtěnému stisknutí klávesy, protože by číselná klávesa
   pouze označila danou volbu."

   Měl pravdu a já se mýlil. U osmi set kontaktů jedeš rychle
   a jediné zmáčknuté číslo navíc zapíše něco, co zjistíš až
   o kus dál. Dvě stisknutí místo jednoho jsou levná cena za to,
   že se bez Enteru nic nestane — a multi-volba z klávesnice je
   k tomu zadarmo.

   ── ENTER BEZ OZNAČENÍ ──

   Koukneš, nic nesedí, Enter. Žádná zvláštní klávesa na
   přeskočení; jedna cesta ven, ať už jsi označil, nebo ne.
   ═══════════════════════════════════════════════════════ */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { card, btn, btnMain, btnGhost, useEscapeKey } from "./ui.js";

/* Devět je strop číslic. Co se nevejde, jde naklikat myší —
   a je to signál, že otázka je moc široká. */
const MAX_KLAVES = 9;

export default function Vlna({
  theme,
  nazev,
  napoveda,
  fronta,
  nacitam = false,
  hlavicka,              // (polozka) => { nazev, podnadpis, dodatek }
  kroky,                 // [{ klic, otazka, volby:[{key,label,exkluzivni,klavesa}], vice }]
  onPotvrdit,            // (polozka, vyber) => { ok, chyba?, zpetnyKlic? }
  onZpet,                // (zaznam) => { ok, chyba?, hlaska? }
  onClose,
  /* Jméno z telefonu bývá „Novák" nebo „Novák Pardubice" a teprve
     ve vlně je ten pravý moment ho srovnat — tady ho má Michal
     poprvé před očima a ví, o koho jde. Zapisuje se do Lidí;
     v čekárně zůstane původní podoba, ať je vidět, co přišlo
     ze souboru. */
  upravitJmeno = false,
  patka = null,
}) {
  useEscapeKey(onClose);
  const [index, setIndex] = useState(0);
  const [krok, setKrok] = useState(0);
  const [vyber, setVyber] = useState({});
  const [historie, setHistorie] = useState([]);
  const [pracuji, setPracuji] = useState(false);
  const [chyba, setChyba] = useState(null);
  const [hlaska, setHlaska] = useState(null);
  const [jmeno, setJmeno] = useState("");
  const pracujiRef = useRef(false);

  const ted = fronta[index] || null;
  const zbyva = Math.max(0, fronta.length - index);
  const aktualni = kroky[krok] || null;

  // Nová položka = čistý stůl.
  useEffect(() => { setKrok(0); setVyber({}); }, [index]);
  /* Jméno se nastavuje ze položky, ne z kroku — jinak by se
     přepsalo pokaždé, když se vrátíš o krok zpátky. */
  useEffect(() => { setJmeno(String(fronta[index]?.name || "")); }, [fronta, index]);

  const prepni = useCallback((klicKroku, volba, vice) => {
    setChyba(null);
    setVyber(v => {
      const bylo = v[klicKroku] || [];
      if (volba.exkluzivni) {
        return { ...v, [klicKroku]: bylo.includes(volba.key) ? [] : [volba.key] };
      }
      // Exkluzivní volba (třeba „osobní") a běžné se vylučují navzájem.
      const bezExkluzivnich = bylo.filter(x =>
        !(kroky[krok]?.volby || []).some(o => o.key === x && o.exkluzivni));
      if (bezExkluzivnich.includes(volba.key)) {
        return { ...v, [klicKroku]: bezExkluzivnich.filter(x => x !== volba.key) };
      }
      return { ...v, [klicKroku]: vice ? [...bezExkluzivnich, volba.key] : [volba.key] };
    });
  }, [kroky, krok]);

  /* Enter. Uvnitř položky posune na další krok, na posledním
     zapíše a jde na další položku. Obrazovka se posune hned,
     teprve pak se čeká na databázi — při osmi stech položkách
     je čekání u každé z nich znát. */
  const dal = useCallback(async () => {
    if (!ted || pracujiRef.current) return;
    if (krok < kroky.length - 1) { setKrok(k => k + 1); return; }

    pracujiRef.current = true; setPracuji(true); setChyba(null);
    /* Prázdné jméno by položku shodilo na nevyplněném sloupci,
       takže se bere původní. Smazat jméno nemá co znamenat. */
    const srovnane = String(jmeno || "").trim();
    const polozka = (upravitJmeno && srovnane && srovnane !== ted.name)
      ? { ...ted, name: srovnane }
      : ted;
    const co = vyber;
    setIndex(i => i + 1);
    const res = await onPotvrdit?.(polozka, co);
    pracujiRef.current = false; setPracuji(false);
    if (!res?.ok) {
      // Zpátky na tutéž položku — jinak by tiše propadla.
      setIndex(i => Math.max(0, i - 1));
      setVyber(co);
      setKrok(kroky.length - 1);
      setChyba(res?.chyba || "Nepovedlo se uložit.");
      return;
    }
    setHistorie(h => [{ polozka, vyber: co, zpetnyKlic: res.zpetnyKlic ?? null }, ...h].slice(0, 50));
  }, [ted, krok, kroky.length, vyber, onPotvrdit, jmeno, upravitJmeno]);

  const zpet = useCallback(async () => {
    if (pracujiRef.current) return;
    setChyba(null);
    // Uvnitř položky se Backspace vrací po krocích.
    if (krok > 0) { setKrok(k => k - 1); return; }
    const posledni = historie[0];
    if (!posledni) return;
    pracujiRef.current = true; setPracuji(true);
    const res = await onZpet?.(posledni);
    pracujiRef.current = false; setPracuji(false);
    if (!res?.ok) { setChyba(res?.chyba || "Nepovedlo se vrátit."); return; }
    setHistorie(h => h.slice(1));
    setIndex(i => Math.max(0, i - 1));
    setHlaska(res.hlaska || null);
  }, [krok, historie, onZpet]);

  // ── Klávesy ──
  useEffect(() => {
    const naKlavesu = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const cil = e.target;
      if (cil && /^(INPUT|TEXTAREA|SELECT)$/.test(cil.tagName)) return;
      if (e.key === "Backspace") { e.preventDefault(); zpet(); return; }
      if (!ted || !aktualni) return;
      if (e.key === "Enter") { e.preventDefault(); dal(); return; }
      const volby = aktualni.volby || [];
      // Vlastní klávesa (například 0 pro „osobní") má přednost.
      const zvlastni = volby.find(o => o.klavesa === e.key);
      if (zvlastni) { e.preventDefault(); prepni(aktualni.klic, zvlastni, aktualni.vice); return; }
      const n = parseInt(e.key, 10);
      const bezZvlastnich = volby.filter(o => !o.klavesa);
      if (Number.isFinite(n) && n >= 1 && n <= Math.min(bezZvlastnich.length, MAX_KLAVES)) {
        e.preventDefault();
        prepni(aktualni.klic, bezZvlastnich[n - 1], aktualni.vice);
      }
    };
    document.addEventListener("keydown", naKlavesu);
    return () => document.removeEventListener("keydown", naKlavesu);
  }, [ted, aktualni, prepni, dal, zpet]);

  const obal = (deti) => (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(15,23,42,0.55)", display: "flex",
      alignItems: "flex-start", justifyContent: "center",
      padding: "18px 12px", overflowY: "auto",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...card(theme), width: "100%", maxWidth: 580, padding: "14px 15px 16px",
      }}>{deti}</div>
    </div>
  );

  if (nacitam) return obal(
    <div style={{ fontSize: "13px", color: theme.textSub }}>Načítám…</div>);

  if (!ted) return obal(
    <>
      <div style={{ fontSize: "15px", fontWeight: 700, color: theme.text, marginBottom: 6 }}>
        {fronta.length === 0 ? `${nazev} — nic k protřídění` : "Hotovo, protříděno."}
      </div>
      <div style={{ fontSize: "12.5px", color: theme.textSub, lineHeight: 1.6, marginBottom: 12 }}>
        {fronta.length === 0
          ? (napoveda || "Tady teď nic nečeká.")
          : `Prošel jsi ${fronta.length} ${fronta.length === 1 ? "položku" : fronta.length < 5 ? "položky" : "položek"}.`}
      </div>
      {historie.length > 0 && (
        <button onClick={zpet} style={{ ...btnGhost(theme), marginRight: 6 }}>← Vrátit poslední</button>
      )}
      <button onClick={onClose} style={btnMain(theme)}>Zavřít</button>
      {hlaska && <div style={{ fontSize: "11.5px", color: theme.yellow, marginTop: 8 }}>{hlaska}</div>}
    </>
  );

  const h = hlavicka?.(ted) || { nazev: String(ted?.name || "") };
  const vybrano = vyber[aktualni?.klic] || [];
  const bezZvlastnich = (aktualni?.volby || []).filter(o => !o.klavesa);

  return obal(
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
        <span style={{ fontSize: "15px", fontWeight: 700, color: theme.text }}>{nazev}</span>
        <span style={{ fontSize: "11px", color: theme.textSub }}>
          zbývá {zbyva} z {fronta.length}
          {kroky.length > 1 ? ` · krok ${krok + 1} ze ${kroky.length}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} title="Zavřít — zbytek počká" aria-label="Zavřít"
          style={{ ...btn(), background: "transparent", color: theme.textSub, fontSize: "16px" }}>×</button>
      </div>
      <div style={{ fontSize: "11.5px", color: theme.textSub, marginBottom: 10 }}>
        Čísla označují, <strong style={{ fontWeight: 700 }}>Enter</strong> potvrdí a jde dál.
        Bez označení Enter položku přeskočí.
        {upravitJmeno && " Jméno jde přepsat kliknutím."}
      </div>

      <div style={{
        border: `1px solid ${theme.cardBorder}`, borderRadius: 10,
        padding: "12px 13px", marginBottom: 11, background: theme.inputBg,
      }}>
        {upravitJmeno ? (
          /* Pole, ne text — ale bez rámečku a bez autofocusu.
             Autofocus by vypnul číselné klávesy (obsluha kláves
             ignoruje vstupní pole), a tím by zmizel celý smysl
             vlny. Takhle je jméno vidět jako nadpis a sáhneš
             na něj jen tehdy, když ho chceš srovnat. */
          <input
            value={jmeno}
            onChange={(e) => setJmeno(e.target.value)}
            disabled={pracuji}
            title="Jméno do Lidí. Můžeš ho srovnat — v čekárně zůstane původní."
            aria-label="Jméno kontaktu"
            onKeyDown={(e) => {
              // Enter potvrdí jméno a vrátí klávesy vlně.
              if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
              /* Escape vrátí původní jméno. Bez zastavení by
                 probublal k obsluze a zavřel celou vlnu. */
              if (e.key === "Escape") {
                e.preventDefault(); e.stopPropagation();
                setJmeno(String(ted?.name || ""));
                e.currentTarget.blur();
              }
            }}
            style={{
              width: "100%", boxSizing: "border-box",
              fontSize: "17px", fontWeight: 700, color: theme.text,
              lineHeight: 1.35, fontFamily: "inherit",
              background: "transparent", border: "none", outline: "none",
              borderBottom: `1px dashed ${theme.cardBorder}`,
              padding: "0 0 2px", margin: 0,
            }}
          />
        ) : (
          <div style={{ fontSize: "17px", fontWeight: 700, color: theme.text, lineHeight: 1.35 }}>
            {h.nazev}
          </div>
        )}
        {h.podnadpis && (
          <div style={{ fontSize: "12.5px", color: theme.textSub, marginTop: 4, lineHeight: 1.6 }}>
            {h.podnadpis}
          </div>
        )}
        {h.dodatek && (
          <div style={{ fontSize: "10.5px", color: theme.textMid, marginTop: 3 }}>{h.dodatek}</div>
        )}
      </div>

      {aktualni?.otazka && (
        <div style={{
          fontSize: "10px", fontWeight: 700, letterSpacing: "0.07em",
          textTransform: "uppercase", color: theme.textSub, marginBottom: 6,
        }}>{aktualni.otazka}</div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {(aktualni?.volby || []).map((o) => {
          const i = bezZvlastnich.indexOf(o);
          const klavesa = o.klavesa || (i >= 0 && i < MAX_KLAVES ? String(i + 1) : null);
          const zap = vybrano.includes(o.key);
          return (
            <button key={o.key} onClick={() => prepni(aktualni.klic, o, aktualni.vice)}
              disabled={pracuji}
              aria-pressed={zap}
              title={`${o.label}${klavesa ? ` (klávesa ${klavesa})` : ""} — označí, Enter potvrdí`}
              style={{
                ...btn(), display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 12px", borderRadius: 9, fontSize: "13px",
                fontWeight: zap ? 700 : 500,
                background: zap ? theme.accent : "transparent",
                color: zap ? "#fff" : theme.text,
                border: `1px solid ${zap ? theme.accent : theme.cardBorder}`,
              }}>
              {klavesa && (
                <span style={{
                  fontSize: "10px", fontWeight: 700, opacity: 0.8,
                  border: `1px solid ${zap ? "rgba(255,255,255,0.5)" : theme.cardBorder}`,
                  borderRadius: 4, padding: "0 5px",
                }}>{klavesa}</span>
              )}
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={dal} disabled={pracuji}
          title={krok < kroky.length - 1
            ? "Další krok (Enter)"
            : vybrano.length || Object.values(vyber).some(x => x?.length)
              ? "Potvrdit a jít na další (Enter)"
              : "Nic jsi neoznačil — Enter položku přeskočí"}
          style={{ ...btnMain(theme), minHeight: 38, padding: "0 16px" }}>
          {krok < kroky.length - 1 ? "Dál ⏎" : "Potvrdit ⏎"}
        </button>
        <button onClick={zpet} disabled={pracuji || (krok === 0 && historie.length === 0)}
          title={krok > 0
            ? "O krok zpět (Backspace)"
            : historie.length
              ? `Vrátit zpět: ${hlavicka?.(historie[0].polozka)?.nazev || "poslední"} (Backspace)`
              : "Zatím není co vracet"}
          style={{
            ...btn(), padding: "9px 13px", borderRadius: 9, fontSize: "13px",
            background: "transparent",
            color: (krok > 0 || historie.length) ? theme.text : theme.textDim,
            border: `1px solid ${theme.cardBorder}`,
            opacity: (krok > 0 || historie.length) ? 1 : 0.5,
          }}>← Zpět</button>
      </div>

      {chyba && <div style={{ fontSize: "12px", color: theme.red, marginTop: 8 }}>{chyba}</div>}
      {hlaska && <div style={{ fontSize: "11.5px", color: theme.yellow, marginTop: 8 }}>{hlaska}</div>}

      {patka && (
        <div style={{
          fontSize: "10.5px", color: theme.textMid, lineHeight: 1.7,
          borderTop: `1px solid ${theme.cardBorder}`, paddingTop: 8, marginTop: 10,
        }}>{patka}</div>
      )}
    </>
  );
}
