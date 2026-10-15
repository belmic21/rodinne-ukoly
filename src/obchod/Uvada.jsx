/* ════════════════════════════════════════════════════════
   CO TIŠE UVADÁ

   Michal, 15. 10.: „jak by měl fungovat druhý mozek v tom, co
   obsahuje náš systém? Stavíme náš systém, ty a já."

   Odpověď, na které jsme se shodli: seznam posledních kontaktů
   je log. Log jen potvrdí, že sis to pamatoval správně — nic
   ti neřekne. Druhý mozek má držet to, co tiše uvadá.

   Úkol neuvadá. Má termín, nebo nemá. Ale vztah, rozjednaná
   zakázka a daný slib uvadají tak, že si toho nikdo nevšimne,
   protože se prostě nic nestane. A nestat se nic může hodně
   dlouho.

   Tři signály, všechny ze současných dat:

     1. Oslovil jsi a nic se nehnulo    (deal_approaches)
     2. Zakázka bez dalšího kroku        (deal_terminy)
     3. Slib bez pohybu                  (tasks, smer = slíbil)

   Každý z nich je rozhodnutí, ne čtení. Buď to doklepni, nebo
   to odepiš.
   ════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useMemo } from "react";
import { osloveniTicho, zakazkyBezKroku, uspiZakazku } from "./api.js";

const FONT = '"DM Sans", system-ui, -apple-system, sans-serif';

const btn = () => ({
  fontFamily: FONT, cursor: "pointer", borderRadius: 10,
  border: "none", transition: "background 0.12s ease-out",
});

/* Kolik dní ticha je ještě v pořádku. Čtrnáct dní u oslovení
   není nic — po měsíci už je to odpověď sama o sobě. */
const DNI_OSLOVENI = 14;
const DNI_ZAKAZKY = 7;
/* Jak dlouho smí zakázka viset v jedné fázi, než se to začne
   hlásit. Půldruhého měsíce je doba, za kterou se v obchodu
   buď něco pohne, nebo už nepohne. */
const DNI_FAZE = 45;
export const DNI_SLIBU = 14;

/* Jak starý slib už uvadá. Vystavené ven, aby si Dnes mohlo
   rozdělit sliby na ty, co patří sem, a na ty, co jsou jen
   běžný závazek — a žádný se neukázal dvakrát. */
export function slibUvada(t) {
  const kdy = t?.slibenoAt || t?.createdAt || t?.created_at;
  if (!kdy) return false;
  return Math.floor((Date.now() - new Date(kdy).getTime()) / 86400000) >= DNI_SLIBU;
}

function dnu(n) {
  const x = Math.abs(Math.round(n));
  return `${x} ${x === 1 ? "den" : x < 5 ? "dny" : "dní"}`;
}

export function CoUvada({ theme, owner, sliby = [], onOtevriUkol, onOtevriZakazku }) {
  const [ticho, setTicho] = useState([]);
  const [bezKroku, setBezKroku] = useState([]);
  const [nacteno, setNacteno] = useState(false);
  const [vic, setVic] = useState(false);

  /* Uspání rovnou z přehledu. Zakázka zmizí z očí do data, které
     zvolíš — a tím dnem se sama vrátí. To je jediná poctivá
     alternativa k „nechám to tu viset", která se jinak stane
     vždycky. */
  const [uspavam, setUspavam] = useState(null);
  const [chyba, setChyba] = useState(null);

  useEffect(() => {
    if (!owner) return;
    let zrus = false;
    Promise.all([osloveniTicho(DNI_OSLOVENI), zakazkyBezKroku(DNI_ZAKAZKY, DNI_FAZE)])
      .then(([a, b]) => {
        if (zrus) return;
        setTicho(a || []);
        setBezKroku(b || []);
        setNacteno(true);
      });
    return () => { zrus = true; };
  }, [owner]);

  /* Slib je dluh vůči člověku, ne úkol. Dnes končí v Protřídit
     mezi propadlými termíny — tam zapadne, protože vypadá jako
     všechno ostatní. */
  const stareSliby = useMemo(() => {
    const dni = (t) => {
      const kdy = t.slibenoAt || t.createdAt || t.created_at;
      if (!kdy) return 0;
      return Math.floor((Date.now() - new Date(kdy).getTime()) / 86400000);
    };
    // Dnes posílá rovnou jen ty uvadající — slibUvada je stejné
    // pravidlo, takže se tu jen dopočítají dny a seřadí.
    return (sliby || [])
      .filter(slibUvada)
      .map(t => ({ ...t, _dni: dni(t) }))
      .sort((a, b) => b._dni - a._dni);
  }, [sliby]);

  const celkem = ticho.length + bezKroku.length + stareSliby.length;
  /* Sliby jsou z úkolů, které Dnes už má — na databázi obchodu
     nečekají. Kdyby se blok schovával, dokud se nenačtou zakázky,
     zmizel by i slib pokaždé, když je příhlášení bez vlastníka,
     spojení leží nebo skript s funkcemi ještě není nasazený.
     To je přesně ten druh ticha, proti kterému tenhle blok je. */
  if (celkem === 0) return null;
  if (!nacteno && stareSliby.length === 0) return null;

  const STROP = 3;
  const vsechno = vic ? Number.MAX_SAFE_INTEGER : STROP;

  const uspi = async (id, dni) => {
    const d = new Date(); d.setDate(d.getDate() + dni);
    const doKdy = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const r = await uspiZakazku(id, doKdy);
    if (r?.ok) {
      setBezKroku(prev => prev.filter(z => z.id !== id));
      setUspavam(null);
      setChyba(null);
    } else {
      setChyba(r?.chyba || "Uspat se nepovedlo.");
    }
  };

  const Radek = ({ nadpis, popis, odznak, barva, onKlik, title }) => (
    <button onClick={onKlik} title={title} aria-label={title}
      style={{
        ...btn(), display: "flex", alignItems: "center", gap: 10,
        width: "100%", textAlign: "left", padding: "9px 10px",
        background: "transparent",
      }}>
      <span aria-hidden="true" style={{
        flex: "0 0 auto", width: 6, height: 6, borderRadius: "50%", background: barva,
      }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: "block", fontSize: "13px", fontWeight: 500, color: theme.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{nadpis}</span>
        <span style={{
          display: "block", fontSize: "11px", color: theme.textSub,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{popis}</span>
      </span>
      <span style={{
        flex: "0 0 auto", fontSize: "11px", fontWeight: 500, color: barva,
      }}>{odznak}</span>
    </button>
  );

  const Skupina = ({ nazev, vysvetleni, polozky, deti }) => {
    if (!polozky.length) return null;
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{
          fontSize: "11px", fontWeight: 700, color: theme.text, marginBottom: 1,
        }}>{nazev} · {polozky.length}</div>
        <div style={{ fontSize: "11px", color: theme.textSub, marginBottom: 4 }}>
          {vysvetleni}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{deti}</div>
      </div>
    );
  };

  return (
    <div role="region" aria-label="Co tiše uvadá" style={{
      border: `1px solid ${theme.cardBorder}`, borderRadius: 12,
      background: theme.card, padding: "12px 14px", marginBottom: 10,
    }}>
      <div style={{
        fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
        textTransform: "uppercase", color: theme.textSub, marginBottom: 9,
      }}>Co tiše uvadá · {celkem}</div>

      <Skupina
        nazev="Oslovil jsi a nic"
        vysvetleni="Buď to doklepni, nebo odepiš."
        polozky={ticho}
        deti={ticho.slice(0, vsechno).map(r => (
          <Radek key={r.id}
            nadpis={r.osoba || "— bez jména —"}
            popis={`${r.kod ? r.kod + " · " : ""}${r.zakazka || ""}`}
            odznak={dnu(r.dni)}
            barva={r.dni >= 30 ? theme.red : theme.yellow}
            title={`Otevřít zakázku ${r.zakazka || ""} — ${r.osoba || ""} mlčí ${dnu(r.dni)}`}
            onKlik={() => onOtevriZakazku?.({ id: r.project_id })} />
        ))} />

      <Skupina
        nazev="Zakázka se nehýbe"
        vysvetleni="Buď ji posuň, nebo ulož ke spícím — ať se vrátí, až na ni bude čas."
        polozky={bezKroku}
        deti={bezKroku.slice(0, vsechno).map(z => {
          /* Dva důvody a každý stačí sám. Který to je, se musí
             napsat — „nehýbe se" bez důvodu je jen nadávka. */
          const duvody = [];
          if (z.visi_ve_fazi) duvody.push(`${dnu(z.ve_fazi_dni)} ve fázi ${z.faze_popis || z.stav}`);
          if (z.bez_kroku) duvody.push("žádný další termín");
          // 1 živý · 2–4 živí · 5 a víc živých
          const lidi = z.zivych_lidi > 0
            ? `${z.zivych_lidi} ${z.zivych_lidi === 1 ? "živý"
                : z.zivych_lidi < 5 ? "živí" : "živých"}`
            : "nikdo oslovený";
          return (
            <div key={z.id}>
              <Radek
                nadpis={z.nazev || z.kod}
                popis={`${lidi} · ${duvody.join(" · ")}`}
                odznak={dnu(z.visi_ve_fazi ? z.ve_fazi_dni : z.dni)}
                barva={theme.orange || theme.yellow}
                title={`Otevřít zakázku ${z.nazev || z.kod} — ${duvody.join(", ")}`}
                onKlik={() => onOtevriZakazku?.({ id: z.id })} />
              {uspavam === z.id ? (
                <div style={{
                  display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center",
                  padding: "2px 10px 8px 26px",
                }}>
                  <span style={{ fontSize: "11px", color: theme.textSub }}>vrátit se k ní</span>
                  {[{ t: "za měsíc", d: 30 }, { t: "za kvartál", d: 90 },
                    { t: "za půl roku", d: 182 }].map(v => (
                    <button key={v.d} onClick={() => uspi(z.id, v.d)}
                      title={`Uspat ${z.nazev || z.kod} — vrátí se ${v.t}`}
                      aria-label={`Uspat ${v.t}`}
                      style={{
                        ...btn(), padding: "5px 10px", fontSize: "11.5px", fontWeight: 700,
                        background: theme.accent, color: "#fff",
                      }}>{v.t}</button>
                  ))}
                  <button onClick={() => { setUspavam(null); setChyba(null); }}
                    title="Zpět" aria-label="Zpět"
                    style={{
                      ...btn(), padding: "5px 9px", fontSize: "11.5px", fontWeight: 500,
                      background: "transparent", color: theme.textSub,
                      border: `1px solid ${theme.cardBorder}`,
                    }}>zpět</button>
                </div>
              ) : (
                <div style={{ padding: "0 10px 6px 26px" }}>
                  <button onClick={() => { setUspavam(z.id); setChyba(null); }}
                    title={`Uspat zakázku ${z.nazev || z.kod} — zmizí z očí do data, které zvolíš`}
                    aria-label={`Uspat zakázku ${z.nazev || z.kod}`}
                    style={{
                      ...btn(), padding: "4px 10px", fontSize: "11px", fontWeight: 500,
                      background: "transparent", color: theme.textSub,
                      border: `1px solid ${theme.cardBorder}`,
                    }}>Uspat</button>
                </div>
              )}
            </div>
          );
        })} />
      {chyba && (
        <div role="alert" style={{ fontSize: "11.5px", color: theme.red, marginBottom: 8 }}>
          {chyba}
        </div>
      )}

      <Skupina
        nazev="Slíbil jsi a nehnulo se"
        vysvetleni="Tohle není úkol, je to dluh vůči člověku."
        polozky={stareSliby}
        deti={stareSliby.slice(0, vsechno).map(t => (
          <Radek key={t.id}
            nadpis={t.title}
            popis={t.osoba || "—"}
            odznak={dnu(t._dni)}
            barva={t._dni >= 30 ? theme.red : theme.yellow}
            title={`Otevřít úkol ${t.title}`}
            onKlik={() => onOtevriUkol?.(t.id)} />
        ))} />

      {!vic && celkem > STROP && (
        <button onClick={() => setVic(true)}
          title="Ukázat všechno, co uvadá" aria-label="Ukázat vše"
          style={{
            ...btn(), padding: "6px 11px", fontSize: "11.5px", fontWeight: 500,
            background: "transparent", color: theme.textSub,
            border: `1px solid ${theme.cardBorder}`,
          }}>Ukázat vše</button>
      )}
    </div>
  );
}
