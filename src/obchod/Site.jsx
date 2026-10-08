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
  hledejLidi, nactiLidi, nactiKarty, ulozKartu, smazKartu, zalozOsobu, ulozOsobu,
  nactiCiselniky, popis, aktivni,
} from "./api.js";
import {
  card, input, btn, btnMain, btnGhost, label,
  penizeKratce, penizePresne, parsePenize,
} from "./ui.js";

export default function Site({ theme, owner, ciselniky, onOtevriOsobu }) {
  const [smer, setSmer] = useState("poptavka");   // poptavka | nabidka | lide
  const [filtrTyp, setFiltrTyp] = useState("");
  const [filtrKraj, setFiltrKraj] = useState("");
  const [hledat, setHledat] = useState("");
  const [karty, setKarty] = useState([]);
  const [busy, setBusy] = useState(true);
  const [obnov, setObnov] = useState(0);
  const [edituji, setEdituji] = useState(null);   // rozpracovaná karta
  const [vybiram, setVybiram] = useState(false);  // výběr člověka pro novou kartu

  useEffect(() => {
    if (!owner || smer === "lide") return;
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
          { k: "lide",     t: "Kontakty" },
        ]} />
        <span style={{ flex: 1 }} />
        {smer !== "lide" && (
          <button onClick={() => setVybiram(true)} style={btnMain(theme)}>+ karta</button>
        )}
      </div>

      {smer === "lide" && (
        <Kontakty theme={theme} owner={owner} ciselniky={ciselniky}
          onOtevri={onOtevriOsobu} />
      )}

      {smer !== "lide" && (
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
      )}

      {vybiram && (
        <VyberOsoby theme={theme} owner={owner} ciselniky={ciselniky}
          onVyber={(osoba) => {
            setVybiram(false);
            setEdituji({ person_id: osoba.id, osoba, smer, typy: [], kraje: [], aktivni: true });
          }}
          onZrus={() => setVybiram(false)} />
      )}

      {smer !== "lide" && busy && videt.length === 0 && <Info theme={theme}>Načítám…</Info>}

      {smer !== "lide" && !busy && videt.length === 0 && (
        <Info theme={theme}>
          {smer === "poptavka"
            ? "Zatím tu není nikdo, kdo by něco hledal. Tlačítkem nahoře přidej první kartu — třeba Martinovi, že shání retail parky."
            : "Zatím tu není nikdo, kdo by něco nabízel. Sem patří lidé, kteří kolem sebe mají projekty — typicky prostředníci."}
        </Info>
      )}

      {smer !== "lide" && videt.map(k => (
        <KartaRadek key={k.id} k={k} theme={theme} ciselniky={ciselniky}
          onOpen={() => setEdituji(k)}
          onOpenOsoba={() => onOtevriOsobu?.(k.person_id)} />
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

function KartaRadek({ k, theme, ciselniky, onOpen, onOpenOsoba }) {
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
        <div onClick={(e) => { e.stopPropagation(); onOpenOsoba?.(); }}
          title="Ukázat všechno, co s ním běží"
          style={{ fontSize: "13px", fontWeight: 700, color: theme.accent, cursor: "pointer" }}>
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

export function VyberOsoby({ theme, owner, ciselniky, onVyber, onZrus }) {
  const [q, setQ] = useState("");
  const [lidi, setLidi] = useState([]);
  const [busy, setBusy] = useState(false);
  const [zakladam, setZakladam] = useState(false);
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

  // Nového člověka založíme rovnou tady, a to celého včetně rolí.
  // Dřív se musel odskočit do Mapy a role doplnit až v Síti.
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
            if (e.key === "Enter" && lidi.length === 1 && !zakladam) onVyber(lidi[0]);
            else if (e.key === "Enter" && lzeZalozit && !zakladam) setZakladam(true);
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
          <KontaktEditor theme={theme} owner={owner} ciselniky={ciselniky}
            predvyplnenoJmeno={q.trim()}
            onHotovo={(o) => onVyber(o)}
            onZrus={() => { setZakladam(false); setChyba(null); }} />
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

/* ════════════════════════════════════════════════════════
   EDITOR KONTAKTU — jeden pro celou aplikaci

   Dřív byly tři: jeden v Síti (jméno, kontakt, role), druhý ve
   výběru u zakázky (jméno a kontakt, role nikde) a třetí v Mapě
   (jméno, kde jsi ho poznal, přezdívky, poznámka, role nikde).
   Podle toho, kterým oknem jsi šel, se dalo vyplnit něco jiného.

   Tohle je ten jediný. Pole jsou všude stejná a ukládá je stejná
   funkce. `extra` je místo pro tlačítka, která patří jen jednomu
   oknu — mazání a slučování v Mapě.
   ════════════════════════════════════════════════════════ */

export function KontaktEditor({ theme, owner, ciselniky: ciselnikyProp, osoba = null,
  predvyplnenoJmeno = "", onHotovo, onZrus, extra = null, autoFocus = true }) {
  const novy = !osoba?.id;
  // Číselníky si umí načíst sám. Karta v Mapě o nich nic neví,
  // a bez nich by chyběly role — přesně ta věc, která tam chyběla dřív.
  const [vlastniC, setVlastniC] = useState({});
  const ciselniky = ciselnikyProp && Object.keys(ciselnikyProp).length
    ? ciselnikyProp : vlastniC;
  useEffect(() => {
    if (ciselnikyProp && Object.keys(ciselnikyProp).length) return;
    if (!owner) return;
    let zrus = false;
    nactiCiselniky(owner).then(c => { if (!zrus) setVlastniC(c); });
    return () => { zrus = true; };
  }, [owner, ciselnikyProp]);
  const [f, setF] = useState(() => ({
    name: osoba?.name || predvyplnenoJmeno || "",
    contact: osoba?.contact || "",
    met_at: osoba?.met_at || "",
    note: osoba?.note || "",
    aliases: Array.isArray(osoba?.aliases) ? osoba.aliases.join(", ") : (osoba?.aliases || ""),
    role_tagy: osoba?.role_tagy || [],
  }));
  const [chyba, setChyba] = useState(null);
  const [uklada, setUklada] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (autoFocus) setTimeout(() => ref.current?.focus(), 60);
  }, [autoFocus]);

  const uprav = (k, v) => { setF(p => ({ ...p, [k]: v })); setChyba(null); };
  const prepniRoli = (k) => setF(p => ({
    ...p,
    role_tagy: p.role_tagy.includes(k)
      ? p.role_tagy.filter(x => x !== k)
      : [...p.role_tagy, k],
  }));

  const uloz = async () => {
    setUklada(true); setChyba(null);
    const res = novy ? await zalozOsobu(owner, f) : await ulozOsobu(osoba.id, f);
    setUklada(false);
    if (!res.ok) { setChyba(res.chyba); return; }
    onHotovo?.(res.osoba);
  };

  const naEnter = (e) => { if (e.key === "Enter") uloz(); };

  return (
    <div style={{ ...card(theme), padding: "11px 12px", marginBottom: 10 }}>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 7, marginBottom: 7,
      }}>
        <div>
          <span style={label(theme)}>Jméno</span>
          <input ref={ref} value={f.name} onChange={e => uprav("name", e.target.value)}
            onKeyDown={naEnter} placeholder="Jméno a příjmení"
            style={{ ...input(theme), fontWeight: 700 }} />
        </div>
        <div>
          <span style={label(theme)}>Kontakt</span>
          <input value={f.contact} onChange={e => uprav("contact", e.target.value)}
            onKeyDown={naEnter} placeholder="Telefon, mail, firma" style={input(theme)} />
        </div>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 7, marginBottom: 8,
      }}>
        <div>
          <span style={label(theme)}>Kde jsi ho poznal</span>
          <input value={f.met_at} onChange={e => uprav("met_at", e.target.value)}
            onKeyDown={naEnter} placeholder="Golf v Berouně, konference" style={input(theme)} />
        </div>
        <div>
          <span style={label(theme)}>Přezdívky</span>
          <input value={f.aliases} onChange={e => uprav("aliases", e.target.value)}
            onKeyDown={naEnter} placeholder="Peťa, Petr od aut — oddělené čárkou"
            style={input(theme)} />
        </div>
      </div>

      {/* Role tady, ne až někde jinde. Tohle je ta databáze investorů:
          označíš "investor" a máš ho v Síti pod filtrem. */}
      <div style={{ marginBottom: 8 }}>
        <span style={label(theme)}>Čím ti je</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {aktivni(ciselniky, "role").map(r => {
            const zap = f.role_tagy.includes(r.key);
            return (
              <button key={r.key} type="button" onClick={() => prepniRoli(r.key)} style={{
                ...btn(),
                background: zap ? theme.accentSoft : "transparent",
                border: `1px solid ${zap ? theme.accentBorder : theme.cardBorder}`,
                color: zap ? theme.accent : theme.textSub,
                fontSize: "11.5px", padding: "4px 9px", borderRadius: 14,
                fontWeight: zap ? 700 : 600,
              }}>{r.label}</button>
            );
          })}
          {aktivni(ciselniky, "role").length === 0 && (
            <span style={{ fontSize: "11px", color: theme.textSub }}>
              Role se zakládají v nastavení → Seznamy.
            </span>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <span style={label(theme)}>Poznámka</span>
        <input value={f.note} onChange={e => uprav("note", e.target.value)}
          onKeyDown={naEnter} placeholder="Co je o něm dobré vědět" style={input(theme)} />
      </div>

      {chyba && (
        <div style={{ fontSize: "11.5px", color: theme.red, marginBottom: 7 }}>{chyba}</div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={uloz} disabled={!f.name.trim() || uklada} style={{
          ...btnMain(theme), opacity: f.name.trim() && !uklada ? 1 : 0.5,
        }}>{uklada ? "UKLÁDÁM…" : novy ? "ZALOŽIT" : "ULOŽIT"}</button>
        {onZrus && <button onClick={onZrus} style={btnGhost(theme)}>zrušit</button>}
        {extra}
      </div>
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
    if (res.ok && karta.person_id) await ulozOsobu(karta.person_id, { role_tagy: role });
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

/* ── Kontakty ──────────────────────────────────────────
   Celý seznam lidí, ne jen výsledek hledání. Tohle je obrazovka,
   u které sedíš s telefonem a přepisuješ kontakty — proto je vidět
   všechno a filtruje se jedním kliknutím podle role.

   Hledá se i podle telefonu a podle toho, co máš u člověka zapsané. */

function Kontakty({ theme, owner, ciselniky, onOtevri }) {
  const [role, setRole] = useState("");
  const [hledat, setHledat] = useState("");
  const [lidi, setLidi] = useState([]);
  const [busy, setBusy] = useState(true);
  const [obnov, setObnov] = useState(0);
  const [zakladam, setZakladam] = useState(false);
  const [upravuji, setUpravuji] = useState(null);   // kterého člověka edituju
  const ref = useRef(null);

  useEffect(() => {
    let zrus = false;
    setBusy(true);
    const id = setTimeout(async () => {
      const r = await nactiLidi(owner, {
        role: role === "bez" ? "" : role,
        bezRole: role === "bez",
        hledat,
      });
      if (!zrus) { setLidi(r); setBusy(false); }
    }, hledat ? 250 : 0);
    return () => { zrus = true; clearTimeout(id); };
  }, [owner, role, hledat, obnov]);

  const role_volby = [
    { k: "",    t: "Všichni" },
    ...aktivni(ciselniky, "role").map(r => ({ k: r.key, t: r.label })),
    { k: "bez", t: "Bez role" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 9 }}>
        <input ref={ref} value={hledat} onChange={e => setHledat(e.target.value)}
          placeholder="Jméno, telefon, nebo co o něm víš…"
          style={{ ...input(theme), flex: 1 }} />
        <button onClick={() => setZakladam(v => !v)} style={btnMain(theme)}>
          {zakladam ? "zavřít" : "+ člověk"}
        </button>
      </div>

      {zakladam && (
        <KontaktEditor theme={theme} owner={owner} ciselniky={ciselniky}
          onHotovo={() => { setZakladam(false); setObnov(k => k + 1); }}
          onZrus={() => setZakladam(false)} />
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
        {role_volby.map(v => {
          const zap = role === v.k;
          return (
            <button key={v.k || "vse"} onClick={() => setRole(v.k)} style={{
              ...btn(),
              background: zap ? theme.accentSoft : "transparent",
              border: `1px solid ${zap ? theme.accentBorder : theme.cardBorder}`,
              color: zap ? theme.accent : theme.textSub,
              fontSize: "11.5px", padding: "4px 10px", borderRadius: 14,
              fontWeight: zap ? 700 : 600,
            }}>{v.t}</button>
          );
        })}
      </div>

      {busy && lidi.length === 0 && <Info theme={theme}>Načítám…</Info>}

      {!busy && lidi.length === 0 && (
        <Info theme={theme}>
          {hledat.trim() || role
            ? "Nikdo takový. Zkus jiný filtr nebo část čísla."
            : "Zatím tu nikdo není. Tlačítkem nahoře přidej prvního — klidně jen jméno a telefon, zbytek doplníš později."}
        </Info>
      )}

      {lidi.length > 0 && (
        <div style={{ fontSize: "11px", color: theme.textSub, marginBottom: 6 }}>
          {lidi.length === 1 ? "1 člověk" : lidi.length < 5 ? `${lidi.length} lidé` : `${lidi.length} lidí`}
        </div>
      )}

      {lidi.map(o => (
        upravuji === o.id ? (
          <KontaktEditor key={o.id} theme={theme} owner={owner} ciselniky={ciselniky}
            osoba={o}
            onHotovo={() => { setUpravuji(null); setObnov(k => k + 1); }}
            onZrus={() => setUpravuji(null)} />
        ) : (
        <div key={o.id} onClick={() => onOtevri?.(o.id)} style={{
          ...card(theme), padding: "9px 11px", marginBottom: 6, cursor: "pointer",
          display: "flex", alignItems: "flex-start", gap: 8,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: theme.text }}>{o.name}</span>
              {o.contact && (
                <span style={{ fontSize: "11.5px", color: theme.textSub }}>{o.contact}</span>
              )}
              <span style={{ flex: 1 }} />
              {(o.role_tagy || []).map(r => (
                <Znacka key={r} theme={theme}>{popis(ciselniky, "role", r)}</Znacka>
              ))}
            </div>
            {(o.met_at || o.note) && (
              <div style={{ fontSize: "11px", color: theme.textMid, marginTop: 2 }}>
                {[o.met_at, o.note].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <button onClick={(e) => { e.stopPropagation(); setUpravuji(o.id); }}
            title="Upravit kontakt" style={{
              ...btn(), background: "transparent", color: theme.textSub,
              fontSize: "12px", padding: "2px 5px",
            }}>✎</button>
        </div>
        )
      ))}
    </div>
  );
}

