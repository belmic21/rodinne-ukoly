/* ═══════════════════════════════════════════════════════
   OBCHOD — úkoly a poznámky u zakázky

   KDE CO ŽIJE — tohle je to podstatné rozhodnutí:

   ÚKOL patří do úkolníku. Je to práce, která se má udělat,
   a ta má být vidět tam, kde se člověk dívá ráno na den.
   U zakázky se jen zobrazuje navíc. Když ho odškrtneš,
   z úkolníku zmizí (jde mezi splněné), ale TADY zůstane
   přeškrtnutý — u zakázky chceš vidět i to, co je za tebou.

   POZNÁMKA patří zakázce. Do panelu Poznámky se neplete:
   provozní zápisky z obchodu nemají co dělat mezi soukromými
   poznámkami. Najdeš ji u zakázky a přes její číslo.

   Obojí se zakládá s kódem zakázky v názvu, takže napsáním
   "MB-10003" se k tomu dostaneš i odjinud.
   ═══════════════════════════════════════════════════════ */

import { useState, useEffect, useRef } from "react";
import {
  ukolyZakazky, poznamkyZakazky, ukolKZakazce, poznamkaKZakazce,
  prepniUkol, komuZadat, bezKodu,
} from "./api.js";
import {
  card, input, btn, btnMain, btnGhost, label, kdyPresne, ODZNAKY,
} from "./ui.js";

export default function Prilepene({ theme, owner, projectId, kod, spravce = false,
  skocSem = false, onZmena }) {
  const box = useRef(null);
  const [ukoly, setUkoly] = useState([]);
  const [poznamky, setPoznamky] = useState([]);
  const [lide, setLide] = useState([]);
  const [busy, setBusy] = useState(true);
  const [text, setText] = useState("");
  const [druh, setDruh] = useState("ukol");     // ukol | poznamka
  const [komu, setKomu] = useState("");
  const [priorita, setPriorita] = useState("");
  const [chyba, setChyba] = useState(null);
  const [uklada, setUklada] = useState(false);

  const nacti = async () => {
    setBusy(true);
    const [u, p, l] = await Promise.all([
      ukolyZakazky(projectId), poznamkyZakazky(projectId), komuZadat(owner, projectId),
    ]);
    setUkoly(u); setPoznamky(p); setLide(l); setBusy(false);
  };
  useEffect(() => { if (projectId) nacti(); }, [projectId]);  // eslint-disable-line

  useEffect(() => {
    if (!skocSem || busy) return;
    const id = setTimeout(() => {
      box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => clearTimeout(id);
  }, [skocSem, busy]);

  const jeUkol = druh === "ukol";

  /* Jedno uložení pro obojí. Po zápisu se pole vyčistí a druh
     zůstane — píšeš-li tři poznámky za sebou, nepřepínáš pokaždé. */
  const uloz = async () => {
    if (!text.trim()) return;
    setUklada(true); setChyba(null);
    const res = jeUkol
      ? await ukolKZakazce(owner, projectId, text, kod, komu || null, priorita || null)
      : await poznamkaKZakazce(owner, projectId, text, kod);
    setUklada(false);
    if (!res.ok) { setChyba(res.chyba); return; }
    setText("");
    nacti();
    if (jeUkol) onZmena?.();   // ať se úkol objeví i v hlavním seznamu
  };

  const odskrtni = async (t) => {
    const hotovo = (t.status || "") === "done";
    // Optimisticky překreslit — čekání na odpověď u odškrtnutí ruší.
    setUkoly(p => p.map(x => x.id === t.id
      ? { ...x, status: hotovo ? "active" : "done" } : x));
    const res = await prepniUkol(t.id, !hotovo, owner);
    if (!res.ok) { setChyba(res.chyba); nacti(); return; }
    onZmena?.();
  };

  // Nejnovější nahoře. U zakázky čteš průběh odzadu: co je čerstvé,
  // to řešíš. Nesplněné před splněnými, uvnitř podle času.
  const poCase = (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0);
  const otevrene = ukoly.filter(t => (t.status || "") !== "done").sort(poCase);
  const hotove = ukoly.filter(t => (t.status || "") === "done").sort(poCase);
  const poznamkyCas = [...poznamky].sort(poCase);

  return (
    <div ref={box} style={{ marginTop: 16, scrollMarginTop: 70 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span style={{ ...label(theme), marginBottom: 0, flex: 1 }}>
          Úkoly a poznámky
        </span>
        {(otevrene.length > 0 || hotove.length > 0) && (
          <span style={{ fontSize: "11px", color: theme.textSub }}>
            {ODZNAKY[0].ikona} {otevrene.length}
            {hotove.length > 0 && ` · ${hotove.length} hotovo`}
          </span>
        )}
      </div>

      {chyba && (
        <div style={{
          background: `${theme.red}18`, border: `1px solid ${theme.red}44`,
          borderRadius: 8, padding: "7px 10px", fontSize: "11.5px",
          color: theme.red, marginBottom: 8,
        }}>{chyba}</div>
      )}

      {/* Jedno pole pro obojí. Přepínač vpravo rozhoduje, co z toho
          vznikne — u úkolu se navíc ukáže, komu ho zadat. Dvě pole
          pod sebou nutila rozmyslet si to dřív, než začneš psát. */}
      <div style={{ ...card(theme), padding: "9px 10px", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 7 }}>
          <textarea value={text}
            onChange={e => { setText(e.target.value); setChyba(null); }}
            onKeyDown={e => {
              // Enter odešle, Shift+Enter zalomí — u poznámky se hodí víc řádků.
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); uloz(); }
            }}
            rows={3}
            placeholder={jeUkol
              ? "Co je potřeba udělat — Enter přidá úkol"
              : "Co padlo, na co nezapomenout — Enter uloží, Shift+Enter nový řádek"}
            // Stejná výška pro obojí. Když se měnila podle druhu,
            // celá sekce pod tím poskakovala při každém přepnutí.
            style={{
              ...input(theme), flex: 1, resize: "vertical", lineHeight: 1.6,
              minHeight: 64, height: 64,
            }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {[{ k: "ukol", t: "úkol" }, { k: "poznamka", t: "poznámka" }].map(v => {
              const zap = druh === v.k;
              return (
                <button key={v.k} onClick={() => setDruh(v.k)} style={{
                  ...btn(),
                  background: zap ? theme.accentSoft : "transparent",
                  border: `1px solid ${zap ? theme.accentBorder : theme.cardBorder}`,
                  color: zap ? theme.accent : theme.textSub,
                  fontSize: "11.5px", padding: "4px 11px", borderRadius: 13,
                  fontWeight: zap ? 700 : 600, whiteSpace: "nowrap",
                }}>{v.t}</button>
              );
            })}
          </div>
        </div>

        {/* Volby jen u úkolu. U poznámky nemají smysl a jen by matly. */}
        {jeUkol && (
          <div style={{
            display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minHeight: 30,
          }}>
            {lide.length > 1 && (
              <select value={komu} onChange={e => setKomu(e.target.value)}
                title="Komu úkol zadat"
                style={{ ...input(theme), width: "auto", flex: "0 0 auto", cursor: "pointer",
                  padding: "5px 8px", fontSize: "12px" }}>
                <option value="">pro mě</option>
                {lide.filter(l => !l.ja).map(l => (
                  <option key={l.name} value={l.name}>
                    pro {l.name}{l.vidi ? "" : " *"}
                  </option>
                ))}
              </select>
            )}
            <select value={priorita} onChange={e => setPriorita(e.target.value)}
              title="Priorita"
              style={{ ...input(theme), width: "auto", flex: "0 0 auto", cursor: "pointer",
                padding: "5px 8px", fontSize: "12px" }}>
              <option value="">běžné</option>
              <option value="medium">důležité</option>
              <option value="urgent">akutní</option>
            </select>
            {komu && !lide.find(l => l.name === komu)?.vidi && (
              <span title="Úkol dostane, ale zakázku zatím nevidí — nasdílej mu ji níž"
                style={{ fontSize: "10.5px", color: theme.yellow }}>
                * zakázku zatím nevidí
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={uloz} disabled={!text.trim() || uklada} style={{
              ...btnMain(theme), opacity: text.trim() && !uklada ? 1 : 0.5,
            }}>{uklada ? "UKLÁDÁM…" : "PŘIDAT ÚKOL"}</button>
          </div>
        )}

        {!jeUkol && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 30 }}>
            <button onClick={uloz} disabled={!text.trim() || uklada} style={{
              ...btnMain(theme), opacity: text.trim() && !uklada ? 1 : 0.5,
            }}>{uklada ? "UKLÁDÁM…" : "ULOŽIT POZNÁMKU"}</button>
            <span style={{ fontSize: "10.5px", color: theme.textSub }}>
              Zůstane u zakázky, do tvých poznámek se nedostane.
            </span>
          </div>
        )}
      </div>

      {busy && ukoly.length === 0 && poznamky.length === 0 && (
        <Tise theme={theme}>Načítám…</Tise>
      )}

      {!busy && ukoly.length === 0 && poznamky.length === 0 && (
        <Tise theme={theme}>
          Zatím nic. Úkol se objeví i ve tvém úkolníku pod „Aktivní",
          poznámka zůstane jen tady.
        </Tise>
      )}

      {/* Nesplněné nahoře, hotové pod nimi a přeškrtnuté. Nemizí —
          u zakázky chceš vidět i to, co je hotové. */}
      {[...otevrene, ...hotove].map(t => {
        const hotovo = (t.status || "") === "done";
        const cizi = t.created_by && t.created_by !== owner;
        const prokoho = (t.assigned_to || []).filter(x => x !== owner);
        return (
          <div key={t.id} style={{
            ...card(theme), padding: "8px 11px", marginBottom: 6,
            display: "flex", alignItems: "flex-start", gap: 9,
            opacity: hotovo ? 0.6 : 1,
          }}>
            <button onClick={() => odskrtni(t)}
              title={hotovo ? "Vrátit mezi nesplněné" : "Hotovo"}
              style={{
                ...btn(), background: "transparent", fontSize: "14px",
                padding: "0 2px", color: hotovo ? theme.green : theme.textDim,
              }}>{hotovo ? "☑" : "☐"}</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: "12.5px", fontWeight: 600, color: theme.text,
                textDecoration: hotovo ? "line-through" : "none",
              }}>{bezKodu(kod, t.title)}</div>
              <div style={{ fontSize: "10.5px", color: theme.textSub, marginTop: 2 }}>
                {[
                  hotovo ? "splněno" : "v úkolníku",
                  t.created_at ? kdyPresne(t.created_at) : null,
                  prokoho.length ? `pro ${prokoho.join(", ")}` : null,
                  cizi ? `zapsal ${t.created_by}` : null,
                ].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
        );
      })}

      {poznamkyCas.map(n => {
        const cizi = n.created_by && n.created_by !== owner;
        return (
          <div key={n.id} style={{
            ...card(theme), padding: "9px 11px", marginBottom: 6,
            borderLeft: `3px solid ${theme.yellow}66`,
          }}>
            <div style={{
              fontSize: "12.5px", color: theme.text, lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}>{n.content}</div>
            <div style={{ fontSize: "10.5px", color: theme.textSub, marginTop: 4 }}>
              {[
                "poznámka k zakázce",
                kdyPresne(n.created_at || n.updated_at),
                cizi ? `zapsal ${n.created_by}` : null,
              ].filter(Boolean).join(" · ")}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Odznaky u řádku zakázky. Klik otevře zakázku rovnou u úkolů
   a poznámek, ať se k nim nemusí rolovat. Když na zakázce nic
   není, ukáže se bledý plus — pořád je kam kliknout a přidat. */
export function Odznaky({ theme, pocty, onKlik }) {
  const neco = pocty && ODZNAKY.some(o => (pocty[o.k] || 0) > 0);
  return (
    <div
      onClick={(e) => { if (onKlik) { e.stopPropagation(); onKlik(); } }}
      title={neco ? "Úkoly a poznámky k zakázce" : "Přidat úkol nebo poznámku"}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        cursor: onKlik ? "pointer" : "default", whiteSpace: "nowrap",
        opacity: neco ? 1 : 0.4,
      }}>
      {neco ? ODZNAKY.filter(o => (pocty[o.k] || 0) > 0).map(o => (
        <span key={o.k} title={o.popis} style={{
          fontSize: "11px", color: theme.textSub, fontVariantNumeric: "tabular-nums",
        }}>
          {o.ikona} {pocty[o.k]}
        </span>
      )) : (
        <span style={{ fontSize: "12px", color: theme.textSub }}>＋</span>
      )}
    </div>
  );
}

function Tise({ theme, children }) {
  return (
    <div style={{
      fontSize: "11.5px", color: theme.textSub, lineHeight: 1.7, padding: "8px 2px",
    }}>{children}</div>
  );
}
