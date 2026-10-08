/* ═══════════════════════════════════════════════════════
   OBCHOD — správa číselníků

   Seznamy, ze kterých se vybírá: typy nemovitostí, fáze,
   stavy, role, kraje, jednotky.

   Dvě věci, které stojí za vysvětlení:

   Klíč vs. popisek. V datech je zapsaný klíč, ty vidíš popisek.
   Popisek jde přejmenovat kdykoli a promítne se i do starých
   záznamů. Klíč se nemění nikdy, jinak by data osiřela.

   Pořadí není jen kosmetika. U fází podle něj systém pozná,
   co je "dál" — a na tom stojí párování "nejméně fáze".
   ═══════════════════════════════════════════════════════ */

import { useState, useEffect } from "react";
import {
  nactiCiselniky, ulozCiselnik, smazCiselnik, prerovnejCiselnik, naKlic,
} from "./api.js";
import { card, input, btn, btnMain, btnGhost, pocet } from "./ui.js";

const SEZNAMY = [
  { kind: "typ",           t: "Typy nemovitostí", popis: "Co se nabízí." },
  { kind: "faze",          t: "Fáze přípravy",    popis: "Pořadí má význam: podle něj se porovnává „nejméně fáze“ u investorů." },
  { kind: "stav_zakazky",  t: "Stavy zakázky",    popis: "Kde je celý případ." },
  { kind: "stav_osloveni", t: "Stavy oslovení",   popis: "Žebřík jednání s jedním investorem. Odmítl a bez odezvy patří na konec." },
  { kind: "role",          t: "Role",             popis: "Čím ti člověk je — obecně i v konkrétní zakázce." },
  { kind: "forma_dohody",  t: "Formy dohody",     popis: "Jak pevně je domluvená provize." },
  { kind: "jednotka",      t: "Jednotky velikosti", popis: "Bytů, domů, m², lůžek." },
  { kind: "kraj",          t: "Kraje",            popis: "Skupina slouží jako zkratka — Čechy, Morava." },
];

export default function Ciselniky({ theme, owner, onZmena }) {
  const [vse, setVse] = useState({});
  const [busy, setBusy] = useState(true);
  const [otevreny, setOtevreny] = useState("typ");

  const nacti = async () => {
    setBusy(true);
    setVse(await nactiCiselniky(owner));
    setBusy(false);
    onZmena?.();
  };
  useEffect(() => { if (owner) nacti(); }, [owner]);  // eslint-disable-line

  return (
    <div>
      {busy && Object.keys(vse).length === 0 && (
        <div style={{ fontSize: "12px", color: theme.textSub, padding: "8px 2px" }}>Načítám…</div>
      )}

      {SEZNAMY.map(sz => {
        const polozky = vse[sz.kind] || [];
        const otevreno = otevreny === sz.kind;
        return (
          <div key={sz.kind} style={{ ...card(theme), marginBottom: 7, overflow: "hidden" }}>
            <div onClick={() => setOtevreny(otevreno ? null : sz.kind)} style={{
              padding: "10px 12px", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: theme.text, flex: 1 }}>
                {sz.t}
              </span>
              <span style={{ fontSize: "11px", color: theme.textSub }}>
                {pocet(polozky.filter(p => p.active).length, "položka", "položky", "položek")}
              </span>
              <span style={{ fontSize: "11px", color: theme.textDim }}>{otevreno ? "▲" : "▼"}</span>
            </div>

            {otevreno && (
              <Seznam theme={theme} owner={owner} kind={sz.kind}
                popis={sz.popis} polozky={polozky} onZmena={nacti} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Seznam({ theme, owner, kind, popis, polozky, onZmena }) {
  const [edituji, setEdituji] = useState(null);
  const [novy, setNovy] = useState("");
  const [chyba, setChyba] = useState(null);
  const [pracuji, setPracuji] = useState(false);
  const skupiny = kind === "kraj";

  const pridej = async () => {
    const t = novy.trim();
    if (!t) return;
    setPracuji(true); setChyba(null);
    const res = await ulozCiselnik(owner, {
      kind, label: t,
      key: naKlic(t, polozky.map(p => p.key)),
      sort_order: (polozky.length + 1) * 10,
      active: true,
    });
    setPracuji(false);
    if (!res.ok) { setChyba(res.chyba); return; }
    setNovy("");
    onZmena();
  };

  const prepniAktivni = async (p) => {
    setChyba(null);
    const res = await ulozCiselnik(owner, { ...p, active: !p.active });
    if (!res.ok) { setChyba(res.chyba); return; }
    onZmena();
  };

  const posun = async (i, smer) => {
    const j = i + smer;
    if (j < 0 || j >= polozky.length) return;
    const nove = [...polozky];
    [nove[i], nove[j]] = [nove[j], nove[i]];
    setPracuji(true);
    const res = await prerovnejCiselnik(nove);
    setPracuji(false);
    if (!res.ok) { setChyba(res.chyba); return; }
    onZmena();
  };

  const smaz = async (p) => {
    setPracuji(true); setChyba(null);
    const res = await smazCiselnik(owner, p);
    setPracuji(false);
    if (!res.ok) { setChyba(res.chyba); return; }
    onZmena();
  };

  return (
    <div style={{ padding: "0 12px 12px", borderTop: `1px solid ${theme.cardBorder}` }}>
      <div style={{ fontSize: "11px", color: theme.textSub, lineHeight: 1.6, margin: "9px 0 9px" }}>
        {popis}
      </div>

      {chyba && (
        <div style={{
          background: `${theme.yellow}15`, border: `1px solid ${theme.yellow}44`,
          borderRadius: 8, padding: "8px 10px", fontSize: "11.5px",
          color: theme.yellow, marginBottom: 9, lineHeight: 1.6,
        }}>{chyba}</div>
      )}

      {polozky.map((p, i) => (
        <div key={p.id} style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 0", opacity: p.active ? 1 : 0.45,
          borderBottom: i < polozky.length - 1 ? `1px solid ${theme.cardBorder}55` : "none",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <button onClick={() => posun(i, -1)} disabled={i === 0 || pracuji} title="Nahoru" style={{
              ...btn(), background: "transparent", color: i === 0 ? theme.textDim : theme.textSub,
              fontSize: "9px", padding: 0, lineHeight: 1,
            }}>▲</button>
            <button onClick={() => posun(i, 1)} disabled={i === polozky.length - 1 || pracuji}
              title="Dolů" style={{
                ...btn(), background: "transparent",
                color: i === polozky.length - 1 ? theme.textDim : theme.textSub,
                fontSize: "9px", padding: 0, lineHeight: 1,
              }}>▼</button>
          </div>

          {edituji === p.id ? (
            <Prejmenovani theme={theme} owner={owner} p={p} skupiny={skupiny}
              onHotovo={() => { setEdituji(null); onZmena(); }}
              onZrus={() => setEdituji(null)}
              onChyba={setChyba} />
          ) : (
            <>
              <span style={{ flex: 1, fontSize: "12.5px", color: theme.text }}>
                {p.label}
                {p.skupina && (
                  <span style={{ color: theme.textSub, fontSize: "11px" }}> · {p.skupina}</span>
                )}
                {!p.active && (
                  <span style={{ color: theme.textSub, fontSize: "10.5px" }}> · vypnuto</span>
                )}
              </span>
              <button onClick={() => setEdituji(p.id)} title="Přejmenovat" style={{
                ...btn(), background: "transparent", color: theme.textSub,
                fontSize: "11px", padding: "2px 4px",
              }}>✎</button>
              <button onClick={() => prepniAktivni(p)}
                title={p.active ? "Vypnout — zůstane u starých dat" : "Zapnout"} style={{
                  ...btn(), background: "transparent",
                  color: p.active ? theme.textSub : theme.green,
                  fontSize: "11px", padding: "2px 4px",
                }}>{p.active ? "⏻" : "+"}</button>
              <Smazani theme={theme} onSmaz={() => smaz(p)} pracuji={pracuji} />
            </>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <input value={novy} onChange={e => { setNovy(e.target.value); setChyba(null); }}
          onKeyDown={e => { if (e.key === "Enter") pridej(); }}
          placeholder="Nová položka — napiš a dej Enter"
          style={{ ...input(theme), flex: 1 }} />
        <button onClick={pridej} disabled={!novy.trim() || pracuji} style={{
          ...btnMain(theme), opacity: novy.trim() && !pracuji ? 1 : 0.5,
        }}>přidat</button>
      </div>
    </div>
  );
}

function Prejmenovani({ theme, owner, p, skupiny, onHotovo, onZrus, onChyba }) {
  const [label2, setLabel2] = useState(p.label);
  const [skupina, setSkupina] = useState(p.skupina || "");
  const [uklada, setUklada] = useState(false);

  const uloz = async () => {
    setUklada(true);
    const res = await ulozCiselnik(owner, { ...p, label: label2, skupina });
    setUklada(false);
    if (!res.ok) { onChyba(res.chyba); return; }
    onHotovo();
  };

  return (
    <div style={{ flex: 1, display: "flex", gap: 5, alignItems: "center" }}>
      <input value={label2} onChange={e => setLabel2(e.target.value)} autoFocus
        onKeyDown={e => { if (e.key === "Enter") uloz(); if (e.key === "Escape") onZrus(); }}
        style={{ ...input(theme), flex: 1 }} />
      {skupiny && (
        <input value={skupina} onChange={e => setSkupina(e.target.value)}
          placeholder="skupina" style={{ ...input(theme), maxWidth: 110 }} />
      )}
      <button onClick={uloz} disabled={uklada} style={{
        ...btnMain(theme), padding: "5px 10px", fontSize: "11px",
      }}>ok</button>
      <button onClick={onZrus} style={{
        ...btnGhost(theme), padding: "5px 8px", fontSize: "11px",
      }}>×</button>
    </div>
  );
}

/* Smazání na dvě kliknutí. Jestli položka jde smazat, rozhodne
   databáze — použitá se jen vypne. */
function Smazani({ theme, onSmaz, pracuji }) {
  const [ptam, setPtam] = useState(false);
  useEffect(() => {
    if (!ptam) return;
    const id = setTimeout(() => setPtam(false), 4000);
    return () => clearTimeout(id);
  }, [ptam]);

  if (!ptam) {
    return (
      <button onClick={() => setPtam(true)} title="Smazat" style={{
        ...btn(), background: "transparent", color: theme.textDim,
        fontSize: "13px", padding: "2px 4px",
      }}>×</button>
    );
  }
  return (
    <button onClick={() => { setPtam(false); onSmaz(); }} disabled={pracuji} style={{
      ...btn(), background: "transparent", color: theme.red,
      fontSize: "10.5px", fontWeight: 700, padding: "2px 5px",
      border: `1px solid ${theme.red}44`, borderRadius: 5,
    }}>opravdu?</button>
  );
}

export { SEZNAMY };
