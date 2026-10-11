/* ═══════════════════════════════════════════════════════
   OBCHOD — lidé

   Tohle je ta databáze, kvůli které to celé vzniklo: investoři,
   zprostředkovatelé, developeři. Dosud byli schovaní pod 💼 → Síť →
   Kontakty, tedy na třetí kliknutí a pod názvem, který nikomu nic
   neřekl. Teď mají vlastní ikonu a vlastní obrazovku.

   Důležité je poslední číslo na řádku: KOLIK ROZDĚLANÝCH ZAKÁZEK
   TOMU ČLOVĚKU SEDÍ. Bez něj je to seznam jmen. S ním je to seznam
   lidí, kterým máš co poslat — a to je přesně ta věc, na kterou si
   člověk u dvou set kontaktů sám nevzpomene.

   Počítá to databáze (deal_match_projects), ne tahle obrazovka.
   Pravidla párování tak zůstávají na jednom místě a v seznamu
   i v detailu zakázky vychází stejně.
   ═══════════════════════════════════════════════════════ */

import { useState, useEffect, useMemo } from "react";
import {
  prehledLidi, zanedbani, popis, aktivni,
} from "./api.js";
import { KontaktEditor } from "./Site.jsx";
import { card, input, btn, btnMain, btnGhost, label, zvyrazni, pocet } from "./ui.js";

/* Řazení. Abeceda je na hledání konkrétního člověka, zbytek
   na otázku „s kým můžu dneska pracovat“. */
const RAZENI = [
  { k: "sedi",     t: "má co nabídnout" },
  { k: "abeceda",  t: "podle abecedy" },
  { k: "zanedbani", t: "dlouho neoslovení" },
];

export default function Lide({ theme, owner, ciselniky, onOtevriOsobu }) {
  const [radky, setRadky] = useState([]);
  const [busy, setBusy] = useState(true);
  const [hledat, setHledat] = useState("");
  const [role, setRole] = useState("");
  const [jak, setJak] = useState("sedi");
  const [novy, setNovy] = useState(false);
  const [obnov, setObnov] = useState(0);
  const [zanedbani_, setZanedbani] = useState([]);

  useEffect(() => {
    let zrus = false;
    setBusy(true);
    prehledLidi(role || null).then(r => {
      if (!zrus) { setRadky(r || []); setBusy(false); }
    });
    return () => { zrus = true; };
  }, [owner, role, obnov]);

  useEffect(() => {
    let zrus = false;
    zanedbani(90, 50).then(r => { if (!zrus) setZanedbani(r || []); });
    return () => { zrus = true; };
  }, [owner, obnov]);

  /* Jméno, kontakt i poznámka. Hledá se až tady, aby psaní
     nevyvolávalo dotaz za dotazem. */
  const videt = useMemo(() => {
    const h = hledat.trim();
    const bez = (x) => (x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const q = bez(h);
    const vybrane = !q ? radky : radky.filter(r =>
      bez(r.jmeno).includes(q) || bez(r.kontakt).includes(q) || bez(r.poznamka).includes(q)
    );
    const kopie = [...vybrane];
    if (jak === "abeceda") {
      return kopie.sort((a, b) => (a.jmeno || "").localeCompare(b.jmeno || "", "cs"));
    }
    if (jak === "zanedbani") {
      // Nikdy neoslovení první — u nich je ta mezera největší.
      const dni = (r) => r.posledni_osloveni
        ? Math.floor((Date.now() - new Date(r.posledni_osloveni).getTime()) / 86400000)
        : 99999;
      return kopie.sort((a, b) => dni(b) - dni(a) || (b.sedi_zakazek - a.sedi_zakazek));
    }
    return kopie.sort((a, b) =>
      (b.sedi_zakazek || 0) - (a.sedi_zakazek || 0) ||
      (b.karet || 0) - (a.karet || 0) ||
      (a.jmeno || "").localeCompare(b.jmeno || "", "cs"));
  }, [radky, hledat, jak]);

  const sKartou = radky.filter(r => r.karet > 0).length;
  const maCoNabidnout = radky.filter(r => r.sedi_zakazek > 0).length;

  if (novy) {
    return (
      <div style={{ padding: "12px 16px 18px" }}>
        <button onClick={() => setNovy(false)} style={{ ...btnGhost(theme), marginBottom: 10 }}>
          ← zpět na lidi
        </button>
        <KontaktEditor theme={theme} owner={owner} ciselniky={ciselniky}
          onHotovo={(o) => {
            setNovy(false);
            setObnov(k => k + 1);
            // Rovnou do detailu: tam se vyplňuje karta, a bez karty
            // je nový člověk jen jméno v seznamu.
            if (o?.id) onOtevriOsobu?.(o.id);
          }}
          onZrus={() => setNovy(false)} />
      </div>
    );
  }

  return (
    <div style={{ padding: "12px 16px 18px" }}>
      {/* Shrnutí. Dvě čísla, která říkají, jak je databáze živá:
          kolik lidí má vyplněnou kartu a kolika z nich teď něco sedí. */}
      <div style={{
        ...card(theme), padding: "10px 12px", marginBottom: 10,
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ fontSize: "12px", color: theme.textSub, lineHeight: 1.6, flex: 1, minWidth: 180 }}>
          <strong style={{ color: theme.text }}>{radky.length}</strong> lidí ·{" "}
          <strong style={{ color: theme.text }}>{sKartou}</strong> s vyplněnou kartou ·{" "}
          <strong style={{ color: maCoNabidnout ? theme.green : theme.textSub }}>
            {maCoNabidnout}
          </strong>{" "}
          má co nabídnout
          {sKartou === 0 && radky.length > 0 && (
            <div style={{ color: theme.yellow, marginTop: 4 }}>
              Nikdo zatím nemá kartu. Bez ní se nedá párovat — otevři
              člověka a vyplň mu, co hledá.
            </div>
          )}
        </div>
        <button onClick={() => setNovy(true)} style={btnMain(theme)}>+ nový člověk</button>
      </div>

      {/* Komu jsi dlouho nic neposlal, i když mu něco sedí.
          Tohle je přímá náhrada za „vzpomenu si na dvacet“. */}
      {zanedbani_.length > 0 && jak !== "zanedbani" && (
        <div style={{
          background: `${theme.yellow}12`, border: `1px solid ${theme.yellow}44`,
          borderRadius: 10, padding: "9px 12px", marginBottom: 10,
          fontSize: "12px", color: theme.text, lineHeight: 1.6,
        }}>
          <strong>{pocet(zanedbani_.length, "člověk", "lidé", "lidí")}</strong>{" "}
          {zanedbani_.length === 1
            ? "má rozdělanou zakázku, která mu sedí, a přes tři měsíce jsi mu nic neposlal."
            : "mají rozdělanou zakázku, která jim sedí, a přes tři měsíce jsi jim nic neposlal."}
          <button onClick={() => setJak("zanedbani")} style={{
            ...btn(), background: "transparent", color: theme.accent,
            fontSize: "12px", fontWeight: 700, padding: "2px 4px",
          }}>ukázat je →</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <input value={hledat} onChange={e => setHledat(e.target.value)}
          placeholder="Jméno, telefon nebo slovo z poznámky…"
          style={{ ...input(theme), flex: "1 1 200px" }} />
        <select value={role} onChange={e => setRole(e.target.value)}
          style={{ ...input(theme), flex: "0 1 160px", cursor: "pointer" }}>
          <option value="">všechny role</option>
          {aktivni(ciselniky, "role").map(r => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", gap: 5, marginBottom: 10, flexWrap: "wrap" }}>
        {RAZENI.map(v => {
          const zap = jak === v.k;
          return (
            <button key={v.k} onClick={() => setJak(v.k)} style={{
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
          Zatím tu nikdo není.<br />
          Začni těmi, které bys oslovil zítra — ne všemi, co máš v telefonu.
        </div>
      )}

      {!busy && radky.length > 0 && videt.length === 0 && (
        <div style={{
          ...card(theme), padding: "16px", textAlign: "center",
          color: theme.textSub, fontSize: "12px",
        }}>Nikdo takový tu není.</div>
      )}

      {videt.map(r => (
        <Radek key={r.person_id} r={r} theme={theme} ciselniky={ciselniky}
          dotaz={hledat} onOtevri={() => onOtevriOsobu?.(r.person_id)} />
      ))}
    </div>
  );
}

function Radek({ r, theme, ciselniky, dotaz, onOtevri }) {
  const dni = r.posledni_osloveni
    ? Math.floor((Date.now() - new Date(r.posledni_osloveni).getTime()) / 86400000)
    : null;

  /* Kde se dotaz našel, když ne ve jméně. Jméno se zvýrazňuje nahoře,
     tohle je pro poznámku a kontakt. */
  const nalez = (() => {
    const q = (dotaz || "").trim();
    if (!q) return null;
    const bez = (x) => (x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (bez(r.jmeno).includes(bez(q))) return null;
    if (bez(r.poznamka).includes(bez(q))) return { kde: "poznámka", text: r.poznamka };
    if (bez(r.kontakt).includes(bez(q))) return { kde: "kontakt", text: r.kontakt };
    return null;
  })();

  return (
    <div onClick={onOtevri} style={{
      ...card(theme), padding: "9px 11px", marginBottom: 6, cursor: "pointer",
      display: "flex", alignItems: "center", gap: 10,
      // Zelený proužek u lidí, kterým teď něco sedí. V dlouhém
      // seznamu je to jediné, co se dá přelétnout očima.
      borderLeft: `3px solid ${r.sedi_zakazek > 0 ? theme.green : "transparent"}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: theme.text }}>
          {zvyrazni(r.jmeno, dotaz).map((k, i) =>
            k.shoda
              ? <mark key={i} style={{ background: `${theme.yellow}55`, color: theme.text }}>{k.text}</mark>
              : <span key={i}>{k.text}</span>
          )}
        </div>
        <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 2 }}>
          {[
            (r.role_tagy || []).map(t => popis(ciselniky, "role", t)).filter(Boolean).join(", "),
            r.kontakt,
            r.karet > 0 ? `🗂 ${pocet(r.karet, "karta", "karty", "karet")}` : "bez karty",
            dni === null
              ? "nikdy neoslovený"
              : dni === 0 ? "osloven dnes" : `osloven před ${dni} dny`,
          ].filter(Boolean).join(" · ")}
        </div>
      </div>

      {/* Když se našlo jinde než ve jméně, musí být vidět KDE.
          Jinak se v seznamu objeví člověk, u kterého hledané slovo
          nikde nesvítí, a vypadá to jako chyba hledání. */}
      {nalez && (
        <div style={{
          fontSize: "10.5px", color: theme.textSub, marginTop: 3,
          fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", maxWidth: 260,
        }}>
          {nalez.kde}:{" "}
          {zvyrazni(nalez.text, dotaz).map((k, i) =>
            k.shoda
              ? <mark key={i} style={{ background: `${theme.yellow}55`, color: theme.text }}>{k.text}</mark>
              : <span key={i}>{k.text}</span>
          )}
        </div>
      )}

      {r.sedi_zakazek > 0 && (
        <div style={{
          background: `${theme.green}18`, border: `1px solid ${theme.green}44`,
          borderRadius: 8, padding: "3px 8px", whiteSpace: "nowrap",
          fontSize: "11px", fontWeight: 700, color: theme.green,
        }}>sedí {r.sedi_zakazek}</div>
      )}
    </div>
  );
}
