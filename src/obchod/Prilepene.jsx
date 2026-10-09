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
  card, input, btn, btnMain, btnGhost, label, datumKratce, jakDavno, ODZNAKY,
} from "./ui.js";

export default function Prilepene({ theme, owner, projectId, kod, spravce = false,
  skocSem = false, onZmena }) {
  const box = useRef(null);
  const [ukoly, setUkoly] = useState([]);
  const [poznamky, setPoznamky] = useState([]);
  const [lide, setLide] = useState([]);
  const [busy, setBusy] = useState(true);
  const [novyUkol, setNovyUkol] = useState("");
  const [komu, setKomu] = useState("");
  const [novaPozn, setNovaPozn] = useState("");
  const [pisuPozn, setPisuPozn] = useState(false);
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

  const pridejUkol = async () => {
    if (!novyUkol.trim()) return;
    setUklada(true); setChyba(null);
    const res = await ukolKZakazce(owner, projectId, novyUkol, kod, komu || null);
    setUklada(false);
    if (!res.ok) { setChyba(res.chyba); return; }
    setNovyUkol("");
    nacti();
    onZmena?.();            // ať se úkol objeví i v hlavním seznamu
  };

  const pridejPoznamku = async () => {
    if (!novaPozn.trim()) return;
    setUklada(true); setChyba(null);
    const res = await poznamkaKZakazce(owner, projectId, novaPozn, kod);
    setUklada(false);
    if (!res.ok) { setChyba(res.chyba); return; }
    setNovaPozn(""); setPisuPozn(false);
    nacti();
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

  const otevrene = ukoly.filter(t => (t.status || "") !== "done");
  const hotove = ukoly.filter(t => (t.status || "") === "done");

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

      {/* Jednořádkové zadání. Když u telefonu padne "sežeň výpis
          z katastru", nemá se vyplňovat formulář. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <input value={novyUkol}
          onChange={e => { setNovyUkol(e.target.value); setChyba(null); }}
          onKeyDown={e => { if (e.key === "Enter") pridejUkol(); }}
          placeholder="Co je potřeba udělat — Enter přidá úkol"
          style={{ ...input(theme), flex: "1 1 220px" }} />
        {lide.length > 1 && (
          <select value={komu} onChange={e => setKomu(e.target.value)}
            title="Komu úkol zadat"
            style={{ ...input(theme), width: "auto", flex: "0 0 auto", cursor: "pointer" }}>
            <option value="">pro mě</option>
            {lide.filter(l => !l.ja).map(l => (
              <option key={l.name} value={l.name}>pro {l.name}</option>
            ))}
          </select>
        )}
        <button onClick={pridejUkol} disabled={!novyUkol.trim() || uklada} style={{
          ...btnMain(theme), opacity: novyUkol.trim() && !uklada ? 1 : 0.5,
        }}>+ úkol</button>
        {!pisuPozn && (
          <button onClick={() => setPisuPozn(true)} style={btnGhost(theme)}>+ poznámka</button>
        )}
      </div>

      {pisuPozn && (
        <div style={{ ...card(theme), padding: "10px 12px", marginBottom: 8 }}>
          <textarea value={novaPozn}
            onChange={e => { setNovaPozn(e.target.value); setChyba(null); }}
            rows={3} placeholder="Co padlo, na co nezapomenout, co se domluvilo."
            style={{ ...input(theme), resize: "vertical", lineHeight: 1.6, marginBottom: 7 }} />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={pridejPoznamku} disabled={!novaPozn.trim() || uklada} style={{
              ...btnMain(theme), opacity: novaPozn.trim() && !uklada ? 1 : 0.5,
            }}>{uklada ? "UKLÁDÁM…" : "ULOŽIT POZNÁMKU"}</button>
            <button onClick={() => { setPisuPozn(false); setNovaPozn(""); setChyba(null); }}
              style={btnGhost(theme)}>zrušit</button>
            <span style={{ fontSize: "10.5px", color: theme.textSub }}>
              Zůstane u zakázky, do tvých poznámek se nedostane.
            </span>
          </div>
        </div>
      )}

      {busy && ukoly.length === 0 && poznamky.length === 0 && (
        <Tise theme={theme}>Načítám…</Tise>
      )}

      {!busy && ukoly.length === 0 && poznamky.length === 0 && !pisuPozn && (
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
                  t.created_at ? `zadáno ${jakDavno(t.created_at)}` : null,
                  prokoho.length ? `pro ${prokoho.join(", ")}` : null,
                  cizi ? `zapsal ${t.created_by}` : null,
                ].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
        );
      })}

      {poznamky.map(n => {
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
                datumKratce(n.updated_at || n.created_at),
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
