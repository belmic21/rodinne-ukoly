/* ═══════════════════════════════════════════════════════
   OBCHOD — dvě sekce v detailu zakázky

   Řetězec — kdo je na zakázce napojený a komu co patří.
   Geneze  — koho jsem oslovil a jak to dopadlo.

   Schválně oddělené. První odpovídá na otázku "kdo na tom
   je", druhá na "koho jsem zkoušel". Vítěz z druhé se
   obvykle objeví i v první, ale není to totéž.
   ═══════════════════════════════════════════════════════ */

import { useState, useEffect, useMemo } from "react";
import {
  nactiUcastniky, ulozUcastnika, smazUcastnika,
  nactiOsloveni, oslovHromadne, ulozOsloveni, smazOsloveni,
  komuToPasuje, nactiKarty, popis, aktivni,
} from "./api.js";
import { VyberOsoby } from "./Site.jsx";
import {
  card, input, btn, btnMain, btnGhost, label,
  penizeKratce, penizePresne, parsePenize, datumKratce, jakDavno,
} from "./ui.js";

/* ════════════════════════════════════════════════════════
   ŘETĚZEC
   ════════════════════════════════════════════════════════ */

/* `spravce` = přihlášený je správce. Smí měnit i cizí řádky.
   Jinak platí: co jsem zapsal já, měním já. Cizí řádek vidím,
   ale needituji — proto se u něj tužka vůbec nezobrazí. */
export function Retezec({ theme, owner, ciselniky, projectId, onOtevriOsobu, spravce = false }) {
  const [lide, setLide] = useState([]);
  const [busy, setBusy] = useState(true);
  const [pridavam, setPridavam] = useState(false);
  const [edituji, setEdituji] = useState(null);
  const [chyba, setChyba] = useState(null);

  const nacti = async () => {
    setBusy(true);
    setLide(await nactiUcastniky(projectId));
    setBusy(false);
  };
  useEffect(() => { if (projectId) nacti(); }, [projectId]);  // eslint-disable-line

  const soucet = useMemo(
    () => lide.reduce((s, u) => s + (Number(u.podil) || 0), 0),
    [lide]
  );

  const ulozit = async (data) => {
    setChyba(null);
    const res = await ulozUcastnika(owner, { ...data, project_id: projectId });
    if (!res.ok) { setChyba(res.chyba); return; }
    setEdituji(null); setPridavam(false);
    nacti();
  };

  const smazat = async (id) => {
    const res = await smazUcastnika(id);
    if (!res.ok) { setChyba(res.chyba); return; }
    nacti();
  };

  return (
    <Sekce theme={theme} nadpis="Kdo je na tom napojený"
      akce={
        <button onClick={() => setPridavam(true)} style={btnGhost(theme)}>+ člověk</button>
      }>
      {pridavam && (
        <VyberOsoby theme={theme} owner={owner}
          onZrus={() => setPridavam(false)}
          onVyber={(o) => {
            setPridavam(false);
            setEdituji({ person_id: o.id, osoba: o, role: "prostrednik", poradi: lide.length + 1 });
          }} />
      )}

      {edituji && (
        <UcastnikEditor theme={theme} ciselniky={ciselniky} u={edituji}
          onUloz={ulozit} onZrus={() => setEdituji(null)} />
      )}

      {chyba && <Chyba theme={theme}>{chyba}</Chyba>}

      {busy && lide.length === 0 && <Tise theme={theme}>Načítám…</Tise>}

      {!busy && lide.length === 0 && !pridavam && !edituji && (
        <Tise theme={theme}>
          Zatím nikdo. Sem patří, kdo ti zakázku přinesl a kdo si na ní
          dělá nárok — za rok už si to nevybavíš.
        </Tise>
      )}

      {lide.map(u => (
        <div key={u.id} style={{
          ...card(theme), padding: "8px 11px", marginBottom: 6,
          display: "flex", alignItems: "center", gap: 9,
        }}>
          <div style={{
            fontSize: "11px", fontWeight: 700, color: theme.textDim,
            minWidth: 14, textAlign: "center",
          }}>{u.poradi}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "12.5px", fontWeight: 700 }}>
              <span onClick={() => onOtevriOsobu?.(u.person_id)}
                title="Ukázat všechno, co s ním běží"
                style={{ color: theme.accent, cursor: "pointer" }}>
                {u.osoba?.name || "—"}
              </span>
              <span style={{ fontWeight: 400, color: theme.textSub, fontSize: "11px" }}>
                {" "}· {popis(ciselniky, "role", u.role)}
              </span>
            </div>
            <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 1 }}>
              {u.forma_dohody
                ? popis(ciselniky, "forma_dohody", u.forma_dohody)
                : "forma dohody neuvedena"}
              {u.poznamka ? ` · ${u.poznamka}` : ""}
            </div>
            <Zapsal theme={theme} kdo={u.owner} owner={owner} />
          </div>
          <div style={{
            fontSize: "13px", fontWeight: 700, color: theme.text,
            fontVariantNumeric: "tabular-nums",
          }}>{u.podil != null ? `${u.podil} %` : "—"}</div>
          {smimMenit(u, owner, spravce) && (
            <>
              <button onClick={() => setEdituji(u)} style={{
                ...btn(), background: "transparent", color: theme.textSub,
                fontSize: "12px", padding: "2px 5px",
              }}>✎</button>
              <button onClick={() => smazat(u.id)} title="Odebrat" style={{
                ...btn(), background: "transparent", color: theme.textDim,
                fontSize: "14px", padding: "2px 5px",
              }}>×</button>
            </>
          )}
        </div>
      ))}

      {lide.length > 0 && (
        <div style={{
          fontSize: "11px", marginTop: 4,
          color: soucet === 100 ? theme.textSub : theme.yellow,
        }}>
          Součet podílů: {soucet} %
          {soucet !== 100 && " — nedává sto, což nemusí vadit, jen ať o tom víš."}
        </div>
      )}
    </Sekce>
  );
}

function UcastnikEditor({ theme, ciselniky, u, onUloz, onZrus }) {
  const [f, setF] = useState({
    id: u.id, person_id: u.person_id, role: u.role || "prostrednik",
    podil: u.podil ?? "", poradi: u.poradi ?? 1,
    forma_dohody: u.forma_dohody || "", poznamka: u.poznamka || "",
  });
  const uprav = (k, v) => setF(p => ({ ...p, [k]: v }));

  return (
    <div style={{ ...card(theme), padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ fontSize: "12px", fontWeight: 700, color: theme.text, marginBottom: 8 }}>
        {u.osoba?.name}
      </div>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 8, marginBottom: 8,
      }}>
        <div>
          <span style={label(theme)}>Role v téhle zakázce</span>
          <select value={f.role} onChange={e => uprav("role", e.target.value)}
            style={{ ...input(theme), cursor: "pointer" }}>
            {aktivni(ciselniky, "role").map(r => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <span style={label(theme)}>Podíl %</span>
          <input value={f.podil} onChange={e => uprav("podil", e.target.value)}
            placeholder="20" style={input(theme)} />
        </div>
        <div>
          <span style={label(theme)}>Pořadí v řetězci</span>
          <input value={f.poradi} onChange={e => uprav("poradi", e.target.value)}
            placeholder="1" style={input(theme)} />
        </div>
        <div>
          <span style={label(theme)}>Forma dohody</span>
          <select value={f.forma_dohody} onChange={e => uprav("forma_dohody", e.target.value)}
            style={{ ...input(theme), cursor: "pointer" }}>
            <option value="">neuvedeno</option>
            {aktivni(ciselniky, "forma_dohody").map(r => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>
      <input value={f.poznamka} onChange={e => uprav("poznamka", e.target.value)}
        placeholder="Co jste si řekli — „David 40 %, domluveno u oběda“"
        style={{ ...input(theme), marginBottom: 8 }} />
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onUloz(f)} style={btnMain(theme)}>ULOŽIT</button>
        <button onClick={onZrus} style={btnGhost(theme)}>zrušit</button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   GENEZE — koho jsem oslovil a jak to dopadlo
   ════════════════════════════════════════════════════════ */

const KONEC = ["odmitl", "ticho"];

export function Geneze({ theme, owner, ciselniky, zakazka, onOtevriOsobu, spravce = false }) {
  const projectId = zakazka?.id;
  const [radky, setRadky] = useState([]);
  const [busy, setBusy] = useState(true);
  const [parovani, setParovani] = useState(null);
  const [chyba, setChyba] = useState(null);

  const nacti = async () => {
    setBusy(true);
    setRadky(await nactiOsloveni(projectId));
    setBusy(false);
  };
  useEffect(() => { if (projectId) nacti(); }, [projectId]);  // eslint-disable-line

  const poradiStavu = useMemo(() => {
    const m = {};
    for (const e of (ciselniky.stav_osloveni || [])) m[e.key] = e.sort_order;
    return m;
  }, [ciselniky]);

  // Nahoře ten, kdo to vyhrál. Pod ním živí podle toho, jak daleko
  // došli. Odmítnutí a ticho až dole, přeškrtnutě — ať je na první
  // pohled vidět, kdo z toho zbyl.
  const serazene = useMemo(() => {
    const skupina = (r) =>
      r.stav === "dohodnuto" ? 0 : KONEC.includes(r.stav) ? 2 : 1;
    return [...radky].sort((a, b) =>
      skupina(a) - skupina(b) ||
      (poradiStavu[b.stav] || 0) - (poradiStavu[a.stav] || 0) ||
      (a.osoba?.name || "").localeCompare(b.osoba?.name || "", "cs")
    );
  }, [radky, poradiStavu]);

  const souhrn = useMemo(() => {
    const vse = radky.length;
    const odmitl = radky.filter(r => r.stav === "odmitl").length;
    const ticho  = radky.filter(r => r.stav === "ticho").length;
    const hotovo = radky.filter(r => r.stav === "dohodnuto").length;
    const zije   = vse - odmitl - ticho - hotovo;
    return { vse, odmitl, ticho, hotovo, zije };
  }, [radky]);

  const otevriParovani = () => { setChyba(null); setParovani(true); };

  const oslov = async (vybrani) => {
    const res = await oslovHromadne(owner, projectId, vybrani, zakazka?.nazev);
    if (!res.ok) { setChyba(res.chyba); return; }
    setParovani(null);
    nacti();
  };

  return (
    <Sekce theme={theme} nadpis="Koho jsem oslovil"
      akce={
        <button onClick={otevriParovani} style={btnGhost(theme)}>+ oslovit</button>
      }>
      {souhrn.vse > 0 && (
        <div style={{ fontSize: "11.5px", color: theme.textSub, marginBottom: 8, lineHeight: 1.6 }}>
          Oslovil jsem {souhrn.vse}
          {souhrn.zije > 0   && <> · <span style={{ color: theme.accent }}>{souhrn.zije} se řeší</span></>}
          {souhrn.hotovo > 0 && <> · <span style={{ color: theme.green }}>{souhrn.hotovo} dohodnuto</span></>}
          {souhrn.odmitl > 0 && <> · {souhrn.odmitl} odmítl</>}
          {souhrn.ticho > 0  && <> · {souhrn.ticho} bez odezvy</>}
        </div>
      )}

      {chyba && <Chyba theme={theme}>{chyba}</Chyba>}

      {parovani && (
        <VyberKohoOslovit
          theme={theme} owner={owner} ciselniky={ciselniky} projectId={projectId}
          jizOsloveni={new Set(radky.map(r => r.person_id))}
          onOslov={oslov} onZrus={() => setParovani(null)} />
      )}

      {busy && radky.length === 0 && <Tise theme={theme}>Načítám…</Tise>}

      {!busy && radky.length === 0 && !parovani && (
        <Tise theme={theme}>
          Zatím nikdo. Tlačítkem „oslovit“ ti systém nabídne lidi ze sítě,
          kterým tahle zakázka sedí.
        </Tise>
      )}

      {serazene.map(r => (
        <OsloveniRadek key={r.id} r={r} theme={theme} owner={owner}
          ciselniky={ciselniky} onZmena={nacti} onOtevriOsobu={onOtevriOsobu}
          moje={smimMenit(r, owner, spravce)} />
      ))}
    </Sekce>
  );
}

function OsloveniRadek({ r, theme, owner, ciselniky, onZmena, onOtevriOsobu, moje = true }) {
  const [otevreno, setOtevreno] = useState(false);
  const [f, setF] = useState({
    id: r.id, stav: r.stav, aktualne: r.aktualne || "",
    kanal: r.kanal || "", cena_jednana: r.cena_jednana ? penizePresne(r.cena_jednana) : "",
    pripominka_at: r.pripominka_at ? r.pripominka_at.slice(0, 10) : "",
    poznamka: r.poznamka || "",
  });
  const [uklada, setUklada] = useState(false);
  const [chyba, setChyba] = useState(null);

  const skrtnuto = KONEC.includes(r.stav);
  const vyhral = r.stav === "dohodnuto";
  const uprav = (k, v) => { setF(p => ({ ...p, [k]: v })); setChyba(null); };

  const uloz = async () => {
    setUklada(true);
    const res = await ulozOsloveni(owner, {
      ...f,
      cena_jednana: parsePenize(f.cena_jednana),
      pripominka_at: f.pripominka_at ? new Date(f.pripominka_at + "T09:00:00").toISOString() : "",
    }, r.stav, popis(ciselniky, "stav_osloveni", f.stav));
    setUklada(false);
    if (!res.ok) { setChyba(res.chyba); return; }
    setOtevreno(false);
    onZmena();
  };

  const smaz = async () => {
    const res = await smazOsloveni(r.id);
    if (!res.ok) { setChyba(res.chyba); return; }
    onZmena();
  };

  const zaDni = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    uprav("pripominka_at", d.toISOString().slice(0, 10));
  };

  return (
    <div style={{
      ...card(theme), padding: "9px 11px", marginBottom: 6,
      borderColor: vyhral ? `${theme.green}55` : theme.cardBorder,
      background: vyhral ? `${theme.green}0c` : theme.card,
      opacity: skrtnuto ? 0.55 : 1,
    }}>
      <div onClick={() => setOtevreno(v => !v)} style={{
        display: "flex", alignItems: "center", gap: 9, cursor: "pointer",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12.5px", fontWeight: 700 }}>
            <span onClick={(e) => { e.stopPropagation(); onOtevriOsobu?.(r.person_id); }}
              title="Ukázat všechno, co s ním běží"
              style={{
                color: theme.accent, cursor: "pointer",
                textDecoration: skrtnuto ? "line-through" : "none",
              }}>{r.osoba?.name || "—"}</span>
          </div>
          <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 1 }}>
            {r.aktualne
              ? <span style={{ color: theme.yellow }}>{r.aktualne} · {jakDavno(r.aktualne_at)}</span>
              : `osloveno ${datumKratce(r.odeslano_at)}`}
            {r.cena_jednana ? ` · jednáme ${penizeKratce(r.cena_jednana)}` : ""}
          </div>
          <Zapsal theme={theme} kdo={r.owner} owner={owner} />
        </div>
        {r.pripominka_at && (
          <span title="Připomínka" style={{
            fontSize: "10.5px", color: new Date(r.pripominka_at) <= new Date()
              ? theme.red : theme.textSub,
          }}>⏰ {datumKratce(r.pripominka_at)}</span>
        )}
        <span style={{
          fontSize: "10.5px", fontWeight: 700, whiteSpace: "nowrap",
          color: vyhral ? theme.green : skrtnuto ? theme.textSub : theme.accent,
        }}>{popis(ciselniky, "stav_osloveni", r.stav)}</span>
      </div>

      {/* Cizí záznam se jen čte. Tlačítko ULOŽIT by stejně neprošlo —
          databáze cizí řádek přepsat nenechá — a zbytečně by to mátlo. */}
      {otevreno && !moje && (
        <div style={{
          marginTop: 10, borderTop: `1px solid ${theme.cardBorder}`, paddingTop: 10,
          fontSize: "12px", color: theme.text, lineHeight: 1.9,
        }}>
          {r.kanal && <div><span style={{ color: theme.textSub }}>oslovil ho </span>{r.kanal}</div>}
          {r.cena_jednana != null && (
            <div><span style={{ color: theme.textSub }}>jednaná cena </span>
              {penizeKratce(r.cena_jednana)}</div>
          )}
          {r.aktualne && (
            <div><span style={{ color: theme.textSub }}>teď </span>{r.aktualne}</div>
          )}
          {r.pripominka_at && (
            <div><span style={{ color: theme.textSub }}>ozve se mu </span>
              {datumKratce(r.pripominka_at)}</div>
          )}
          {r.poznamka && (
            <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{r.poznamka}</div>
          )}
          <div style={{ fontSize: "10.5px", color: theme.textSub, marginTop: 6 }}>
            Zapsal {r.owner}. Měnit to může jen on — ty si můžeš přidat vlastní záznam.
          </div>
        </div>
      )}

      {otevreno && moje && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${theme.cardBorder}`, paddingTop: 10 }}>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
            gap: 8, marginBottom: 8,
          }}>
            <div>
              <span style={label(theme)}>Kam až to došlo</span>
              <select value={f.stav} onChange={e => uprav("stav", e.target.value)}
                style={{ ...input(theme), cursor: "pointer" }}>
                {aktivni(ciselniky, "stav_osloveni").map(s => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <span style={label(theme)}>Čím jsem ho oslovil</span>
              <input value={f.kanal} onChange={e => uprav("kanal", e.target.value)}
                placeholder="mail / telefon / osobně" style={input(theme)} />
            </div>
            <div>
              <span style={label(theme)}>Vyjednaná cena</span>
              <input value={f.cena_jednana} onChange={e => uprav("cena_jednana", e.target.value)}
                placeholder="85 mil" style={input(theme)} />
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <span style={label(theme)}>Co se s tím děje teď</span>
            <input value={f.aktualne} onChange={e => uprav("aktualne", e.target.value)}
              placeholder="počítá kalkulaci / jde to do schvalovačky / čeká na banku"
              style={input(theme)} />
          </div>

          <div style={{ marginBottom: 8 }}>
            <span style={label(theme)}>Kdy se mu ozvat</span>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              <input type="date" value={f.pripominka_at}
                onChange={e => uprav("pripominka_at", e.target.value)}
                style={{ ...input(theme), maxWidth: 150, cursor: "pointer" }} />
              <button onClick={() => zaDni(7)}  style={btnGhost(theme)}>za týden</button>
              <button onClick={() => zaDni(14)} style={btnGhost(theme)}>za 14 dní</button>
              <button onClick={() => zaDni(30)} style={btnGhost(theme)}>za měsíc</button>
              {f.pripominka_at && (
                <button onClick={() => uprav("pripominka_at", "")} style={btnGhost(theme)}>zrušit</button>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 9 }}>
            <span style={label(theme)}>Poznámka</span>
            <textarea value={f.poznamka} onChange={e => uprav("poznamka", e.target.value)}
              rows={2} placeholder="Co přesně řekl."
              style={{ ...input(theme), resize: "vertical", lineHeight: 1.6 }} />
          </div>

          {chyba && <Chyba theme={theme}>{chyba}</Chyba>}

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={uloz} disabled={uklada} style={{
              ...btnMain(theme), opacity: uklada ? 0.6 : 1,
            }}>{uklada ? "UKLÁDÁM…" : "ULOŽIT"}</button>
            <button onClick={() => setOtevreno(false)} style={btnGhost(theme)}>zavřít</button>
            <span style={{ flex: 1 }} />
            <button onClick={smaz} style={{
              ...btnGhost(theme), color: theme.red, borderColor: `${theme.red}44`,
            }}>odebrat</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Výběr, koho oslovit.

   Dva pohledy v jednom okně, protože ne vždycky chceš jen ty,
   komu to sedí podle kritérií:
     "Komu to pasuje" — výsledek párování, seřazený podle shody
     "Všichni"        — celá síť, filtrovaná ručně podle typu a kraje

   V obou se dá zaškrtnout celý výsledek a oslovit najednou.
   Stavy se pak mění u jednotlivých řádků v seznamu pod tím. */
function VyberKohoOslovit({ theme, owner, ciselniky, projectId, jizOsloveni, onOslov, onZrus }) {
  const [rezim, setRezim] = useState("pasuje");   // pasuje | vsichni
  const [seznam, setSeznam] = useState([]);
  const [busy, setBusy] = useState(true);
  const [typ, setTyp] = useState("");
  const [kraj, setKraj] = useState("");
  const [hledat, setHledat] = useState("");
  const [vybrani, setVybrani] = useState(() => new Set());

  useEffect(() => {
    let zrus = false;
    setBusy(true);
    (async () => {
      let r;
      if (rezim === "pasuje") {
        const n = await komuToPasuje(projectId, 50);
        r = n.map(x => ({
          person_id: x.person_id, jmeno: x.jmeno, card_id: x.card_id,
          nazev_karty: x.nazev_karty, skore: Number(x.skore),
          sedi: x.sedi || [], nesedi: x.nesedi || [],
        }));
      } else {
        const karty = await nactiKarty(owner, {
          smer: "poptavka", jenAktivni: true, typ: typ || undefined, kraj: kraj || undefined,
        }, 200);
        // Jeden člověk může mít víc karet; v seznamu ho chceme jednou.
        const videni = new Set();
        r = [];
        for (const k of karty) {
          if (videni.has(k.person_id)) continue;
          videni.add(k.person_id);
          r.push({
            person_id: k.person_id, jmeno: k.osoba?.name || "—", card_id: k.id,
            nazev_karty: k.nazev, skore: null, sedi: [], nesedi: [],
            poznamka: k.poznamka,
          });
        }
      }
      if (zrus) return;
      const zbyva = r.filter(x => !jizOsloveni.has(x.person_id));
      setSeznam(zbyva);
      setVybrani(new Set(rezim === "pasuje" ? zbyva.map(x => x.person_id) : []));
      setBusy(false);
    })();
    return () => { zrus = true; };
  }, [rezim, typ, kraj, projectId, owner]);  // eslint-disable-line

  const videt = useMemo(() => {
    const h = hledat.trim().toLowerCase();
    if (!h) return seznam;
    const bez = (x) => (x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return seznam.filter(x => bez(x.jmeno).includes(bez(h)) || bez(x.nazev_karty).includes(bez(h)));
  }, [seznam, hledat]);

  const prepni = (id) => setVybrani(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const vybranoZViditelnych = videt.filter(x => vybrani.has(x.person_id)).length;
  const vseVybrano = videt.length > 0 && vybranoZViditelnych === videt.length;

  const prepniVse = () => setVybrani(s => {
    const n = new Set(s);
    if (vseVybrano) videt.forEach(x => n.delete(x.person_id));
    else videt.forEach(x => n.add(x.person_id));
    return n;
  });

  return (
    <div style={{ ...card(theme), padding: "11px 12px", marginBottom: 9 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 9 }}>
        {[
          { k: "pasuje",  t: "Komu to pasuje" },
          { k: "vsichni", t: "Všichni investoři" },
        ].map(v => {
          const zap = rezim === v.k;
          return (
            <button key={v.k} onClick={() => setRezim(v.k)} style={{
              ...btnGhost(theme),
              background: zap ? theme.accentSoft : "transparent",
              color: zap ? theme.accent : theme.textSub,
              borderColor: zap ? theme.accentBorder : theme.cardBorder,
              fontWeight: zap ? 700 : 600,
            }}>{v.t}</button>
          );
        })}
      </div>

      {rezim === "vsichni" && (
        <div style={{ display: "flex", gap: 6, marginBottom: 9, flexWrap: "wrap" }}>
          <select value={typ} onChange={e => setTyp(e.target.value)}
            style={{ ...input(theme), flex: "0 1 150px", cursor: "pointer" }}>
            <option value="">každý typ</option>
            {aktivni(ciselniky, "typ").map(t => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          <select value={kraj} onChange={e => setKraj(e.target.value)}
            style={{ ...input(theme), flex: "0 1 150px", cursor: "pointer" }}>
            <option value="">každý kraj</option>
            {aktivni(ciselniky, "kraj").map(t => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          <input value={hledat} onChange={e => setHledat(e.target.value)}
            placeholder="jméno…" style={{ ...input(theme), flex: "1 1 110px" }} />
        </div>
      )}

      {busy && <Tise theme={theme}>Načítám…</Tise>}

      {!busy && videt.length === 0 && (
        <Tise theme={theme}>
          {rezim === "pasuje"
            ? "Nikdo další nesedí. Buď jsi oslovil všechny, na koho to pasuje, nebo u lidí v síti chybí karta s tím, co hledají. Zkus druhý pohled — tam si vybereš ručně."
            : "Nikdo takový v síti není. Zkus ubrat filtr, nebo lidem doplň karty v záložce Síť."}
        </Tise>
      )}

      {videt.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 4,
          paddingBottom: 5, borderBottom: `1px solid ${theme.cardBorder}`,
        }}>
          <button onClick={prepniVse} style={{
            ...btn(), background: "transparent", color: theme.accent,
            fontSize: "11.5px", padding: "2px 4px",
          }}>{vseVybrano ? "zrušit výběr" : `vybrat vše (${videt.length})`}</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: "11px", color: theme.textSub }}>
            vybráno {vybrani.size}
          </span>
        </div>
      )}

      {videt.map(r => {
        const zap = vybrani.has(r.person_id);
        return (
          <div key={r.card_id} onClick={() => prepni(r.person_id)} style={{
            display: "flex", alignItems: "center", gap: 9, padding: "6px 4px",
            cursor: "pointer", opacity: zap ? 1 : 0.5,
          }}>
            <span style={{ fontSize: "14px" }}>{zap ? "☑" : "☐"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "12.5px", fontWeight: 700, color: theme.text }}>
                {r.jmeno}
                {r.nazev_karty && (
                  <span style={{ fontWeight: 400, color: theme.textSub, fontSize: "11px" }}>
                    {" "}· {r.nazev_karty}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "11px", marginTop: 1 }}>
                {(r.sedi || []).length > 0 && (
                  <span style={{ color: theme.green }}>sedí: {r.sedi.join(", ")}</span>
                )}
                {(r.nesedi || []).length > 0 && (
                  <span style={{ color: theme.yellow }}>
                    {(r.sedi || []).length > 0 ? "  ·  " : ""}{r.nesedi.join(", ")}
                  </span>
                )}
                {r.skore === null && r.poznamka && (
                  <span style={{ color: theme.textMid }}>{r.poznamka}</span>
                )}
              </div>
            </div>
            {r.skore !== null && (
              <span style={{
                fontSize: "14px", fontWeight: 700, color: theme.accent,
                fontVariantNumeric: "tabular-nums",
              }}>{r.skore}</span>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
        <button
          onClick={() => onOslov(seznam.filter(x => vybrani.has(x.person_id)))}
          disabled={vybrani.size === 0}
          style={{ ...btnMain(theme), opacity: vybrani.size === 0 ? 0.5 : 1 }}>
          OSLOVIT ({vybrani.size})
        </button>
        <button onClick={onZrus} style={btnGhost(theme)}>zavřít</button>
      </div>

      <div style={{ fontSize: "10.5px", color: theme.textSub, marginTop: 7, lineHeight: 1.6 }}>
        Zapíše se, že jsi je oslovil, a objeví se to i na jejich časové ose
        v Mapě. Stavy pak měníš u jednotlivých řádků níž. Mail nebo
        telefonát je pořád na tobě.
      </div>
    </div>
  );
}

/* ── Společné drobnosti ────────────────────────────── */

/* Smím ten řádek měnit? Vlastní ano, cizí ne — ledaže jsem správce.
   Řádky bez vyplněného vlastníka jsou staré záznamy z doby, kdy
   se sloupec nenačítal; ty se chovají jako moje. */
export function smimMenit(radek, owner, spravce) {
  if (spravce) return true;
  if (!radek?.owner) return true;
  return radek.owner === owner;
}

/* Podpis pod cizím záznamem. U vlastních se nic nepíše —
   bylo by to na každém řádku a k ničemu. */
function Zapsal({ theme, kdo, owner }) {
  if (!kdo || kdo === owner) return null;
  return (
    <div style={{ fontSize: "10.5px", color: theme.purple, marginTop: 2 }}>
      zapsal {kdo}
    </div>
  );
}

function Sekce({ theme, nadpis, akce, children }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 7,
      }}>
        <span style={{ ...label(theme), marginBottom: 0, flex: 1 }}>{nadpis}</span>
        {akce}
      </div>
      {children}
    </div>
  );
}

function Tise({ theme, children }) {
  return (
    <div style={{
      fontSize: "11.5px", color: theme.textSub, lineHeight: 1.7,
      padding: "8px 2px",
    }}>{children}</div>
  );
}

function Chyba({ theme, children }) {
  return (
    <div style={{
      background: `${theme.red}18`, border: `1px solid ${theme.red}44`,
      borderRadius: 8, padding: "7px 10px", fontSize: "11.5px",
      color: theme.red, marginBottom: 8,
    }}>{children}</div>
  );
}
