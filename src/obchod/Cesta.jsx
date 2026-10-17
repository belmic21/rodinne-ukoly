/* ════════════════════════════════════════════════════════
   JEDU DO…

   Michal: „když jezdím po republice nebo volám, co kdybych měl
   možnost filtrovat si lidi z mapy? Teď mi napsal kamarád,
   majitel velké firmy z Brna, a to jsem v Brně byl nedávno
   a zapomněl jsem na něj."

   Mapa je obrázek — ukáže, kde máš síť. Ale ve chvíli, kdy sedáš
   do auta, nepotřebuješ obrázek, potřebuješ seznam: kdo je tam,
   kam jedeš, a jak dlouho jsi s ním nemluvil.

   Dvě pole, ne formulář. Kam jedeš je povinné; odkud se vyplní
   samo podle toho, odkud jsi jel naposled, a dá se přepsat.
   Když je vyplněné obojí, nepočítá se vzdálenost od cíle, ale
   od úsečky mezi oběma místy — tedy koho máš po cestě.

   Co tahle obrazovka NEUMÍ a schválně to nepředstírá:

     · Neplánuje trasu. Měří se přímka mezi těžišti okresů,
       ne silnice. Na „koho mám zhruba cestou" to stačí, na
       navigaci ne.
     · Neví o lidech, kteří nemají vyplněné ani město, ani okres,
       ani kraj. Těm ho musíš
       dát — proto je dole vidět, kolika lidem chybí.
   ════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useMemo } from "react";
import { lideSMistem, hledejObce } from "./api.js";
import { kmMeziOkresy, kmOdTrasy } from "./okresy_body.js";

const FONT = '"DM Sans", system-ui, -apple-system, sans-serif';

const btn = () => ({
  fontFamily: FONT, cursor: "pointer", borderRadius: 10,
  border: "none", transition: "background 0.12s ease-out",
});
const pole = (t) => ({
  fontFamily: FONT, fontSize: "14px", padding: "9px 11px",
  borderRadius: 10, border: `1px solid ${t.inputBorder}`,
  background: t.inputBg, color: t.text, outline: "none", width: "100%",
  boxSizing: "border-box",
});
const popisek = (t) => ({
  display: "block", fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
  textTransform: "uppercase", color: t.textSub, marginBottom: 4,
});

/* Jak široký pruh kolem cesty ještě bere. Čtyřicet kilometrů je
   zajížďka, kterou člověk udělá, když za ní někdo stojí; sto už
   je jiný výlet. */
const SIRKY = [
  { km: 25, popis: "25 km" },
  { km: 40, popis: "40 km" },
  { km: 75, popis: "75 km" },
];

function dnu(n) {
  if (n === null || n === undefined) return null;
  const x = Math.round(n);
  return `${x} ${x === 1 ? "den" : x < 5 ? "dny" : "dní"}`;
}

/* Hledání obce. Stejné jako u zakázky — píšeš Brno, vybereš
   z nabídky, uloží se kód i okres. */
function VyberObce({ theme, hodnota, onVyber, placeholder, popis }) {
  const [dotaz, setDotaz] = useState("");
  const [nalezene, setNalezene] = useState([]);
  const [otevreno, setOtevreno] = useState(false);

  useEffect(() => {
    if (dotaz.trim().length < 2) { setNalezene([]); return; }
    let zrus = false;
    const id = setTimeout(() => {
      hledejObce(dotaz, 8).then(r => { if (!zrus) setNalezene(r || []); });
    }, 160);
    return () => { zrus = true; clearTimeout(id); };
  }, [dotaz]);

  return (
    <div style={{ position: "relative" }}>
      <span style={popisek(theme)}>{popis}</span>
      {hodnota ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "9px 11px", borderRadius: 10,
          border: `1px solid ${theme.accentBorder}`, background: theme.accentSoft,
        }}>
          <span style={{ flex: 1, fontSize: "14px", fontWeight: 500, color: theme.text }}>
            {hodnota.nazev}
          </span>
          <button onClick={() => { onVyber(null); setDotaz(""); }}
            title="Vybrat jinou obec" aria-label="Vybrat jinou obec"
            style={{
              ...btn(), padding: "2px 8px", fontSize: "15px",
              background: "transparent", color: theme.textSub,
            }}>×</button>
        </div>
      ) : (
        <>
          <input value={dotaz} placeholder={placeholder}
            onChange={e => { setDotaz(e.target.value); setOtevreno(true); }}
            onFocus={() => setOtevreno(true)}
            style={pole(theme)} />
          {otevreno && nalezene.length > 0 && (
            <div style={{
              position: "absolute", left: 0, right: 0, top: "100%", zIndex: 5,
              marginTop: 3, background: theme.card,
              border: `1px solid ${theme.cardBorder}`, borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)", overflow: "hidden",
              maxHeight: 230, overflowY: "auto",
            }}>
              {nalezene.map(o => (
                <button key={o.kod}
                  onClick={() => { onVyber(o); setOtevreno(false); setDotaz(""); }}
                  style={{
                    ...btn(), display: "block", width: "100%", textAlign: "left",
                    padding: "8px 11px", background: "transparent",
                    fontSize: "13px", color: theme.text, borderRadius: 0,
                  }}>
                  {o.nazev}
                  <span style={{ color: theme.textSub, fontSize: "11px" }}> · {o.okres}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function CestaSheet({ theme, onClose, onOtevriOsobu }) {
  const [lide, setLide] = useState([]);
  const [nacitam, setNacitam] = useState(true);
  const [kam, setKam] = useState(null);
  const [odkud, setOdkud] = useState(() => {
    try {
      const s = localStorage.getItem("cesta_odkud");
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const [sirka, setSirka] = useState(40);

  useEffect(() => {
    let zrus = false;
    lideSMistem().then(r => { if (!zrus) { setLide(r || []); setNacitam(false); } });
    return () => { zrus = true; };
  }, []);

  // Odkud jezdíš, se nemění každý den — ať se to nevypisuje pořád.
  useEffect(() => {
    try {
      if (odkud) localStorage.setItem("cesta_odkud", JSON.stringify(odkud));
      else localStorage.removeItem("cesta_odkud");
    } catch { /* soukromé okno, nevadí */ }
  }, [odkud]);

  /* Kdo nemá ani kraj, ten o sobě neřekl vůbec nic a do „Jedu
     do…" se dostat nemůže. Lidé, kteří mají jen kraj, se sem
     dostanou — jen bez kilometrů, viz vKraji níž. */
  const bezMista = useMemo(() => lide.filter(p => !p.kraj && !p.okres).length, [lide]);

  const nalezeni = useMemo(() => {
    if (!kam) return [];
    return lide
      .filter(p => p.okres)
      .map(p => {
        /* Když známe start, měří se vzdálenost od úsečky — koho máš
           po cestě. Bez startu prostě vzdálenost od cíle. */
        const km = odkud
          ? kmOdTrasy(odkud.okres, kam.okres, p.okres)
          : kmMeziOkresy(kam.okres, p.okres);
        const ticho = p.posledni_dotyk
          ? Math.floor((Date.now() - new Date(p.posledni_dotyk).getTime()) / 86400000)
          : null;
        return { ...p, km, ticho };
      })
      .filter(p => p.km !== null && p.km <= sirka)
      /* Nejdřív ten, s kým jsi nejdéle nemluvil. Pořadí podle
         vzdálenosti by vedlo seznam od lidí, které stejně vidíš
         pořád — a to je přesně ta chyba, kvůli které se na
         kamaráda z Brna zapomene. */
      .sort((a, b) => (b.ticho ?? 99999) - (a.ticho ?? 99999));
  }, [lide, kam, odkud, sirka]);

  /* ══ JEN KRAJ, BEZ OKRESU ══
     U spousty lidí víš jen „někde na Karlovarsku". Kilometry se
     z kraje spočítat nedají — kraj je velký a těžiště okresu je
     to jediné, co mapa zná. Vyhodit je ale nejde: právě na ně se
     zapomíná. Tak stojí v samostatném, kratším bloku: ne „je 12 km
     po cestě", ale „je někde v kraji, kterým pojedeš". */
  const vKraji = useMemo(() => {
    if (!kam?.kraj) return [];
    const kraje = new Set([kam.kraj, odkud?.kraj].filter(Boolean));
    return lide
      .filter(p => !p.okres && p.kraj && kraje.has(p.kraj))
      .map(p => ({
        ...p,
        ticho: p.posledni_dotyk
          ? Math.floor((Date.now() - new Date(p.posledni_dotyk).getTime()) / 86400000)
          : null,
      }))
      .sort((a, b) => (b.ticho ?? 99999) - (a.ticho ?? 99999))
      .slice(0, 8);
  }, [lide, kam, odkud]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(15,23,42,0.55)", display: "flex",
      alignItems: "flex-start", justifyContent: "center",
      padding: "18px 12px", overflowY: "auto",
    }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Jedu do"
        style={{
          width: "100%", maxWidth: 620, marginTop: "3vh", marginBottom: "4vh",
          background: theme.card, border: `1.5px solid ${theme.cardBorder}`,
          borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.3)", overflow: "hidden",
        }}>

        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "14px 16px 12px", borderBottom: `1px solid ${theme.cardBorder}`,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "17px", fontWeight: 700, color: theme.text }}>Jedu do…</div>
            <div style={{ fontSize: "12px", color: theme.textSub, marginTop: 2 }}>
              Komu se ozvat, když tam stejně budeš.
            </div>
          </div>
          <button onClick={onClose} title="Zavřít" aria-label="Zavřít okno"
            style={{
              ...btn(), width: 34, height: 34, padding: 0, fontSize: 20,
              background: "transparent", color: theme.textSub,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>×</button>
        </div>

        <div style={{ padding: "14px 16px" }}>
          <div style={{
            display: "grid", gap: 10, marginBottom: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}>
            <VyberObce theme={theme} popis="Kam jedeš" placeholder="Brno"
              hodnota={kam} onVyber={setKam} />
            <VyberObce theme={theme} popis="Odkud (kvůli tomu, co máš po cestě)"
              placeholder="Mladá Boleslav" hodnota={odkud} onVyber={setOdkud} />
          </div>

          {kam && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <span style={{ fontSize: "11.5px", color: theme.textSub }}>
                {odkud ? "zajížďka nejvýš" : "do vzdálenosti"}
              </span>
              {SIRKY.map(v => {
                const zap = sirka === v.km;
                return (
                  <button key={v.km} onClick={() => setSirka(v.km)}
                    title={odkud
                      ? `Lidé do ${v.popis} od přímé cesty`
                      : `Lidé do ${v.popis} od cíle`}
                    aria-label={v.popis} aria-pressed={zap}
                    style={{
                      ...btn(), padding: "5px 12px", fontSize: "12px", fontWeight: zap ? 700 : 500,
                      background: zap ? theme.accent : "transparent",
                      color: zap ? "#fff" : theme.textSub,
                      border: `1px solid ${zap ? theme.accent : theme.cardBorder}`,
                      borderRadius: 16,
                    }}>{v.popis}</button>
                );
              })}
            </div>
          )}

          {!kam ? (
            <div style={{ fontSize: "12.5px", color: theme.textSub, lineHeight: 1.7, padding: "6px 0" }}>
              Napiš, kam jedeš. Ukážu lidi, které tam máš, a seřadím je
              podle toho, jak dlouho jsi s nimi nemluvil.
              {odkud && <><br />Odkud jedeš si pamatuju, takže stačí doplnit cíl.</>}
            </div>
          ) : nacitam ? (
            <div style={{ fontSize: "12px", color: theme.textSub, padding: "6px 0" }}>Načítám…</div>
          ) : nalezeni.length === 0 ? (
            <div style={{ fontSize: "12.5px", color: theme.textSub, lineHeight: 1.7, padding: "6px 0" }}>
              {odkud
                ? `Na trase ${odkud.nazev} → ${kam.nazev} nikoho nemáš — aspoň ne do ${sirka} km od ní.`
                : `Do ${sirka} km od cíle ${kam.nazev} nikoho nemáš.`}
              {bezMista > 0 && <><br />Ale {bezMista} {bezMista === 1 ? "člověk nemá" : bezMista < 5 ? "lidé nemají" : "lidí nemá"} vyplněné místo — ti se sem dostat nemůžou.</>}
            </div>
          ) : (
            <>
              <div style={{ fontSize: "11.5px", color: theme.textSub, marginBottom: 7 }}>
                {nalezeni.length} {nalezeni.length === 1 ? "člověk" : nalezeni.length < 5 ? "lidé" : "lidí"}
                {odkud ? ` po cestě ${odkud.nazev} → ${kam.nazev}` : ` do ${sirka} km od cíle ${kam.nazev}`}
                {" "}· nejdéle nekontaktovaní první
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {nalezeni.map(p => (
                  <button key={p.person_id}
                    onClick={() => onOtevriOsobu?.(p.person_id)}
                    title={`Otevřít ${p.name}`}
                    aria-label={`Otevřít ${p.name}`}
                    style={{
                      ...btn(), display: "flex", alignItems: "center", gap: 10,
                      width: "100%", textAlign: "left", padding: "9px 10px",
                      background: "transparent",
                    }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        display: "block", fontSize: "13.5px", fontWeight: 500, color: theme.text,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{p.name}</span>
                      <span style={{
                        display: "block", fontSize: "11px", color: theme.textSub,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {p.mesto}
                        {p.contact ? ` · ${p.contact}` : ""}
                      </span>
                    </span>
                    <span style={{ flex: "0 0 auto", textAlign: "right" }}>
                      <span style={{
                        display: "block", fontSize: "11.5px", fontWeight: 500,
                        color: p.ticho === null ? theme.textMid
                             : p.ticho >= 90 ? theme.red
                             : p.ticho >= 30 ? theme.yellow : theme.textSub,
                      }}>
                        {p.ticho === null ? "nikdy nic" : `${dnu(p.ticho)} ticha`}
                      </span>
                      <span style={{ display: "block", fontSize: "10.5px", color: theme.textMid }}>
                        ~{Math.round(p.km)} km
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ══ JEN KRAJ ══
              Lidé, u kterých víš jen kraj. Nemají kilometry a mít
              je nemůžou — kraj je velký. Ale zapomenout se na ně
              smí ještě míň než na ostatní, protože u nich ani
              nevíš, kudy přesně jedeš kolem. */}
          {vKraji.length > 0 && (
            <>
              <div style={{
                fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
                textTransform: "uppercase", color: theme.textSub,
                marginTop: 14, marginBottom: 5,
              }}>Někde v kraji, kterým pojedeš</div>
              <div style={{
                border: `1px solid ${theme.cardBorder}`, borderRadius: 10,
                overflow: "hidden",
              }}>
                {vKraji.map(p => (
                  <button key={p.person_id}
                    onClick={() => onOtevriOsobu?.(p.person_id)}
                    title={`Otevřít ${p.name}`}
                    aria-label={`Otevřít ${p.name}`}
                    style={{
                      ...btn(), display: "flex", alignItems: "center", gap: 10,
                      width: "100%", textAlign: "left", padding: "9px 10px",
                      background: "transparent",
                    }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        display: "block", fontSize: "13.5px", fontWeight: 500, color: theme.text,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{p.name}</span>
                      <span style={{
                        display: "block", fontSize: "11px", color: theme.textSub,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {p.firma || p.contact || "bez bližšího místa"}
                      </span>
                    </span>
                    <span style={{
                      flex: "0 0 auto", fontSize: "11.5px", fontWeight: 500,
                      color: p.ticho === null ? theme.textMid
                           : p.ticho >= 90 ? theme.red
                           : p.ticho >= 30 ? theme.yellow : theme.textSub,
                    }}>
                      {p.ticho === null ? "nikdy nic" : `${dnu(p.ticho)} ticha`}
                    </span>
                  </button>
                ))}
              </div>
              <div style={{ fontSize: "10.5px", color: theme.textMid, marginTop: 5 }}>
                U nich znáš jen kraj, takže kilometry nejsou. Doplň jim
                okres nebo město a příště vyskočí mezi ostatními.
              </div>
            </>
          )}

          {/* Dvě věty, které tahle obrazovka dluží každému, kdo jí
              má věřit: odkud se čísla berou a koho v nich nenajde. */}
          <div style={{
            marginTop: 14, paddingTop: 10, borderTop: `1px solid ${theme.cardBorder}`,
            fontSize: "11px", color: theme.textMid, lineHeight: 1.6,
          }}>
            Kilometry jsou vzdušnou čarou mezi okresy, ne po silnici — ber je jako „zhruba".
            {bezMista > 0 && nalezeni.length > 0 && (
              <> Dalších {bezMista} {bezMista === 1 ? "člověk nemá" : bezMista < 5 ? "lidé nemají" : "lidí nemá"} vyplněné místo, takže se sem nedostanou.</>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
