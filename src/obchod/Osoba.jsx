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
import { osobaPrehled, popis, nactiCiselniky } from "./api.js";
import { KontaktEditor } from "./Site.jsx";
import {
  card, btn, label,
  penizeKratce, datumKratce, jakDavno,
} from "./ui.js";

export default function Osoba({ theme, owner, personId, ciselniky, onZpet, onOtevriZakazku }) {
  const [jmeno, setJmeno] = useState(null);
  return (
    <div style={{ padding: "12px 16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button onClick={onZpet} title="Zpět" style={{
          ...btn(), background: "transparent", color: theme.textSub,
          fontSize: "15px", padding: "2px 6px",
        }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: theme.text }}>
            {jmeno?.name || "Člověk"}
          </div>
          <div style={{ fontSize: "11.5px", color: theme.textSub, marginTop: 1 }}>
            {[jmeno?.contact, jmeno?.met_at].filter(Boolean).join(" · ") || "bez kontaktu"}
          </div>
        </div>
      </div>
      <ObchodUOsoby theme={theme} owner={owner} personId={personId}
        ciselniky={ciselniky} onOtevriZakazku={onOtevriZakazku}
        onNacteno={setJmeno} />
    </div>
  );
}

/* Obchodní část karty člověka, bez vlastní hlavičky.

   Schválně oddělená: stejný obsah se ukazuje jednak tady v Obchodu,
   jednak ve staré kartě z Mapy. Jinak by jedno místo vědělo o zakázkách
   a druhé ne — a to byla přesně ta past, kdy sis otevřel Davida přes
   lupu a viděl u něj prázdno, i když má rozjednané dvě zakázky.

   `sOsou` vypni tam, kde už časová osa je (karta v Mapě si ji
   vypisuje sama), ať tam není dvakrát. */
export function ObchodUOsoby({ theme, owner, personId, ciselniky: ciselnikyProp,
  onOtevriZakazku, onNacteno, sOsou = true }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(true);
  const [vlastni, setVlastni] = useState({});
  const [upravuji, setUpravuji] = useState(false);

  // Číselníky si umí načíst sama. Karta v Mapě o nich nic neví
  // a bez nich by se místo "Rodinný dům" ukazovalo "rodinny_dum".
  const ciselniky = ciselnikyProp && Object.keys(ciselnikyProp).length
    ? ciselnikyProp : vlastni;

  useEffect(() => {
    if (ciselnikyProp && Object.keys(ciselnikyProp).length) return;
    if (!owner) return;
    let zrus = false;
    nactiCiselniky(owner).then(c => { if (!zrus) setVlastni(c); });
    return () => { zrus = true; };
  }, [owner, ciselnikyProp]);

  useEffect(() => {
    let zrus = false;
    setBusy(true);
    osobaPrehled(owner, personId).then(r => {
      if (zrus) return;
      setD(r); setBusy(false);
      onNacteno?.(r?.osoba || null);
    });
    return () => { zrus = true; };
  }, [owner, personId]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (busy) {
    return <div style={{ padding: "8px 2px", fontSize: "12px", color: theme.textSub }}>Načítám…</div>;
  }
  if (!d?.osoba) {
    return (
      <div style={{ fontSize: "12px", color: theme.textSub, padding: "8px 2px" }}>
        Tenhle člověk se nenašel.
      </div>
    );
  }

  const o = d.osoba;
  // Bez navázané zakázky není co ukázat; jinak by zůstal viset prázdný nadpis.
  const ucast = d.ucast.filter(x => x.projekt);
  const osloveni = d.osloveni.filter(x => x.projekt);
  const zive = osloveni.filter(x => !["odmitl", "ticho", "dohodnuto"].includes(x.stav));
  const posledni = d.zaznamy[0];

  if (upravuji) {
    return (
      <KontaktEditor theme={theme} owner={owner} ciselniky={ciselniky} osoba={o}
        onHotovo={(novy) => {
          setUpravuji(false);
          setD(p => ({ ...p, osoba: { ...p.osoba, ...novy } }));
          onNacteno?.(novy);
        }}
        onZrus={() => setUpravuji(false)} />
    );
  }

  return (
    <>
      {/* Role a tužka na jednom řádku. Tužka otvírá ten samý editor
          jako Síť i Mapa — jiný už v aplikaci není. */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
        {(o.role_tagy || []).length === 0 ? (
          <span onClick={() => setUpravuji(true)}
            style={{ fontSize: "11px", color: theme.yellow, cursor: "pointer" }}>
            + čím ti je
          </span>
        ) : (o.role_tagy || []).map(r => (
          <span key={r} style={{
            fontSize: "10.5px", fontWeight: 700, color: theme.textSub,
            border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: "2px 8px",
          }}>{popis(ciselniky, "role", r)}</span>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={() => setUpravuji(true)} title="Upravit kontakt" style={{
          ...btn(), background: "transparent", color: theme.textSub,
          fontSize: "12px", padding: "2px 6px",
        }}>✎ upravit</button>
      </div>

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

      {sOsou && d.zaznamy.length > 0 && (
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

      {sOsou && o.note && (
        <div style={{ fontSize: "11.5px", color: theme.textMid, marginTop: 12, lineHeight: 1.7 }}>
          {o.note}
        </div>
      )}
    </>
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
