/* ═══════════════════════════════════════════════════════
   OBCHOD — sdílení a uživatelé

   Sdílí se zakázka, nic jiného. Kontakty, karty investorů
   ani mapa se nesdílí nikdy — to nejsou přepínače, to je
   dané tím, co funkce v databázi umí vrátit.

   Každé sdílení má vlastní nastavení. S Davidem, který je
   napůl parťák, můžeš sdílet víc než s někým, koho zatím
   neznáš a čekáš na podepsané NDA.
   ═══════════════════════════════════════════════════════ */

import { useState, useEffect } from "react";
import {
  nactiSdileni, ulozSdileni, zrusSdileni, nactiUzivatele,
  sdileneSeMnou, sdileneOsloveni, sdilenyRetezec,
  nactiPozvanky, pozviUzivatele, zrusPozvanku,
  PREPINACE, SABLONY, zeSablony, popis,
} from "./api.js";
import {
  card, input, btn, btnMain, btnGhost, label,
  penizeKratce, datumKratce,
} from "./ui.js";

/* ════════════════════════════════════════════════════════
   SDÍLENÍ ZAKÁZKY — sekce v detailu
   ════════════════════════════════════════════════════════ */

export function SdileniZakazky({ theme, owner, projectId }) {
  const [sdileni, setSdileni] = useState([]);
  const [uzivatele, setUzivatele] = useState([]);
  const [busy, setBusy] = useState(true);
  const [edituji, setEdituji] = useState(null);
  const [chyba, setChyba] = useState(null);

  const nacti = async () => {
    setBusy(true);
    const [s, u] = await Promise.all([nactiSdileni(projectId), nactiUzivatele()]);
    setSdileni(s);
    setUzivatele(u.filter(x => x.name !== owner));
    setBusy(false);
  };
  useEffect(() => { if (projectId) nacti(); }, [projectId]);  // eslint-disable-line

  const volni = uzivatele.filter(u => !sdileni.some(s => s.grantee === u.name));

  const uloz = async (data) => {
    setChyba(null);
    const res = await ulozSdileni(owner, { ...data, project_id: projectId });
    if (!res.ok) { setChyba(res.chyba); return; }
    setEdituji(null);
    nacti();
  };

  const zrus = async (id) => {
    const res = await zrusSdileni(id);
    if (!res.ok) { setChyba(res.chyba); return; }
    nacti();
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span style={{ ...label(theme), marginBottom: 0, flex: 1 }}>Sdílím s</span>
        {volni.length > 0 && !edituji && (
          <button onClick={() => setEdituji({ ...zeSablony("Jen projekt"), grantee: volni[0].name })}
            style={btnGhost(theme)}>+ sdílet</button>
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
        <SdileniEditor theme={theme} s={edituji} volni={volni}
          onUloz={uloz} onZrus={() => setEdituji(null)} />
      )}

      {busy && sdileni.length === 0 && (
        <div style={{ fontSize: "11.5px", color: theme.textSub, padding: "6px 2px" }}>
          Načítám…
        </div>
      )}

      {!busy && sdileni.length === 0 && !edituji && (
        <div style={{ fontSize: "11.5px", color: theme.textSub, lineHeight: 1.7, padding: "6px 2px" }}>
          Zakázku zatím nikdo jiný nevidí.
          {uzivatele.length === 0 && " V systému není nikdo další, koho bys mohl přidat."}
        </div>
      )}

      {sdileni.map(s => (
        <div key={s.id} style={{
          ...card(theme), padding: "9px 11px", marginBottom: 6,
          display: "flex", alignItems: "center", gap: 9,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "12.5px", fontWeight: 700, color: theme.text }}>
              {s.grantee}
              {s.sablona && (
                <span style={{ fontWeight: 400, color: theme.textSub, fontSize: "11px" }}>
                  {" "}· {s.sablona}
                </span>
              )}
            </div>
            <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 2, lineHeight: 1.5 }}>
              vidí: {PREPINACE.filter(p => s[p.k]).map(p => p.t.toLowerCase()).join(", ") || "jen název a lokalitu"}
            </div>
            {(s.vidi_retezec || s.vidi_ceny_jednani) && (
              <div style={{ fontSize: "10.5px", color: theme.yellow, marginTop: 2 }}>
                Pozor: vidí i to, jak se obchod dělí.
              </div>
            )}
          </div>
          <button onClick={() => setEdituji(s)} style={{
            ...btn(), background: "transparent", color: theme.textSub,
            fontSize: "12px", padding: "2px 5px",
          }}>✎</button>
          <button onClick={() => zrus(s.id)} title="Přestat sdílet" style={{
            ...btn(), background: "transparent", color: theme.textDim,
            fontSize: "14px", padding: "2px 5px",
          }}>×</button>
        </div>
      ))}
    </div>
  );
}

function SdileniEditor({ theme, s, volni, onUloz, onZrus }) {
  const [f, setF] = useState(s);
  const novy = !s.id;

  const vyberSablonu = (nazev) => setF(p => ({ ...p, ...zeSablony(nazev), grantee: p.grantee, id: p.id }));
  const prepni = (k) => setF(p => ({ ...p, [k]: !p[k], sablona: "vlastní" }));

  return (
    <div style={{ ...card(theme), padding: "11px 12px", marginBottom: 9 }}>
      {novy ? (
        <div style={{ marginBottom: 9 }}>
          <span style={label(theme)}>Komu</span>
          <select value={f.grantee} onChange={e => setF(p => ({ ...p, grantee: e.target.value }))}
            style={{ ...input(theme), cursor: "pointer" }}>
            {volni.map(u => <option key={u.name} value={u.name}>{u.name}</option>)}
          </select>
        </div>
      ) : (
        <div style={{ fontSize: "12.5px", fontWeight: 700, color: theme.text, marginBottom: 9 }}>
          {f.grantee}
        </div>
      )}

      <div style={{ marginBottom: 9 }}>
        <span style={label(theme)}>Šablona</span>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {Object.keys(SABLONY).map(n => {
            const zap = f.sablona === n;
            return (
              <button key={n} onClick={() => vyberSablonu(n)} style={{
                ...btnGhost(theme),
                background: zap ? theme.accentSoft : "transparent",
                color: zap ? theme.accent : theme.textSub,
                borderColor: zap ? theme.accentBorder : theme.cardBorder,
              }}>{n}</button>
            );
          })}
          {f.sablona === "vlastní" && (
            <span style={{ fontSize: "11px", color: theme.textSub, alignSelf: "center" }}>
              vlastní nastavení
            </span>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 9 }}>
        <span style={label(theme)}>Co uvidí</span>
        {PREPINACE.map(p => {
          const citlive = p.k === "vidi_retezec" || p.k === "vidi_ceny_jednani";
          return (
            <div key={p.k} onClick={() => prepni(p.k)} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 2px", cursor: "pointer",
            }}>
              <span style={{ fontSize: "14px" }}>{f[p.k] ? "☑" : "☐"}</span>
              <span style={{
                fontSize: "12px",
                color: f[p.k] ? (citlive ? theme.yellow : theme.text) : theme.textSub,
              }}>{p.t}</span>
            </div>
          );
        })}
      </div>

      <input value={f.poznamka || ""} onChange={e => setF(p => ({ ...p, poznamka: e.target.value }))}
        placeholder="Poznámka — třeba „rozšířit až po NDA“"
        style={{ ...input(theme), marginBottom: 9 }} />

      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onUloz(f)} style={btnMain(theme)}>
          {novy ? "SDÍLET" : "ULOŽIT"}
        </button>
        <button onClick={onZrus} style={btnGhost(theme)}>zrušit</button>
      </div>

      <div style={{ fontSize: "10.5px", color: theme.textSub, marginTop: 8, lineHeight: 1.6 }}>
        Kontakty, karty investorů ani mapa se nesdílí nikdy — nejde o přepínač,
        databáze je druhé straně prostě nevydá.
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   SDÍLENO SE MNOU
   ════════════════════════════════════════════════════════ */

export function SdilenoSeMnou({ theme, ciselniky }) {
  const [zakazky, setZakazky] = useState([]);
  const [busy, setBusy] = useState(true);
  const [otevrena, setOtevrena] = useState(null);

  useEffect(() => {
    let zrus = false;
    sdileneSeMnou().then(z => { if (!zrus) { setZakazky(z); setBusy(false); } });
    return () => { zrus = true; };
  }, []);

  if (otevrena) {
    return <SdilenaZakazka theme={theme} ciselniky={ciselniky} z={otevrena}
      onZpet={() => setOtevrena(null)} />;
  }

  return (
    <div style={{ padding: "12px 16px 18px" }}>
      {busy && <Tise theme={theme}>Načítám…</Tise>}
      {!busy && zakazky.length === 0 && (
        <Tise theme={theme}>
          Nikdo s tebou zatím nic nesdílí. Až ti někdo zakázku pustí,
          objeví se tady — i s tím, co ti u ní dovolil vidět.
        </Tise>
      )}
      {zakazky.map(z => (
        <div key={z.id} onClick={() => setOtevrena(z)} style={{
          ...card(theme), padding: "10px 12px", marginBottom: 7, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{
            fontSize: "10px", fontWeight: 700, color: theme.textSub,
            whiteSpace: "nowrap",
          }}>{z.kod}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: theme.text }}>{z.nazev}</div>
            <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 1 }}>
              {[
                popis(ciselniky, "typ", z.typ),
                [z.mesto, popis(ciselniky, "kraj", z.kraj)].filter(Boolean).join(", "),
                popis(ciselniky, "faze", z.faze),
                `od ${z.od_koho}`,
              ].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: theme.text }}>
              {z.cena != null ? penizeKratce(z.cena) : "—"}
            </div>
            {z.stav && (
              <div style={{ fontSize: "10px", color: theme.textSub }}>
                {popis(ciselniky, "stav_zakazky", z.stav)}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SdilenaZakazka({ theme, ciselniky, z, onZpet }) {
  const [osloveni, setOsloveni] = useState([]);
  const [retezec, setRetezec] = useState([]);

  useEffect(() => {
    if (z.vidi_jmena)   sdileneOsloveni(z.id).then(setOsloveni);
    if (z.vidi_retezec) sdilenyRetezec(z.id).then(setRetezec);
  }, [z]);

  const Radek = ({ popisek, hodnota }) => hodnota ? (
    <div style={{ display: "flex", gap: 8, marginBottom: 5 }}>
      <span style={{ fontSize: "11px", color: theme.textSub, minWidth: 92 }}>{popisek}</span>
      <span style={{ fontSize: "12.5px", color: theme.text }}>{hodnota}</span>
    </div>
  ) : null;

  return (
    <div style={{ padding: "12px 16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={onZpet} style={{
          ...btn(), background: "transparent", color: theme.textSub,
          fontSize: "15px", padding: "2px 6px",
        }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: theme.text }}>{z.nazev}</div>
          <div style={{ fontSize: "11px", color: theme.textSub }}>
            {z.kod} · sdílí {z.od_koho} od {datumKratce(z.sdileno_at)}
          </div>
        </div>
      </div>

      <div style={{ ...card(theme), padding: "11px 13px", marginBottom: 10 }}>
        <Radek popisek="Typ"      hodnota={popis(ciselniky, "typ", z.typ)} />
        <Radek popisek="Velikost" hodnota={z.velikost
          ? `${z.velikost} ${popis(ciselniky, "jednotka", z.jednotka)}` : null} />
        <Radek popisek="Lokalita" hodnota={[z.mesto, popis(ciselniky, "kraj", z.kraj)]
          .filter(Boolean).join(", ")} />
        <Radek popisek="Podrobně" hodnota={z.lokalita_text} />
        <Radek popisek="Fáze"     hodnota={popis(ciselniky, "faze", z.faze)} />
        <Radek popisek="Cena"     hodnota={z.cena != null ? penizeKratce(z.cena) : null} />
        <Radek popisek="Stav"     hodnota={popis(ciselniky, "stav_zakazky", z.stav)} />
      </div>

      {z.souhrn && (
        <div style={{ ...card(theme), padding: "11px 13px", marginBottom: 10 }}>
          <div style={{ ...label(theme), marginBottom: 5 }}>Souhrn</div>
          <div style={{ fontSize: "12.5px", color: theme.text, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {z.souhrn}
          </div>
        </div>
      )}

      {z.slozka_odkaz && (
        <a href={z.slozka_odkaz} target="_blank" rel="noreferrer" style={{
          ...card(theme), padding: "10px 13px", marginBottom: 10,
          display: "block", color: theme.accent, fontSize: "12.5px",
          textDecoration: "none", fontWeight: 600,
        }}>📂 otevřít podklady →</a>
      )}

      {z.vidi_jmena && osloveni.length > 0 && (
        <div style={{ ...card(theme), padding: "11px 13px", marginBottom: 10 }}>
          <div style={{ ...label(theme), marginBottom: 6 }}>Kam to jde</div>
          {osloveni.map((o, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between",
              fontSize: "12px", padding: "3px 0", color: theme.text,
            }}>
              <span>{o.jmeno}</span>
              <span style={{ color: theme.textSub }}>
                {popis(ciselniky, "stav_osloveni", o.stav)}
              </span>
            </div>
          ))}
        </div>
      )}

      {z.vidi_retezec && retezec.length > 0 && (
        <div style={{ ...card(theme), padding: "11px 13px" }}>
          <div style={{ ...label(theme), marginBottom: 6 }}>Kdo je na tom napojený</div>
          {retezec.map((r, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between",
              fontSize: "12px", padding: "3px 0", color: theme.text,
            }}>
              <span>{r.poradi}. {r.jmeno} · {popis(ciselniky, "role", r.role)}</span>
              <span style={{ color: theme.textSub }}>
                {r.podil != null ? `${r.podil} %` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   UŽIVATELÉ — jen pro správce
   ════════════════════════════════════════════════════════ */

export function Uzivatele({ theme, owner, onZpet }) {
  const [lide, setLide] = useState([]);
  const [pozvanky, setPozvanky] = useState([]);
  const [busy, setBusy] = useState(true);
  const [novy, setNovy] = useState(null);
  const [chyba, setChyba] = useState(null);
  const [hotovo, setHotovo] = useState(null);

  const nacti = async () => {
    setBusy(true);
    const [u, p] = await Promise.all([nactiUzivatele(), nactiPozvanky()]);
    setLide(u); setPozvanky(p); setBusy(false);
  };
  useEffect(() => { nacti(); }, []);

  const pozvi = async () => {
    setChyba(null); setHotovo(null);
    const res = await pozviUzivatele(owner, novy);
    if (!res.ok) { setChyba(res.chyba); return; }
    setNovy(null);
    setHotovo(`Pozvánka pro ${res.pozvanka.jmeno} je připravená. Pošli mu adresu aplikace — heslo si zvolí sám při registraci.`);
    nacti();
  };

  const nepouzite = pozvanky.filter(p => !p.pouzito_at);

  return (
    <div style={{ padding: "12px 16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={onZpet} style={{
          ...btn(), background: "transparent", color: theme.textSub,
          fontSize: "15px", padding: "2px 6px",
        }}>←</button>
        <div style={{ flex: 1, fontSize: "14px", fontWeight: 700, color: theme.text }}>
          Uživatelé
        </div>
        {!novy && (
          <button onClick={() => setNovy({ email: "", jmeno: "", is_admin: false })}
            style={btnMain(theme)}>+ pozvat</button>
        )}
      </div>

      {hotovo && (
        <div style={{
          background: `${theme.green}15`, border: `1px solid ${theme.green}44`,
          borderRadius: 8, padding: "9px 11px", fontSize: "12px",
          color: theme.green, marginBottom: 10, lineHeight: 1.6,
        }}>{hotovo}</div>
      )}

      {chyba && (
        <div style={{
          background: `${theme.red}18`, border: `1px solid ${theme.red}44`,
          borderRadius: 8, padding: "8px 11px", fontSize: "12px",
          color: theme.red, marginBottom: 10,
        }}>{chyba}</div>
      )}

      {novy && (
        <div style={{ ...card(theme), padding: "11px 12px", marginBottom: 10 }}>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 8, marginBottom: 9,
          }}>
            <div>
              <span style={label(theme)}>Jméno v systému</span>
              <input value={novy.jmeno} onChange={e => setNovy(p => ({ ...p, jmeno: e.target.value }))}
                placeholder="David" style={input(theme)} />
            </div>
            <div>
              <span style={label(theme)}>E-mail</span>
              <input value={novy.email} onChange={e => setNovy(p => ({ ...p, email: e.target.value }))}
                placeholder="david@firma.cz" style={input(theme)} />
            </div>
          </div>
          <div onClick={() => setNovy(p => ({ ...p, is_admin: !p.is_admin }))} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "4px 2px", cursor: "pointer", marginBottom: 9,
          }}>
            <span style={{ fontSize: "14px" }}>{novy.is_admin ? "☑" : "☐"}</span>
            <span style={{ fontSize: "12px", color: novy.is_admin ? theme.text : theme.textSub }}>
              Správce — smí zvát další lidi
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={pozvi} style={btnMain(theme)}>POZVAT</button>
            <button onClick={() => { setNovy(null); setChyba(null); }} style={btnGhost(theme)}>zrušit</button>
          </div>
          <div style={{ fontSize: "10.5px", color: theme.textSub, marginTop: 8, lineHeight: 1.6 }}>
            Jméno zadáváš ty, ne systém. Je to podpis pod všemi jeho záznamy
            a později se mění těžko.
          </div>
        </div>
      )}

      {busy && <Tise theme={theme}>Načítám…</Tise>}

      {lide.length > 0 && (
        <>
          <div style={{ ...label(theme), marginTop: 4, marginBottom: 6 }}>Mají účet</div>
          {lide.map(u => (
            <div key={u.id} style={{
              ...card(theme), padding: "8px 11px", marginBottom: 6,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: theme.text, flex: 1 }}>
                {u.name}
              </span>
              {u.is_admin && (
                <span style={{ fontSize: "10px", color: theme.purple, fontWeight: 700 }}>SPRÁVCE</span>
              )}
              {u.name === owner && (
                <span style={{ fontSize: "10px", color: theme.textSub }}>to jsi ty</span>
              )}
            </div>
          ))}
        </>
      )}

      {nepouzite.length > 0 && (
        <>
          <div style={{ ...label(theme), marginTop: 12, marginBottom: 6 }}>
            Pozvaní, zatím bez účtu
          </div>
          {nepouzite.map(p => (
            <div key={p.email} style={{
              ...card(theme), padding: "8px 11px", marginBottom: 6,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "12.5px", fontWeight: 700, color: theme.text }}>
                  {p.jmeno}
                </div>
                <div style={{ fontSize: "11px", color: theme.textSub }}>
                  {p.email} · pozván {datumKratce(p.created_at)}
                </div>
              </div>
              <button onClick={async () => {
                const r = await zrusPozvanku(p.email);
                if (r.ok) nacti(); else setChyba(r.chyba);
              }} title="Zrušit pozvánku" style={{
                ...btn(), background: "transparent", color: theme.textDim,
                fontSize: "14px", padding: "2px 5px",
              }}>×</button>
            </div>
          ))}
        </>
      )}

      {!busy && lide.length === 0 && nepouzite.length === 0 && (
        <Tise theme={theme}>
          Tady uvidíš lidi, kteří mají do systému přístup. Zvát můžou jen správci.
        </Tise>
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
