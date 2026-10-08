/* ═══════════════════════════════════════════════════════
   OBCHOD — síť

   Karty říkají, co kdo zrovna chce nebo co má kolem sebe.
   Jeden člověk jich může mít víc a v opačných směrech:
   kamarád Michal hledá bytové domy a zároveň má kolem sebe
   senior centra. To jsou dvě karty, ne jedna.

   Hledá se tím pádem na obě strany:
     poptávka → komu můžu nabídnout, co mi přišlo
     nabídka  → kdo mi sežene, co někdo shání
   ═══════════════════════════════════════════════════════ */

import { useState, useEffect, useMemo, useRef } from "react";
import {
  hledejLidi, nactiKarty, ulozKartu, smazKartu, ulozRole, zalozOsobu,
  popis, aktivni,
} from "./api.js";
import {
  card, input, btn, btnMain, btnGhost, label,
  penizeKratce, penizePresne, parsePenize,
} from "./ui.js";

export default function Site({ theme, owner, ciselniky }) {
  const [smer, setSmer] = useState("poptavka");
  const [filtrTyp, setFiltrTyp] = useState("");
  const [filtrKraj, setFiltrKraj] = useState("");
  const [hledat, setHledat] = useState("");
  const [karty, setKarty] = useState([]);
  const [busy, setBusy] = useState(true);
  const [obnov, setObnov] = useState(0);
  const [edituji, setEdituji] = useState(null);   // rozpracovaná karta
  const [vybiram, setVybiram] = useState(false);  // výběr člověka pro novou kartu

  useEffect(() => {
    if (!owner) return;
    let zrus = false;
    setBusy(true);
    nactiKarty(owner, { smer, typ: filtrTyp, kraj: filtrKraj }).then(k => {
      if (!zrus) { setKarty(k); setBusy(false); }
    });
    return () => { zrus = true; };
  }, [owner, smer, filtrTyp, filtrKraj, obnov]);

  // Jméno se filtruje až tady, aby psaní nevyvolávalo dotaz za dotazem.
  const videt = useMemo(() => {
    const h = hledat.trim().toLowerCase();
    if (!h) return karty;
    const bez = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return karty.filter(k =>
      bez(k.osoba?.name).includes(bez(h)) ||
      bez(k.nazev).includes(bez(h)) ||
      bez(k.poznamka).includes(bez(h))
    );
  }, [karty, hledat]);

  if (edituji) {
    return (
      <KartaEditor
        theme={theme} owner={owner} ciselniky={ciselniky} karta={edituji}
        onHotovo={() => { setEdituji(null); setObnov(k => k + 1); }}
        onZpet={() => setEdituji(null)}
      />
    );
  }

  return (
    <div style={{ padding: "12px 16px 18px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <Prepinac theme={theme} hodnota={smer} onZmena={setSmer} volby={[
          { k: "poptavka", t: "Kdo co hledá" },
          { k: "nabidka",  t: "Kdo co má" },
        ]} />
        <span style={{ flex: 1 }} />
        <button onClick={() => setVybiram(true)} style={btnMain(theme)}>+ karta</button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <input value={hledat} onChange={e => setHledat(e.target.value)}
          placeholder="Jméno nebo slovo z poznámky…"
          style={{ ...input(theme), flex: "1 1 180px" }} />
        <select value={filtrTyp} onChange={e => setFiltrTyp(e.target.value)}
          style={{ ...input(theme), flex: "0 1 150px", cursor: "pointer" }}>
          <option value="">každý typ</option>
          {aktivni(ciselniky, "typ").map(t => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <select value={filtrKraj} onChange={e => setFiltrKraj(e.target.value)}
          style={{ ...input(theme), flex: "0 1 150px", cursor: "pointer" }}>
          <option value="">každý kraj</option>
          {aktivni(ciselniky, "kraj").map(t => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>

      {vybiram && (
        <VyberOsoby theme={theme} owner={owner}
          onVyber={(osoba) => {
            setVybiram(false);
            setEdituji({ person_id: osoba.id, osoba, smer, typy: [], kraje: [], aktivni: true });
          }}
          onZrus={() => setVybiram(false)} />
      )}

      {busy && videt.length === 0 && <Info theme={theme}>Načítám…</Info>}

      {!busy && videt.length === 0 && (
        <Info theme={theme}>
          {smer === "poptavka"
            ? "Zatím tu není nikdo, kdo by něco hledal. Tlačítkem nahoře přidej první kartu — třeba Martinovi, že shání retail parky."
            : "Zatím tu není nikdo, kdo by něco nabízel. Sem patří lidé, kteří kolem sebe mají projekty — typicky prostředníci."}
        </Info>
      )}

      {videt.map(k => (
        <KartaRadek key={k.id} k={k} theme={theme} ciselniky={ciselniky}
          onOpen={() => setEdituji(k)} />
      ))}

      {filtrKraj && smer === "poptavka" && videt.length > 0 && (
        <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 8, lineHeight: 1.6 }}>
          Karty bez vyplněného kraje se tu nezobrazují, i když berou cokoli.
          Při párování konkrétní zakázky se naopak počítají.
        </div>
      )}
    </div>
  );
}

/* ── Řádek karty ───────────────────────────────────── */

function KartaRadek({ k, theme, ciselniky, onOpen }) {
  const typy = (k.typy || []).map(t => popis(ciselniky, "typ", t));
  const kraje = (k.kraje || []).map(t => popis(ciselniky, "kraj", t));
  const rozsah = [
    k.cena_od ? `od ${penizeKratce(k.cena_od)}` : "",
    k.cena_do ? `do ${penizeKratce(k.cena_do)}` : "",
  ].filter(Boolean).join(" ");
  const propadla = k.plati_do && new Date(k.plati_do) < new Date();

  return (
    <div onClick={onOpen} style={{
      ...card(theme), padding: "10px 12px", marginBottom: 7, cursor: "pointer",
      opacity: k.aktivni && !propadla ? 1 : 0.5,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: theme.text }}>
          {k.osoba?.name || "—"}
        </div>
        {k.nazev && (
          <div style={{ fontSize: "11px", color: theme.textSub }}>{k.nazev}</div>
        )}
        {k.pro_koho === "klienti" && (
          <Znacka theme={theme} barva={theme.purple}>pro klienty</Znacka>
        )}
        {(!k.aktivni || propadla) && (
          <Znacka theme={theme} barva={theme.textSub}>
            {propadla ? "propadlá" : "vypnutá"}
          </Znacka>
        )}
      </div>

      <div style={{ fontSize: "11.5px", color: theme.textSub, marginTop: 3, lineHeight: 1.6 }}>
        {typy.length ? typy.join(", ") : "jakýkoli typ"}
        {" · "}
        {kraje.length ? kraje.join(", ") : "kdekoli"}
        {rozsah && ` · ${rozsah}`}
        {k.velikost_od ? ` · od ${k.velikost_od} ${popis(ciselniky, "jednotka", k.jednotka)}` : ""}
        {k.faze_min ? ` · nejméně ${popis(ciselniky, "faze", k.faze_min)}` : ""}
      </div>

      {k.poznamka && (
        <div style={{ fontSize: "11.5px", color: theme.textMid, marginTop: 3 }}>
          {k.poznamka}
        </div>
      )}
    </div>
  );
}

function Znacka({ theme, barva, children }) {
  return (
    <span style={{
      fontSize: "9.5px", fontWeight: 700, textTransform: "uppercase",
      letterSpacing: "0.04em", color: barva || theme.textSub,
      border: `1px solid ${barva || theme.cardBorder}44`,
      borderRadius: 5, padding: "1px 5px",
    }}>{children}</span>
  );
}

function Info({ theme, children }) {
  return (
    <div style={{
      ...card(theme), padding: "20px 16px", textAlign: "center",
      color: theme.textSub, fontSize: "12px", lineHeight: 1.7,
    }}>{children}</div>
  );
}

function Prepinac({ theme, hodnota, onZmena, volby }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {volby.map(v => {
        const zap = hodnota === v.k;
        return (
          <button key={v.k} onClick={() => onZmena(v.k)} style={{
            ...btnGhost(theme),
            background: zap ? theme.accentSoft : "transparent",
            color: zap ? theme.accent : theme.textSub,
            borderColor: zap ? theme.accentBorder : theme.cardBorder,
            fontWeight: zap ? 700 : 600,
          }}>{v.t}</button>
        );
      })}
    </div>
  );
}

/* ── Výběr člověka ─────────────────────────────────────
   Hledá v Mapě. Karta se dá přivěsit jen k někomu, kdo
   už v Mapě je — nový člověk se zakládá tam, aby nevznikaly
   dvě různé evidence lidí. */

export function VyberOsoby({ theme, owner, onVyber, onZrus }) {
  const [q, setQ] = useState("");
  const [lidi, setLidi] = useState([]);
  const [busy, setBusy] = useState(false);
  const [zakladam, setZakladam] = useState(false);
  const [kontakt, setKontakt] = useState("");
  const [chyba, setChyba] = useState(null);
  const ref = useRef(null);

  useEffect(() => { setTimeout(() => ref.current?.focus(), 60); }, []);

  useEffect(() => {
    let zrus = false;
    setBusy(true);
    const id = setTimeout(async () => {
      const r = await hledejLidi(owner, q, 12);
      if (!zrus) { setLidi(r); setBusy(false); }
    }, q ? 250 : 0);
    return () => { zrus = true; clearTimeout(id); };
  }, [owner, q]);

  // Nového člověka založíme rovnou tady. Dřív se muselo odskočit
  // do Mapy a vrátit se — uprostřed zadávání zakázky je to otrava.
  const zaloz = async () => {
    setChyba(null);
    const res = await zalozOsobu(owner, q, kontakt);
    if (!res.ok) { setChyba(res.chyba); return; }
    onVyber(res.osoba);
  };

  const presnaShoda = lidi.some(
    o => o.name.trim().toLowerCase() === q.trim().toLowerCase()
  );
  const lzeZalozit = q.trim().length >= 2 && !presnaShoda;

  return (
    <div style={{ ...card(theme), padding: "10px 12px", marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input ref={ref} value={q}
          onChange={e => { setQ(e.target.value); setChyba(null); }}
          onKeyDown={e => {
            if (e.key === "Enter" && lzeZalozit && zakladam) zaloz();
            if (e.key === "Enter" && lidi.length === 1 && !zakladam) onVyber(lidi[0]);
          }}
          placeholder="Koho hledáš? Piš jméno…"
          style={{ ...input(theme), flex: 1 }} />
        <button onClick={onZrus} style={btnGhost(theme)}>zrušit</button>
      </div>

      {busy && lidi.length === 0 && (
        <div style={{ fontSize: "11px", color: theme.textSub }}>hledám…</div>
      )}

      {lidi.map(o => (
        <div key={o.id} onClick={() => onVyber(o)} style={{
          padding: "7px 8px", cursor: "pointer", borderRadius: 7,
          display: "flex", alignItems: "baseline", gap: 7,
        }}>
          <span style={{ fontSize: "13px", fontWeight: 700, color: theme.text }}>{o.name}</span>
          {o.contact && (
            <span style={{ fontSize: "11px", color: theme.textSub }}>{o.contact}</span>
          )}
          {o.met_at && (
            <span style={{ fontSize: "11px", color: theme.textMid }}>{o.met_at}</span>
          )}
        </div>
      ))}

      {chyba && (
        <div style={{ fontSize: "11.5px", color: theme.red, margin: "6px 2px" }}>{chyba}</div>
      )}

      {lzeZalozit && !zakladam && (
        <button onClick={() => setZakladam(true)} style={{
          ...btnGhost(theme), marginTop: 6,
          color: theme.accent, borderColor: theme.accentBorder,
        }}>+ založit „{q.trim()}“ jako nového</button>
      )}

      {zakladam && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${theme.cardBorder}`, paddingTop: 8 }}>
          <div style={{ fontSize: "11.5px", color: theme.textSub, marginBottom: 6 }}>
            Zakládám <strong style={{ color: theme.text }}>{q.trim()}</strong>.
            Přibude i do Mapy, takže ho příště najdeš i tam.
          </div>
          <input value={kontakt} onChange={e => setKontakt(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") zaloz(); }}
            placeholder="Telefon, mail nebo firma — nepovinné"
            style={{ ...input(theme), marginBottom: 7 }} />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={zaloz} style={btnMain(theme)}>ZALOŽIT A POUŽÍT</button>
            <button onClick={() => { setZakladam(false); setChyba(null); }}
              style={btnGhost(theme)}>zpět</button>
          </div>
        </div>
      )}

      {!busy && lidi.length === 0 && !q.trim() && (
        <div style={{ fontSize: "11.5px", color: theme.textSub, lineHeight: 1.6 }}>
          Začni psát jméno. Koho nenajdeš, můžeš rovnou založit.
        </div>
      )}
    </div>
  );
}

/* ── Editor karty ──────────────────────────────────── */

function KartaEditor({ theme, owner, ciselniky, karta, onHotovo, onZpet }) {
  const [f, setF] = useState(() => {
    const z = {
      smer: "poptavka", nazev: "", typy: [], kraje: [],
      cena_od: "", cena_do: "", velikost_od: "", jednotka: "byt",
      faze_min: "", pro_koho: "sam", poznamka: "", plati_do: "", aktivni: true,
      ...karta,
    };
    // Ceny se v polích ukazují po tisících, datum musí být YYYY-MM-DD.
    z.cena_od = karta.cena_od ? penizePresne(karta.cena_od) : "";
    z.cena_do = karta.cena_do ? penizePresne(karta.cena_do) : "";
    z.plati_do = karta.plati_do || "";
    return z;
  });
  const [role, setRole] = useState(karta.osoba?.role_tagy || []);
  const [uklada, setUklada] = useState(false);
  const [chyba, setChyba] = useState(null);
  const [mazu, setMazu] = useState(false);
  const [ptamSe, setPtamSe] = useState(false);

  const prepni = (klic, hodnota) => {
    setF(p => {
      const pole = p[klic] || [];
      return {
        ...p,
        [klic]: pole.includes(hodnota)
          ? pole.filter(x => x !== hodnota)
          : [...pole, hodnota],
      };
    });
  };

  const uprav = (k, v) => { setF(p => ({ ...p, [k]: v })); setChyba(null); };

  const uloz = async () => {
    setUklada(true); setChyba(null);
    const res = await ulozKartu(owner, {
      ...f,
      cena_od: parsePenize(f.cena_od),
      cena_do: parsePenize(f.cena_do),
    });
    if (res.ok && karta.person_id) await ulozRole(karta.person_id, role);
    setUklada(false);
    if (!res.ok) { setChyba(res.chyba); return; }
    onHotovo();
  };

  const smaz = async () => {
    if (!f.id) { onZpet(); return; }
    setMazu(true);
    const res = await smazKartu(f.id);
    setMazu(false);
    if (res.ok) onHotovo();
    else setChyba(res.chyba);
  };

  const jmeno = karta.osoba?.name || "";

  return (
    <div style={{ padding: "12px 16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={onZpet} style={{
          ...btn(), background: "transparent", color: theme.textSub,
          fontSize: "15px", padding: "2px 6px",
        }}>←</button>
        <div style={{ fontSize: "14px", fontWeight: 700, color: theme.text }}>{jmeno}</div>
      </div>

      {/* Profilové role — čím je obecně, napříč zakázkami */}
      <div style={{ marginBottom: 12 }}>
        <span style={label(theme)}>Čím ti je — obecně</span>
        <Chipy theme={theme} polozky={aktivni(ciselniky, "role")}
          vybrano={role}
          onPrepni={(k) => setRole(r => r.includes(k) ? r.filter(x => x !== k) : [...r, k])} />
      </div>

      <div style={{ height: 1, background: theme.cardBorder, margin: "14px 0" }} />

      <div style={{ marginBottom: 11 }}>
        <span style={label(theme)}>Směr</span>
        <Prepinac theme={theme} hodnota={f.smer} onZmena={v => uprav("smer", v)} volby={[
          { k: "poptavka", t: "Hledá" },
          { k: "nabidka",  t: "Má kolem sebe" },
        ]} />
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 9, marginBottom: 11,
      }}>
        <div>
          <span style={label(theme)}>Název karty</span>
          <input value={f.nazev || ""} onChange={e => uprav("nazev", e.target.value)}
            placeholder="sám pro sebe / pro své investory" style={input(theme)} />
        </div>
        <div>
          <span style={label(theme)}>Pro koho</span>
          <select value={f.pro_koho || "sam"} onChange={e => uprav("pro_koho", e.target.value)}
            style={{ ...input(theme), cursor: "pointer" }}>
            <option value="sam">sám pro sebe</option>
            <option value="klienti">pro své klienty</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 11 }}>
        <span style={label(theme)}>Typy — nevybrané znamená jakýkoli</span>
        <Chipy theme={theme} polozky={aktivni(ciselniky, "typ")}
          vybrano={f.typy} onPrepni={k => prepni("typy", k)} />
      </div>

      <div style={{ marginBottom: 11 }}>
        <span style={label(theme)}>Kraje — nevybrané znamená kdekoli</span>
        <Chipy theme={theme} polozky={aktivni(ciselniky, "kraj")} skupiny
          vybrano={f.kraje} onPrepni={k => prepni("kraje", k)} />
      </div>

      {f.smer === "poptavka" && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 9, marginBottom: 11,
        }}>
          <div>
            <span style={label(theme)}>Cena od</span>
            <input value={f.cena_od} onChange={e => uprav("cena_od", e.target.value)}
              placeholder="50 mil" style={input(theme)} />
          </div>
          <div>
            <span style={label(theme)}>Cena do</span>
            <input value={f.cena_do} onChange={e => uprav("cena_do", e.target.value)}
              placeholder="100 mil" style={input(theme)} />
          </div>
          <div>
            <span style={label(theme)}>Velikost nejméně</span>
            <div style={{ display: "flex", gap: 5 }}>
              <input value={f.velikost_od ?? ""} onChange={e => uprav("velikost_od", e.target.value)}
                placeholder="100" style={{ ...input(theme), flex: 1 }} />
              <select value={f.jednotka || "byt"} onChange={e => uprav("jednotka", e.target.value)}
                style={{ ...input(theme), width: 80, cursor: "pointer" }}>
                {aktivni(ciselniky, "jednotka").map(j => (
                  <option key={j.key} value={j.key}>{j.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <span style={label(theme)}>Nejméně fáze</span>
            <select value={f.faze_min || ""} onChange={e => uprav("faze_min", e.target.value)}
              style={{ ...input(theme), cursor: "pointer" }}>
              <option value="">nerozhoduje</option>
              {aktivni(ciselniky, "faze").map(t => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 11 }}>
        <span style={label(theme)}>Poznámka vlastními slovy</span>
        <textarea value={f.poznamka || ""} onChange={e => uprav("poznamka", e.target.value)}
          rows={3} placeholder="Co přesně hledá, na čem mu záleží, s kým to řeší."
          style={{ ...input(theme), resize: "vertical", lineHeight: 1.6 }} />
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 9, marginBottom: 14,
      }}>
        <div>
          <span style={label(theme)}>Platí do</span>
          <input type="date" value={f.plati_do || ""} onChange={e => uprav("plati_do", e.target.value)}
            style={{ ...input(theme), cursor: "pointer" }} />
          <div style={{ fontSize: "10.5px", color: theme.textSub, marginTop: 3, lineHeight: 1.5 }}>
            Prázdné znamená, že platí dál. Vyplň, když víš, že to shání jen teď.
          </div>
        </div>
        <div>
          <span style={label(theme)}>Zapnutá</span>
          <button onClick={() => uprav("aktivni", !f.aktivni)} style={{
            ...btnGhost(theme), width: "100%", padding: "8px",
            background: f.aktivni ? theme.accentSoft : "transparent",
            color: f.aktivni ? theme.accent : theme.textSub,
            borderColor: f.aktivni ? theme.accentBorder : theme.cardBorder,
          }}>{f.aktivni ? "ano, počítá se při párování" : "ne, do párování nevstupuje"}</button>
        </div>
      </div>

      {chyba && (
        <div style={{
          background: `${theme.red}18`, border: `1px solid ${theme.red}44`,
          borderRadius: 8, padding: "8px 11px", fontSize: "12px",
          color: theme.red, marginBottom: 10,
        }}>{chyba}</div>
      )}

      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
        <button onClick={uloz} disabled={uklada} style={{
          ...btnMain(theme), opacity: uklada ? 0.6 : 1,
        }}>{uklada ? "UKLÁDÁM…" : "ULOŽIT"}</button>
        <button onClick={onZpet} style={btnGhost(theme)}>zpět</button>
        <span style={{ flex: 1 }} />
        {f.id && !ptamSe && (
          <button onClick={() => setPtamSe(true)} style={{
            ...btnGhost(theme), color: theme.red, borderColor: `${theme.red}44`,
          }}>🗑 smazat</button>
        )}
        {f.id && ptamSe && (
          <>
            <span style={{ fontSize: "11px", color: theme.textSub }}>Opravdu?</span>
            <button onClick={smaz} disabled={mazu} style={{
              ...btnMain(theme), background: theme.red, opacity: mazu ? 0.6 : 1,
            }}>{mazu ? "MAŽU…" : "ANO"}</button>
            <button onClick={() => setPtamSe(false)} style={btnGhost(theme)}>Ne</button>
          </>
        )}
      </div>
    </div>
  );
}

/* Přepínatelné štítky. Proti rozbalovacímu seznamu je výhoda,
   že je na jeden pohled vidět, co je vybrané. */
function Chipy({ theme, polozky, vybrano = [], onPrepni, skupiny = false }) {
  const skupinky = useMemo(() => {
    if (!skupiny) return [[null, polozky]];
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
      {skupinky.map(([g, items]) => (
        <div key={g || "vse"} style={{ marginBottom: g ? 6 : 0 }}>
          {g && (
            <div style={{ fontSize: "10px", color: theme.textMid, marginBottom: 3 }}>{g}</div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {items.map(p => {
              const zap = vybrano.includes(p.key);
              return (
                <button key={p.key} onClick={() => onPrepni(p.key)} style={{
                  ...btn(),
                  background: zap ? theme.accentSoft : "transparent",
                  border: `1px solid ${zap ? theme.accentBorder : theme.cardBorder}`,
                  color: zap ? theme.accent : theme.textSub,
                  fontSize: "11.5px", padding: "4px 9px", borderRadius: 14,
                  fontWeight: zap ? 700 : 600,
                }}>{p.label}</button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
