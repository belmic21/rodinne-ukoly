/* ═══════════════════════════════════════════════════════
   OBCHOD — termíny

   Dvě obrazovky ze stejných dat:

   TerminySekce  — v detailu zakázky, termíny jedné zakázky
   TerminyPrehled — přes všechny zakázky, seřazené podle naléhavosti

   Termín patří k zakázce a volitelně ke konkrétnímu člověku.
   U jedné zakázky jich může být víc, každý s někým jiným.

   Barva se počítá ze zbývajících dní, ne z druhu termínu.
   U výkupu je týden stres, u due diligence ne — ale naléhavost
   je nakonec vždycky jen „kolik času zbývá".
   ═══════════════════════════════════════════════════════ */

import { useState, useEffect } from "react";
import {
  nactiTerminy, prehledTerminu, ulozTermin, splnTermin, smazTermin,
  nalehavost, barvaTerminu,
} from "./api.js";
import { VyberOsoby } from "./Site.jsx";
import { card, input, btn, btnMain, btnGhost, label, datumKratce } from "./ui.js";

const DNES = () => new Date().toISOString().slice(0, 10);
const ZA_DNI = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/* ════════════════════════════════════════════════════════
   SEKCE V DETAILU ZAKÁZKY
   ════════════════════════════════════════════════════════ */

export function TerminySekce({ theme, owner, projectId, nazevZakazky, onOtevriOsobu,
  ciselniky, spravce = false }) {
  const [radky, setRadky] = useState([]);
  const [busy, setBusy] = useState(true);
  const [edituji, setEdituji] = useState(null);
  const [chyba, setChyba] = useState(null);
  const [ukazHotove, setUkazHotove] = useState(false);

  const nacti = async () => {
    setBusy(true);
    setRadky(await nactiTerminy(projectId));
    setBusy(false);
  };
  useEffect(() => { if (projectId) nacti(); }, [projectId]);  // eslint-disable-line

  const uloz = async (data) => {
    setChyba(null);
    const res = await ulozTermin(owner, { ...data, project_id: projectId }, nazevZakazky);
    if (!res.ok) { setChyba(res.chyba); return; }
    setEdituji(null);
    nacti();
  };

  const otevrene = radky.filter(r => !r.hotovo_at);
  const hotove = radky.filter(r => r.hotovo_at);
  const videt = ukazHotove ? radky : otevrene;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span style={{ ...label(theme), marginBottom: 0, flex: 1 }}>Termíny</span>
        {hotove.length > 0 && (
          <button onClick={() => setUkazHotove(v => !v)} style={{
            ...btn(), background: "transparent", color: theme.textSub,
            fontSize: "11px", padding: "2px 5px",
          }}>{ukazHotove ? "skrýt splněné" : `splněné (${hotove.length})`}</button>
        )}
        {!edituji && (
          <button onClick={() => setEdituji({ datum: ZA_DNI(7), pripomenout: true })}
            style={btnGhost(theme)}>+ termín</button>
        )}
      </div>

      {chyba && (
        <div style={{
          background: `${theme.red}18`, border: `1px solid ${theme.red}44`,
          borderRadius: 8, padding: "7px 10px", fontSize: "11.5px",
          color: theme.red, marginBottom: 8,
        }}>{chyba}</div>
      )}

      {edituji && (
        <TerminEditor theme={theme} owner={owner} ciselniky={ciselniky} t={edituji}
          onUloz={uloz} onZrus={() => { setEdituji(null); setChyba(null); }} />
      )}

      {busy && radky.length === 0 && (
        <div style={{ fontSize: "11.5px", color: theme.textSub, padding: "6px 2px" }}>Načítám…</div>
      )}

      {!busy && otevrene.length === 0 && !edituji && (
        <div style={{ fontSize: "11.5px", color: theme.textSub, lineHeight: 1.7, padding: "6px 2px" }}>
          Žádný termín. U výkupu bývá na reakci týden — zapiš si ho,
          ať ti neuteče.
        </div>
      )}

      {videt.map(t => (
        <TerminRadek key={t.id} t={t} theme={theme} owner={owner}
          moje={spravce || !t.owner || t.owner === owner}
          onUprav={() => setEdituji({ ...t, pripomenout: !!t.reminder_id })}
          onZmena={nacti} onOtevriOsobu={onOtevriOsobu} />
      ))}
    </div>
  );
}

function TerminRadek({ t, theme, owner, onUprav, onZmena, onOtevriOsobu, moje = true }) {
  const [pracuji, setPracuji] = useState(false);
  const hotovo = !!t.hotovo_at;
  const zbyva = Math.round(
    (new Date(t.datum + "T00:00:00") - new Date(DNES() + "T00:00:00")) / 86400000
  );
  const n = nalehavost(zbyva);
  const barva = hotovo ? theme.textSub : barvaTerminu(theme, n.klic);

  const prepni = async () => {
    setPracuji(true);
    await splnTermin(t.id, !hotovo, t.reminder_id);
    setPracuji(false);
    onZmena();
  };

  const smaz = async () => {
    setPracuji(true);
    await smazTermin(t.id, t.reminder_id);
    setPracuji(false);
    onZmena();
  };

  return (
    <div style={{
      ...card(theme), padding: "8px 11px", marginBottom: 6,
      display: "flex", alignItems: "center", gap: 9,
      borderLeft: `3px solid ${barva}`,
      opacity: hotovo ? 0.5 : 1,
    }}>
      <button onClick={prepni} disabled={pracuji || !moje}
        title={!moje ? `Termín zapsal ${t.owner}, odškrtnout si ho musí sám`
          : hotovo ? "Vrátit mezi nesplněné" : "Hotovo"}
        style={{
          ...btn(), background: "transparent", fontSize: "14px",
          padding: "0 2px", color: hotovo ? theme.green : theme.textDim,
          cursor: moje ? "pointer" : "default",
        }}>{hotovo ? "☑" : "☐"}</button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: "12.5px", fontWeight: 700, color: theme.text,
          textDecoration: hotovo ? "line-through" : "none",
        }}>{t.nazev}</div>
        <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 1 }}>
          {datumKratce(t.datum)}
          {t.osoba && (
            <>
              {" · "}
              <span onClick={() => onOtevriOsobu?.(t.person_id)}
                style={{ color: theme.accent, cursor: "pointer" }}>{t.osoba.name}</span>
            </>
          )}
          {t.reminder_id && !hotovo && " · ⏰"}
          {t.poznamka ? ` · ${t.poznamka}` : ""}
        </div>
        {t.owner && t.owner !== owner && (
          <div style={{ fontSize: "10.5px", color: theme.purple, marginTop: 2 }}>
            zapsal {t.owner}
          </div>
        )}
      </div>

      {!hotovo && (
        <span style={{
          fontSize: "11px", fontWeight: 700, color: barva, whiteSpace: "nowrap",
        }}>{n.popis}</span>
      )}

      {moje && (
        <>
          <button onClick={onUprav} style={{
            ...btn(), background: "transparent", color: theme.textSub,
            fontSize: "12px", padding: "2px 4px",
          }}>✎</button>
          <button onClick={smaz} disabled={pracuji} title="Smazat" style={{
            ...btn(), background: "transparent", color: theme.textDim,
            fontSize: "14px", padding: "2px 4px",
          }}>×</button>
        </>
      )}
    </div>
  );
}

function TerminEditor({ theme, owner, ciselniky, t, onUloz, onZrus }) {
  const [f, setF] = useState({
    id: t.id, nazev: t.nazev || "", datum: t.datum || ZA_DNI(7),
    person_id: t.person_id || null, osoba: t.osoba || null,
    poznamka: t.poznamka || "", reminder_id: t.reminder_id || null,
    pripomenout: t.pripomenout !== false,
  });
  const [vybiram, setVybiram] = useState(false);
  const uprav = (k, v) => setF(p => ({ ...p, [k]: v }));

  const rychle = [
    { t: "zítra", d: 1 },
    { t: "do týdne", d: 7 },
    { t: "do 14 dní", d: 14 },
    { t: "do měsíce", d: 30 },
  ];

  return (
    <div style={{ ...card(theme), padding: "11px 12px", marginBottom: 9 }}>
      <div style={{ marginBottom: 8 }}>
        <span style={label(theme)}>Co se má stát</span>
        <input value={f.nazev} onChange={e => uprav("nazev", e.target.value)} autoFocus
          placeholder="Reagovat na nabídku / podpis / složit zálohu"
          style={input(theme)} />
      </div>

      <div style={{ marginBottom: 8 }}>
        <span style={label(theme)}>Do kdy</span>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          <input type="date" value={f.datum} onChange={e => uprav("datum", e.target.value)}
            style={{ ...input(theme), maxWidth: 150, cursor: "pointer" }} />
          {rychle.map(r => (
            <button key={r.d} onClick={() => uprav("datum", ZA_DNI(r.d))}
              style={btnGhost(theme)}>{r.t}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <span style={label(theme)}>S kým — nepovinné</span>
        {vybiram ? (
          <VyberOsoby theme={theme} owner={owner} ciselniky={ciselniky}
            onZrus={() => setVybiram(false)}
            onVyber={(o) => {
              setF(p => ({ ...p, person_id: o.id, osoba: o }));
              setVybiram(false);
            }} />
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={() => setVybiram(true)} style={btnGhost(theme)}>
              {f.osoba ? f.osoba.name : "+ vybrat člověka"}
            </button>
            {f.osoba && (
              <button onClick={() => setF(p => ({ ...p, person_id: null, osoba: null }))}
                style={{
                  ...btn(), background: "transparent", color: theme.textDim,
                  fontSize: "13px", padding: "2px 5px",
                }}>×</button>
            )}
          </div>
        )}
      </div>

      <input value={f.poznamka} onChange={e => uprav("poznamka", e.target.value)}
        placeholder="Poznámka — nepovinné" style={{ ...input(theme), marginBottom: 8 }} />

      <div onClick={() => uprav("pripomenout", !f.pripomenout)} style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "4px 2px", cursor: "pointer", marginBottom: 9,
      }}>
        <span style={{ fontSize: "14px" }}>{f.pripomenout ? "☑" : "☐"}</span>
        <span style={{ fontSize: "12px", color: f.pripomenout ? theme.text : theme.textSub }}>
          Připomenout — ozve se ráno v den termínu, i když aplikaci neotevřeš
        </span>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onUloz(f)} style={btnMain(theme)}>ULOŽIT</button>
        <button onClick={onZrus} style={btnGhost(theme)}>zrušit</button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   PŘEHLED PŘES VŠECHNY ZAKÁZKY
   ════════════════════════════════════════════════════════ */

export function TerminyPrehled({ theme, owner, onOtevriZakazku, onOtevriOsobu }) {
  const [radky, setRadky] = useState([]);
  const [busy, setBusy] = useState(true);
  const [rozsah, setRozsah] = useState(30);

  useEffect(() => {
    let zrus = false;
    setBusy(true);
    prehledTerminu(owner, rozsah).then(r => { if (!zrus) { setRadky(r); setBusy(false); } });
    return () => { zrus = true; };
  }, [owner, rozsah]);

  const skupiny = [
    { klic: "po",    nadpis: "Po termínu" },
    { klic: "dnes",  nadpis: "Dnes a zítra" },
    { klic: "tyden", nadpis: "Tento týden" },
    { klic: "mesic", nadpis: "Tento měsíc" },
    { klic: "dale",  nadpis: "Později" },
  ];

  const rozdelene = skupiny.map(s => ({
    ...s,
    polozky: radky.filter(r => nalehavost(r.zbyva).klic === s.klic),
  })).filter(s => s.polozky.length > 0);

  return (
    <div style={{ padding: "12px 16px 18px" }}>
      <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
        {[{ d: 7, t: "týden" }, { d: 30, t: "měsíc" }, { d: 90, t: "čtvrtletí" }].map(v => {
          const zap = rozsah === v.d;
          return (
            <button key={v.d} onClick={() => setRozsah(v.d)} style={{
              ...btnGhost(theme),
              background: zap ? theme.accentSoft : "transparent",
              color: zap ? theme.accent : theme.textSub,
              borderColor: zap ? theme.accentBorder : theme.cardBorder,
              fontWeight: zap ? 700 : 600,
            }}>{v.t}</button>
          );
        })}
      </div>

      {busy && radky.length === 0 && (
        <div style={{ fontSize: "12px", color: theme.textSub }}>Načítám…</div>
      )}

      {!busy && radky.length === 0 && (
        <div style={{
          ...card(theme), padding: "20px 16px", textAlign: "center",
          color: theme.textSub, fontSize: "12px", lineHeight: 1.7,
        }}>
          Žádný termín v tomhle rozsahu. Termíny se zadávají u zakázky —
          otevři ji a najdeš je pod seznamem oslovených.
        </div>
      )}

      {rozdelene.map(s => (
        <div key={s.klic} style={{ marginBottom: 14 }}>
          <div style={{
            ...label(theme), marginBottom: 6,
            color: barvaTerminu(theme, s.klic),
          }}>{s.nadpis} ({s.polozky.length})</div>

          {s.polozky.map(r => {
            const n = nalehavost(r.zbyva);
            const barva = barvaTerminu(theme, n.klic);
            return (
              <div key={r.id} onClick={() => onOtevriZakazku?.({ id: r.project_id })} style={{
                ...card(theme), padding: "9px 11px", marginBottom: 6,
                borderLeft: `3px solid ${barva}`, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 9,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12.5px", fontWeight: 700, color: theme.text }}>
                    {r.nazev}
                  </div>
                  <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 1 }}>
                    {r.kod} · {r.zakazka}
                    {r.s_kym && (
                      <>
                        {" · "}
                        <span onClick={(e) => { e.stopPropagation(); onOtevriOsobu?.(r.person_id); }}
                          style={{ color: theme.accent, cursor: "pointer" }}>{r.s_kym}</span>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: barva }}>{n.popis}</div>
                  <div style={{ fontSize: "10.5px", color: theme.textSub }}>
                    {datumKratce(r.datum)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
