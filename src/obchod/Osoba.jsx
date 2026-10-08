/* ═══════════════════════════════════════════════════════
   OBCHOD — člověk ze všech stran

   Jedna obrazovka, která odpovídá na otázku „co s ním mám“.
   Zavolá klient, najdeš ho podle jména nebo čísla a vidíš
   všechno, co s ním běží — bez ohledu na to, čím v řetězci je.

   Role se totiž posouvá. Klient je pro Davida majitel, David
   je pro tebe prostředník, investor je na konci. Proto se
   u každé zakázky ukazuje role, kterou tam má ten člověk,
   ne jedna role napevno u jeho jména.
   ═══════════════════════════════════════════════════════ */

import { useState, useEffect } from "react";
import { osobaPrehled, ulozRole, popis, aktivni } from "./api.js";
import {
  card, btn, btnGhost, label,
  penizeKratce, datumKratce, jakDavno,
} from "./ui.js";

export default function Osoba({ theme, owner, personId, ciselniky, onZpet, onOtevriZakazku }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let zrus = false;
    setBusy(true);
    osobaPrehled(owner, personId).then(r => { if (!zrus) { setD(r); setBusy(false); } });
    return () => { zrus = true; };
  }, [owner, personId]);

  if (busy) {
    return <div style={{ padding: "16px", fontSize: "12px", color: theme.textSub }}>Načítám…</div>;
  }
  if (!d?.osoba) {
    return (
      <div style={{ padding: "16px" }}>
        <button onClick={onZpet} style={btnGhost(theme)}>← zpět</button>
        <div style={{ fontSize: "12px", color: theme.textSub, marginTop: 10 }}>
          Tenhle člověk se nenašel.
        </div>
      </div>
    );
  }

  const o = d.osoba;
  // Bez navázané zakázky není co ukázat; jinak by zůstal viset prázdný nadpis.
  const ucast = d.ucast.filter(x => x.projekt);
  const osloveni = d.osloveni.filter(x => x.projekt);
  const zive = osloveni.filter(x => !["odmitl", "ticho", "dohodnuto"].includes(x.stav));
  const posledni = d.zaznamy[0];

  return (
    <div style={{ padding: "12px 16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button onClick={onZpet} title="Zpět" style={{
          ...btn(), background: "transparent", color: theme.textSub,
          fontSize: "15px", padding: "2px 6px",
        }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: theme.text }}>{o.name}</div>
          <div style={{ fontSize: "11.5px", color: theme.textSub, marginTop: 1 }}>
            {[o.contact, o.met_at].filter(Boolean).join(" · ") || "bez kontaktu"}
          </div>
        </div>
      </div>

      <Role theme={theme} ciselniky={ciselniky} personId={o.id}
        puvodni={o.role_tagy || []} />

      {/* Shrnutí jednou větou — co odpovědět do telefonu */}
      <div style={{
        ...card(theme), padding: "10px 12px", marginBottom: 12,
        fontSize: "12px", color: theme.text, lineHeight: 1.7,
      }}>
        {ucast.length === 0 && osloveni.length === 0 && d.karty.length === 0 ? (
          <span style={{ color: theme.textSub }}>
            Zatím s ním nic obchodního neběží. V Mapě na něj
            {d.zaznamy.length > 0 ? ` je ${d.zaznamy.length} poznámek.` : " zatím nic není."}
          </span>
        ) : (
          <>
            {ucast.length > 0 && (
              <>Je na <strong>{ucast.length}</strong> {ucast.length === 1 ? "zakázce" : "zakázkách"}. </>
            )}
            {zive.length > 0 && (
              <>Rozjednáno má <strong style={{ color: theme.accent }}>{zive.length}</strong>. </>
            )}
            {posledni && (
              <>Naposledy {jakDavno(posledni.happened_at)}.</>
            )}
          </>
        )}
      </div>

      {ucast.length > 0 && (
        <Sekce theme={theme} nadpis="Na kterých zakázkách je">
          {ucast.map(u => (
            <Zakazka key={u.id} theme={theme} ciselniky={ciselniky} p={u.projekt}
              onOtevri={onOtevriZakazku}
              vpravo={u.podil != null ? `${u.podil} %` : null}
              podtext={[
                popis(ciselniky, "role", u.role),
                u.forma_dohody ? popis(ciselniky, "forma_dohody", u.forma_dohody) : null,
                u.poznamka,
              ].filter(Boolean).join(" · ")} />
          ))}
        </Sekce>
      )}

      {osloveni.length > 0 && (
        <Sekce theme={theme} nadpis="Co jsem mu nabídl">
          {osloveni.map(a => {
            const konec = ["odmitl", "ticho"].includes(a.stav);
            return (
              <Zakazka key={a.id} theme={theme} ciselniky={ciselniky} p={a.projekt}
                onOtevri={onOtevriZakazku}
                skrtnuto={konec}
                vpravo={a.cena_jednana ? penizeKratce(a.cena_jednana) : null}
                stav={popis(ciselniky, "stav_osloveni", a.stav)}
                stavBarva={a.stav === "dohodnuto" ? theme.green : konec ? theme.textSub : theme.accent}
                podtext={[
                  a.aktualne ? `${a.aktualne} · ${jakDavno(a.aktualne_at)}` : `osloven ${datumKratce(a.odeslano_at)}`,
                  a.pripominka_at ? `⏰ ${datumKratce(a.pripominka_at)}` : null,
                ].filter(Boolean).join("  ·  ")} />
            );
          })}
        </Sekce>
      )}

      {d.karty.length > 0 && (
        <Sekce theme={theme} nadpis="Co hledá a co má">
          {d.karty.map(k => (
            <div key={k.id} style={{
              ...card(theme), padding: "8px 11px", marginBottom: 6,
              opacity: k.aktivni ? 1 : 0.5,
            }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: theme.text }}>
                {k.smer === "poptavka" ? "Hledá" : "Má kolem sebe"}
                {k.nazev && (
                  <span style={{ fontWeight: 400, color: theme.textSub, fontSize: "11px" }}>
                    {" "}· {k.nazev}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 2, lineHeight: 1.6 }}>
                {(k.typy || []).length
                  ? k.typy.map(t => popis(ciselniky, "typ", t)).join(", ")
                  : "jakýkoli typ"}
                {" · "}
                {(k.kraje || []).length
                  ? k.kraje.map(t => popis(ciselniky, "kraj", t)).join(", ")
                  : "kdekoli"}
                {k.cena_od ? ` · od ${penizeKratce(k.cena_od)}` : ""}
                {k.cena_do ? ` do ${penizeKratce(k.cena_do)}` : ""}
                {k.velikost_od ? ` · od ${k.velikost_od} ${popis(ciselniky, "jednotka", k.jednotka)}` : ""}
              </div>
              {k.poznamka && (
                <div style={{ fontSize: "11px", color: theme.textMid, marginTop: 2 }}>{k.poznamka}</div>
              )}
            </div>
          ))}
        </Sekce>
      )}

      {d.zaznamy.length > 0 && (
        <Sekce theme={theme} nadpis={`Časová osa (${d.zaznamy.length})`}>
          {d.zaznamy.map(z => (
            <div key={z.id} style={{
              display: "flex", gap: 9, padding: "6px 2px",
              borderBottom: `1px solid ${theme.cardBorder}55`,
            }}>
              <span style={{
                fontSize: "10.5px", color: theme.textSub, minWidth: 62,
                whiteSpace: "nowrap", paddingTop: 1,
              }}>{datumKratce(z.happened_at)}</span>
              <span style={{ flex: 1, fontSize: "12px", color: theme.text, lineHeight: 1.6 }}>
                {z.content}
                {z.projekt && (
                  <span style={{ color: theme.textSub, fontSize: "11px" }}>
                    {" "}· {z.projekt.kod}
                  </span>
                )}
                {z.context && (
                  <span style={{ color: theme.textMid, fontSize: "11px" }}> · {z.context}</span>
                )}
              </span>
            </div>
          ))}
        </Sekce>
      )}

      {o.note && (
        <div style={{ fontSize: "11.5px", color: theme.textMid, marginTop: 12, lineHeight: 1.7 }}>
          {o.note}
        </div>
      )}
    </div>
  );
}

function Zakazka({ theme, ciselniky, p, podtext, vpravo, stav, stavBarva, skrtnuto, onOtevri }) {
  if (!p) return null;
  return (
    <div onClick={() => onOtevri?.(p)} style={{
      ...card(theme), padding: "8px 11px", marginBottom: 6,
      display: "flex", alignItems: "center", gap: 9,
      cursor: onOtevri ? "pointer" : "default",
      opacity: skrtnuto ? 0.55 : 1,
    }}>
      <span style={{
        fontSize: "10px", fontWeight: 700, color: theme.textSub, whiteSpace: "nowrap",
      }}>{p.kod}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: "12.5px", fontWeight: 700, color: theme.text,
          textDecoration: skrtnuto ? "line-through" : "none",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{p.nazev}</div>
        <div style={{ fontSize: "11px", color: theme.textSub, marginTop: 1 }}>
          {[
            popis(ciselniky, "typ", p.typ),
            [p.mesto, popis(ciselniky, "kraj", p.kraj)].filter(Boolean).join(", "),
            podtext,
          ].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <div style={{ fontSize: "12.5px", fontWeight: 700, color: theme.text }}>
          {vpravo || penizeKratce(p.cena)}
        </div>
        {stav && (
          <div style={{ fontSize: "10px", color: stavBarva || theme.textSub, marginTop: 1 }}>
            {stav}
          </div>
        )}
      </div>
    </div>
  );
}

function Sekce({ theme, nadpis, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ ...label(theme), marginBottom: 6 }}>{nadpis}</div>
      {children}
    </div>
  );
}

/* Role člověka — čím ti je obecně. Mění se rovnou tady, aby se
   kvůli přeřazení nemuselo otvírat nic dalšího. */
function Role({ theme, ciselniky, personId, puvodni }) {
  const [role, setRole] = useState(puvodni);
  const [uprava, setUprava] = useState(false);
  const [uklada, setUklada] = useState(false);

  const prepni = async (k) => {
    const nove = role.includes(k) ? role.filter(x => x !== k) : [...role, k];
    setRole(nove);
    setUklada(true);
    await ulozRole(personId, nove);
    setUklada(false);
  };

  if (!uprava) {
    return (
      <div onClick={() => setUprava(true)} title="Upravit role"
        style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10, cursor: "pointer" }}>
        {role.length === 0 ? (
          <span style={{ fontSize: "11px", color: theme.yellow }}>+ čím ti je</span>
        ) : role.map(r => (
          <span key={r} style={{
            fontSize: "10.5px", fontWeight: 700, color: theme.textSub,
            border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: "2px 8px",
          }}>{popis(ciselniky, "role", r)}</span>
        ))}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <span style={label(theme)}>
        Čím ti je{uklada ? " · ukládám…" : ""}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        {aktivni(ciselniky, "role").map(r => {
          const zap = role.includes(r.key);
          return (
            <button key={r.key} onClick={() => prepni(r.key)} style={{
              ...btn(),
              background: zap ? theme.accentSoft : "transparent",
              border: `1px solid ${zap ? theme.accentBorder : theme.cardBorder}`,
              color: zap ? theme.accent : theme.textSub,
              fontSize: "11.5px", padding: "4px 9px", borderRadius: 14,
              fontWeight: zap ? 700 : 600,
            }}>{r.label}</button>
          );
        })}
        <button onClick={() => setUprava(false)} style={{
          ...btnGhost(theme), fontSize: "11px", padding: "4px 9px",
        }}>hotovo</button>
      </div>
    </div>
  );
}
