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

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  prehledLidi, zanedbani, popis, aktivni,
  rozeberOsobu, rozeberKontakty, oznacDuplicity, doCekarny, cekarnaPocty,
  popisSloupcu,
  hromadnaRole, hromadnaOblast, nactiKarty, lideKDoplneni,
  zalozOsobu, prehledStavuLidi, hledejObce,
} from "./api.js";
import { KontaktEditor } from "./Site.jsx";
import { VlnaCekarna, VlnaKriterii } from "./Vlny.jsx";
import { card, input, btn, btnMain, btnGhost, label, zvyrazni, pocet } from "./ui.js";
import { sesit, stahni } from "./xlsx.js";

/* Řazení. Abeceda je na hledání konkrétního člověka, zbytek
   na otázku „s kým můžu dneska pracovat“. */
const RAZENI = [
  { k: "sedi",     t: "má co nabídnout" },
  { k: "abeceda",  t: "podle abecedy" },
  { k: "zanedbani", t: "dlouho neoslovení" },
];

/* ── Rychlé zadání člověka a import ──────────────────────
   Michal: „jejich třídění, přiřazování, párování… aby byla práce
   intuitivní, snadná a rychlá."

   Zadávání bylo ten skutečný brzdič: zakázku hodíš jednou větou,
   člověka jsi musel proklikat formulářem. Tady je jeden řádek
   a pod ním vidíš, co z toho aplikace pochopila — stejně jako
   u rychlého tipu.

   Vedle je import, protože pár set kontaktů se jednou větou
   nezadává. Čte vCard z telefonu i CSV z tabulky. */
function RychlyClovek({ theme, owner, ciselniky, stavajici, onHotovo }) {
  const [text, setText] = useState("");
  const [uklada, setUklada] = useState(false);
  const [hlaska, setHlaska] = useState(null);
  const [chyba, setChyba] = useState(null);
  const [nahled, setNahled] = useState(null);   // import: co se našlo v souboru
  const [jmenoSouboru, setJmenoSouboru] = useState("");
  const [sloupce, setSloupce] = useState(null);
  const [berDuplicity, setBerDuplicity] = useState(false);
  // Kolik právě spadlo do čekárny — podklad pro nabídku „protřídit teď".
  const [doCekarnySlo, setDoCekarnySlo] = useState(0);
  // Kolik se přeskočilo, protože už v čekárně byly.
  const [preskoceno, setPreskoceno] = useState(0);
  const souborRef = useRef(null);

  const rozbor = useMemo(
    () => (text.trim() ? rozeberOsobu(text, ciselniky) : null),
    [text, ciselniky]);

  /* ══ MÍSTO ZA ČÁRKOU ══
     Co zůstalo za čárkou a není telefon, mail, role ani „od koho",
     se zkusí najít v číselníku obcí. Najde-li se, uloží se rovnou
     jako město i s okresem a krajem — ten člověk pak vyskočí
     v „Jedu do…". Nenajde-li se, nic se nehádá: zůstane vidět,
     že se to nepovedlo, a jméno se tím nezašpiní. */
  const [misto, setMisto] = useState(null);
  const [hledamMisto, setHledamMisto] = useState(false);
  useEffect(() => {
    const dotaz = rozbor?.mistoText;
    if (!dotaz || dotaz.length < 2) { setMisto(null); setHledamMisto(false); return; }
    let zrus = false;
    setHledamMisto(true);
    const id = setTimeout(() => {
      hledejObce(dotaz, 5).then(n => {
        if (zrus) return;
        const bez = (x) => (x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        // Jen přesná shoda názvu. „Čistá" se nesmí tiše stát „Čistou u Horek".
        const presne = (n || []).find(o => bez(o.nazev) === bez(dotaz));
        setMisto(presne || null);
        setHledamMisto(false);
      });
    }, 200);
    return () => { zrus = true; clearTimeout(id); };
  }, [rozbor?.mistoText]);

  const uloz = async () => {
    if (!rozbor?.name) return;
    setUklada(true); setChyba(null);
    const res = await zalozOsobu(owner, {
      name: rozbor.name,
      contact: rozbor.contact || null,
      role_tagy: rozbor.role || [],
      // Místo jen když se opravdu našlo v číselníku. Nenašlo-li se,
      // radši prázdno než vymyšlená obec — viz MistoOsoby v Síti.
      kraj: misto?.kraj || null,
      okres: misto?.okres || null,
      mesto: misto?.nazev || null,
      mesto_kod: misto?.kod || null,
      // Od koho to vím patří k člověku stejně jako u tipu —
      // za půl roku je to jediné, co o něm ještě budeš vědět.
      note: rozbor.odKoho ? `Seznámil nás: ${rozbor.odKoho}` : null,
    });
    setUklada(false);
    if (!res.ok) { setChyba(res.chyba || "Nepovedlo se uložit."); return; }
    /* Člověk se uložil, ale místo ne — v databázi na něj ještě není
       sloupec. Mlčet by znamenalo nechat Michala v domnění, že ho
       „Jedu do…" najde. */
    if (res.vynechano && misto) {
      setChyba(`${rozbor.name} je uložený, ale místo „${misto.nazev}" ne — v databázi chybí sloupce. `
             + "Pusť skript misto_261017_0800.sql a místo pak doplň u člověka.");
    }
    setHlaska(rozbor.name);
    setText("");
    onHotovo?.();
    setTimeout(() => setHlaska(null), 4000);
  };

  const nactiSoubor = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setChyba(null); setJmenoSouboru(f.name);
    try {
      const obsah = await f.text();
      const nalezeni = rozeberKontakty(obsah, f.name);
      /* U CSV ukazujeme, který sloupec se bere na co. Export
         kontaktů má přes dvacet sloupců a z náhledu jmen není
         poznat, že se telefon vzal ze špatného — to se pozná až
         po protřídění, kdy je pozdě. vCard žádné sloupce nemá. */
      setSloupce(/\.vcf$/i.test(f.name) ? null : popisSloupcu(obsah));
      if (!nalezeni.length) {
        setChyba("V souboru jsem nenašel žádné kontakty se jménem. Čtu vCard (.vcf) a CSV.");
        setNahled(null);
      } else {
        setNahled(oznacDuplicity(nalezeni, stavajici || []));
      }
    } catch (err) {
      setChyba("Soubor se nepodařilo přečíst.");
    }
    // Aby šel stejný soubor vybrat podruhé.
    if (souborRef.current) souborRef.current.value = "";
  };

  const kImportu = (nahled || []).filter(x => berDuplicity || !x.duplicita);
  const duplicit = (nahled || []).filter(x => x.duplicita).length;

  /* ══ IMPORT JDE DO ČEKÁRNY, NE ROVNOU MEZI LIDI ══
     Michal: „celá databáze obsahuje rodinu atd."

     Osm set kontaktů z telefonu mezi obchodní kontakty nepatří
     a ruční promazávání je práce na odpoledne, navíc nevratná.
     Import proto spadne do čekárny a odtud si je protřídíš
     vlnou — jedna klávesa na kontakt. */
  const importuj = async () => {
    setUklada(true); setChyba(null);
    const res = await doCekarny(owner, kImportu, jmenoSouboru);
    setUklada(false);
    if (!res.ok) { setChyba(res.chyba || "Import se nepovedl."); return; }
    setNahled(null);
    setDoCekarnySlo(res.pocet);
    setPreskoceno(res.preskoceno || 0);
    onHotovo?.();
  };

  const znacka = (co, hodnota) => (
    <span style={{
      fontSize: 11.5, fontWeight: 400, color: theme.textSub,
      background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
      borderRadius: 7, padding: "3px 8px", whiteSpace: "nowrap",
    }}>{co} <strong style={{ fontWeight: 500, color: theme.text }}>{hodnota}</strong></span>
  );

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
        <input
          value={text}
          onChange={e => { setText(e.target.value); setChyba(null); }}
          onKeyDown={e => { if (e.key === "Enter" && rozbor?.name && !uklada) uloz(); }}
          placeholder="Ondřej Fer, 603 123 456, investor, Brno, od Davida"
          title="Nový člověk jednou větou: jméno, pak za čárkami telefon, mail, role, město, od koho. Co z toho pochopím, uvidíš hned pod polem."
          aria-label="Rychlé zadání člověka jednou větou"
          style={{ ...input(theme), flex: "1 1 240px" }} />
        <button onClick={uloz} disabled={!rozbor?.name || uklada}
          title={rozbor?.name ? `Založit člověka „${rozbor.name}"` : "Nejdřív napiš jméno"}
          aria-label="Založit člověka"
          style={{
            ...btnMain(theme), minHeight: 40, padding: "0 15px", whiteSpace: "nowrap",
            background: rozbor?.name ? theme.accent : theme.inputBg,
            color: rozbor?.name ? "#fff" : theme.textSub,
          }}>{uklada ? "UKLÁDÁM…" : "+ ČLOVĚK"}</button>
        <button onClick={() => souborRef.current?.click()}
          title="Načíst kontakty ze souboru — vCard (.vcf) z telefonu nebo CSV z tabulky"
          aria-label="Import kontaktů ze souboru"
          style={{ ...btnGhost(theme), minHeight: 40, whiteSpace: "nowrap" }}>Import</button>
        <input ref={souborRef} type="file" accept=".vcf,.csv,.tsv,.txt,text/*"
          onChange={nactiSoubor} style={{ display: "none" }} />
      </div>

      {/* Co jsem pochopil — PŘED uložením, ne po něm. */}
      {rozbor && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
          {znacka("jméno", rozbor.name || "—")}
          {rozbor.contact && znacka("kontakt", rozbor.contact)}
          {rozbor.role?.length > 0 && znacka("role",
            rozbor.role.map(r => popis(ciselniky, "role", r)).join(", "))}
          {rozbor.odKoho && znacka("od", rozbor.odKoho)}
          {misto && znacka("místo", `${misto.nazev}${misto.okres ? ` · okres ${popis(ciselniky, "okres", misto.okres)}` : ""}`)}
          {rozbor.mistoText && !misto && !hledamMisto && (
            <span style={{
              fontSize: 11.5, color: theme.yellow,
              background: `${theme.yellow}12`, border: `1px solid ${theme.yellow}44`,
              borderRadius: 7, padding: "3px 8px",
            }}>
              „{rozbor.mistoText}" není v číselníku obcí — doplň místo u člověka ručně
            </span>
          )}
        </div>
      )}

      {/* ── NÁHLED IMPORTU ──
          Nic se nenahrává naslepo. Nejdřív se ukáže, co se v souboru
          našlo a kolik z toho už v databázi je. */}
      {nahled && (
        <div style={{
          ...card(theme), padding: "11px 12px", marginTop: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: theme.text, marginBottom: 2 }}>
            V souboru {jmenoSouboru} je {nahled.length} {nahled.length === 1 ? "kontakt" : nahled.length < 5 ? "kontakty" : "kontaktů"}.
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 400, color: theme.textSub, marginBottom: 8 }}>
            {duplicit > 0
              ? `${duplicit} z nich už v Lidech ${duplicit === 1 ? "je" : "jsou"} — shoduje se telefonní číslo. Jmenovce za duplicitu nepovažuju.`
              : "Žádný z nich u sebe zatím nemáš."}
          </div>

          {sloupce && sloupce.length > 0 && (
            <div style={{
              fontSize: 11, color: theme.textSub, marginBottom: 9,
              padding: "7px 9px", borderRadius: 8,
              background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
            }}>
              <div style={{ marginBottom: 3, color: theme.textMid }}>Ze kterých sloupců to beru:</div>
              {sloupce.map(x => (
                <div key={x.co} style={{ display: "flex", gap: 6 }}>
                  <span style={{ minWidth: 62, color: theme.textMid }}>{x.co}</span>
                  <span style={{ color: theme.text }}>{x.z.join(" + ")}</span>
                </div>
              ))}
              <div style={{ marginTop: 4, color: theme.textMid }}>
                Sedí to? Když ne, napiš mi — soubor zatím nikam nejde.
              </div>
            </div>
          )}

          <div style={{
            maxHeight: 190, overflowY: "auto", display: "flex",
            flexDirection: "column", gap: 3, marginBottom: 9,
          }}>
            {nahled.slice(0, 200).map((x, i) => (
              <div key={i} style={{
                display: "flex", gap: 7, alignItems: "baseline",
                fontSize: 12, padding: "3px 0",
                opacity: x.duplicita && !berDuplicity ? 0.45 : 1,
              }}>
                <span style={{ fontWeight: 500, color: theme.text }}>{x.name}</span>
                <span style={{ flex: 1, minWidth: 0, color: theme.textSub, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.contact}</span>
                {x.duplicita && (
                  <span style={{ flex: "0 0 auto", fontSize: 10.5, color: theme.yellow }}>už mám</span>
                )}
              </div>
            ))}
            {nahled.length > 200 && (
              <div style={{ fontSize: 11.5, color: theme.textSub }}>
                …a dalších {nahled.length - 200}. Naimportují se všichni.
              </div>
            )}
          </div>

          {duplicit > 0 && (
            <label style={{
              display: "flex", alignItems: "center", gap: 7, marginBottom: 9,
              fontSize: 12, color: theme.text, cursor: "pointer",
            }}>
              <input type="checkbox" checked={berDuplicity}
                onChange={e => setBerDuplicity(e.target.checked)} />
              Vzít i ty, které už mám ({duplicit}) — v čekárně nevadí, rozhodneš u nich sám
            </label>
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={importuj} disabled={uklada || kImportu.length === 0}
              title={`Uložit ${kImportu.length} kontaktů do čekárny — mezi Lidi se dostanou až po protřídění`}
              aria-label="Uložit do čekárny"
              style={{
                ...btnMain(theme),
                background: kImportu.length ? theme.accent : theme.inputBg,
                color: kImportu.length ? "#fff" : theme.textSub,
              }}>
              {uklada ? "UKLÁDÁM…" : `DO ČEKÁRNY (${kImportu.length})`}</button>
            <button onClick={() => { setNahled(null); setBerDuplicity(false); }}
              title="Zahodit náhled — nic se nezaloží"
              aria-label="Zrušit import"
              style={btnGhost(theme)}>Zrušit</button>
          </div>
        </div>
      )}

      {chyba && <div style={{ marginTop: 6, fontSize: 12, color: theme.red }}>{chyba}</div>}
      {hlaska && (
        <div style={{ marginTop: 6, fontSize: 12, color: theme.green }}>
          Založeno: <strong style={{ fontWeight: 500 }}>{hlaska}</strong>.
        </div>
      )}
      {/* Import nekončí založením člověka, ale uložením do čekárny —
          a musí být hned vidět, co dělat dál. */}
      {(doCekarnySlo > 0 || preskoceno > 0) && (
        <div style={{ marginTop: 6, fontSize: 12, color: theme.green, lineHeight: 1.6 }}>
          <strong style={{ fontWeight: 500 }}>{doCekarnySlo}</strong>{" "}
          {doCekarnySlo === 1 ? "kontakt čeká" : doCekarnySlo < 5 ? "kontakty čekají" : "kontaktů čeká"}
          {" "}v čekárně. Protřídíš je tlačítkem nahoře — mezi Lidi se dostanou až odtud.
          {preskoceno > 0 && (
            <span style={{ color: theme.textSub }}>
              {" "}({preskoceno}{" "}
              {preskoceno === 1 ? "už tam byl" : preskoceno < 5 ? "už tam byly" : "už tam bylo"},
              {" "}přeskočeno.)
            </span>
          )}
        </div>
      )}
    </div>
  );
}


export default function Lide({ theme, owner, ciselniky, onOtevriOsobu }) {
  const [radky, setRadky] = useState([]);
  const [busy, setBusy] = useState(true);
  const [hledat, setHledat] = useState("");
  const [role, setRole] = useState("");
  const [jak, setJak] = useState("sedi");
  const [novy, setNovy] = useState(false);
  const [obnov, setObnov] = useState(0);
  const [zanedbani_, setZanedbani] = useState([]);
  /* Chytrý seznam. Tři otázky, na které se seznam Lidí dosud
     nedal zeptat, protože odpověď leží ve třech tabulkách. */
  const [seznam, setSeznam] = useState("");
  const [stavy, setStavy] = useState({});
  /* Čekárna. Počty se čtou jedním dotazem — stahovat kvůli
     jednomu číslu osm set řádků by bylo zbytečné. */
  const [cekarna, setCekarna] = useState({ ceka: 0, zarazeno: 0, osobni: 0, odlozeno: 0 });
  const [vlna, setVlna] = useState(null);            // cekarna | developer | investor
  /* Hromadný výběr. Michal: „mohu vyfiltrovat všechny kontakty
     se jménem ENYX, abych jim přiřadil stejný znak?" */
  const [vyber, setVyber] = useState(() => new Set());
  const [hromadnaCo, setHromadnaCo] = useState("");
  const [hromadnaHlaska, setHromadnaHlaska] = useState(null);
  const [hromadneDelam, setHromadneDelam] = useState(false);

  const [pocetKDoplneni, setPocetKDoplneni] = useState({ developer: 0, investor: 0 });

  useEffect(() => {
    if (!owner) return;
    let zrus = false;
    cekarnaPocty().then(c => { if (!zrus) setCekarna(c); });
    /* Kolik lidí čeká na kritéria. Dvě čtení při otevření Lidí —
       levnější než nechat Michala hádat, jestli má co doplňovat. */
    Promise.all([lideKDoplneni(owner, "developer"), lideKDoplneni(owner, "investor")])
      .then(([d, i]) => { if (!zrus) setPocetKDoplneni({ developer: d.length, investor: i.length }); });
    return () => { zrus = true; };
  }, [owner, obnov]);

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
    let vybrane = !q ? radky : radky.filter(r =>
      bez(r.jmeno).includes(q) || bez(r.kontakt).includes(q) || bez(r.poznamka).includes(q)
    );

    /* Chytrý seznam se použije až po hledání, aby šlo obojí
       zároveň — „kdo z Novákových nemá kartu". */
    if (seznam) {
      vybrane = vybrane.filter(r => {
        const st = stavy[r.person_id];
        if (seznam === "bez_karty")   return st ? !st.ma_kartu : true;
        if (seznam === "bez_kontaktu") return st ? !st.ma_kontakt : true;
        if (seznam === "ticho") {
          // Půl roku bez jediného dotyku. Kdo nikdy nic, taky sem.
          if (!st) return true;
          if (!st.posledni_dotyk) return true;
          return (Date.now() - new Date(st.posledni_dotyk).getTime()) / 86400000 > 182;
        }
        return true;
      });
    }
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
  }, [radky, hledat, jak, seznam, stavy]);

  /* Export toho, co je zrovna vidět. Bere stejný filtr jako
     seznam — co vidíš, to stáhneš. Kritéria se dotahují z karet,
     aby v tabulce nebyla jen jména a telefony; podle nich se
     přece rozhoduješ.

     XLSX se skládá vlastním zapisovačem (xlsx.js), ne knihovnou.
     SheetJS váží podle sestavení 100 až 900 kB a u PWA na mobilu
     to není zadarmo. */
  const exportuj = useCallback(async () => {
    const karty = await nactiKarty(owner, {}, 2000);
    const podleOsoby = {};
    for (const k of karty || []) {
      (podleOsoby[k.person_id] = podleOsoby[k.person_id] || []).push(k);
    }
    const hlavicka = ["Jméno", "Role", "Kontakt", "Firma", "Oblast",
      "Směr", "Typy", "Kraje", "Cena od", "Cena do", "Velikost od", "Poznámka"];
    const radkyVen = [hlavicka];
    for (const r of videt) {
      const role = (r.role_tagy || []).map(t => popis(ciselniky, "role", t)).join(", ");
      const jeho = podleOsoby[r.person_id] || [];
      if (jeho.length === 0) {
        radkyVen.push([r.jmeno, role, r.kontakt || "", r.firma || "", r.oblast || "",
          "", "", "", null, null, null, r.poznamka || ""]);
        continue;
      }
      // Jedna karta = jeden řádek. Kdo má dvě, bude v tabulce dvakrát —
      // jinak by se typy dvou různých karet slily do jedné buňky.
      for (const k of jeho) {
        radkyVen.push([
          r.jmeno, role, r.kontakt || "", r.firma || "", r.oblast || "",
          k.smer === "nabidka" ? "má kolem sebe" : "hledá",
          (k.typy || []).map(t => popis(ciselniky, "typ", t)).join(", "),
          (k.kraje || []).map(t => popis(ciselniky, "kraj", t)).join(", "),
          k.cena_od ?? null, k.cena_do ?? null, k.velikost_od ?? null,
          k.poznamka || "",
        ]);
      }
    }
    const den = new Date().toISOString().slice(0, 10);
    stahni(sesit(radkyVen, "Lidé"), `lide-${den}.xlsx`);
  }, [owner, videt, ciselniky]);


  const sKartou = radky.filter(r => r.karet > 0).length;
  const maCoNabidnout = radky.filter(r => r.sedi_zakazek > 0).length;

  if (novy) {
    return (
      <div style={{ padding: "12px 16px 18px" }}>
        <button onClick={() => setNovy(false)} style={{ ...btnGhost(theme), marginBottom: 10 }}>
          ← Zpět na lidi
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
            <div style={{ color: theme.yellow, marginTop: 4, lineHeight: 1.6 }}>
              Nikomu zatím není vyplněné, <strong>co hledá</strong>. Jméno
              a telefon na párování nestačí — otevři člověka a v sekci
              „Co hledá a co má“ mu přidej kartu: typ, kraj, cenové
              rozpětí, formu vstupu. Teprve pak ho zakázka najde.
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

      {/* ══ ČEKÁRNA ══════════════════════════════════════════
          Vidět jen tehdy, když je co třídit. Prázdný pruh „0 čeká"
          by byl trvalá připomínka něčeho, co není. */}
      {cekarna.ceka > 0 && (
        <button onClick={() => setVlna("cekarna")}
          title="Projít importované kontakty — jedna klávesa na kontakt"
          style={{
            ...btnMain(theme), width: "100%", textAlign: "left",
            display: "flex", alignItems: "center", gap: 9,
            padding: "10px 13px", marginBottom: 10,
            background: theme.accentSoft, color: theme.text,
            border: `1px solid ${theme.accentBorder}`,
          }}>
          <span aria-hidden="true" style={{ fontSize: "16px" }}>📥</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: "13px" }}>
            V čekárně je <strong>{cekarna.ceka}</strong>{" "}
            {cekarna.ceka === 1 ? "kontakt" : cekarna.ceka < 5 ? "kontakty" : "kontaktů"} k protřídění.
            <span style={{ display: "block", fontSize: "11px", color: theme.textSub, marginTop: 1 }}>
              Mezi Lidi se dostanou až odtud. Nic se nemaže.
            </span>
          </span>
          <span style={{ flexShrink: 0, fontWeight: 700, color: theme.accent, fontSize: "12.5px" }}>
            Protřídit
          </span>
        </button>
      )}

      {/* ══ DRUHÁ KOLA ═══════════════════════════════════════
          Michal 26. 10.: „vyfiltruju si developery a budu jim
          přiřazovat, co staví za projekty a jaké velikosti. Pak
          si vyfiltruju investory…"

          Tytéž vlny, jiná otázka. Nabízí se jen tehdy, když je
          koho doplňovat — tlačítko „0 developerů k doplnění" je
          jen trvalá připomínka něčeho, co není. */}
      {(pocetKDoplneni.developer > 0 || pocetKDoplneni.investor > 0) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {pocetKDoplneni.developer > 0 && (
            <button onClick={() => setVlna("developer")}
              title="Projít developery a doplnit, co staví a jak velké projekty"
              style={{ ...btn(), padding: "6px 11px", borderRadius: 8, fontSize: "12px",
                       background: "transparent", color: theme.text,
                       border: `1px dashed ${theme.cardBorder}` }}>
              🏗 Doplnit developery ({pocetKDoplneni.developer})
            </button>
          )}
          {pocetKDoplneni.investor > 0 && (
            <button onClick={() => setVlna("investor")}
              title="Projít investory a doplnit, co hledají a za kolik"
              style={{ ...btn(), padding: "6px 11px", borderRadius: 8, fontSize: "12px",
                       background: "transparent", color: theme.text,
                       border: `1px dashed ${theme.cardBorder}` }}>
              💰 Doplnit investory ({pocetKDoplneni.investor})
            </button>
          )}
        </div>
      )}

      {vlna === "cekarna" && (
        <VlnaCekarna theme={theme} owner={owner} ciselniky={ciselniky}
          onClose={() => { setVlna(null); setObnov(k => k + 1); }}
          onZmena={() => setObnov(k => k + 1)} />
      )}
      {(vlna === "developer" || vlna === "investor") && (
        <VlnaKriterii theme={theme} owner={owner} ciselniky={ciselniky} role={vlna}
          onClose={() => { setVlna(null); setObnov(k => k + 1); }}
          onZmena={() => setObnov(k => k + 1)} />
      )}

      {/* Rychlé zadání a import. Jsou nahoře nad hledáním schválně:
          dokud je databáze prázdná, je hledání k ničemu a zadávání
          je to jediné, co má smysl nabídnout. */}
      <RychlyClovek theme={theme} owner={owner} ciselniky={ciselniky}
        stavajici={radky} onHotovo={() => setObnov(k => k + 1)} />

      {/* ══ HLEDÁNÍ, NE ZADÁVÁNÍ ═════════════════════════════
          Michal 17. 10.: „tady jsou 2 zadávací řádky, ale na první
          dobrou není vidět, že spodní řádek je na vyhledávání."

          Měl pravdu — dvě stejně vypadající pole pod sebou, obě
          přes celou šířku, obě bílá. Jediný rozdíl byl v nápovědě
          uvnitř, a tu nikdo nečte dřív, než začne psát.

          Teď je mezi nimi čára a nad spodním stojí, co dělá. Lupa
          uvnitř pole to potvrzuje i beze slov. Horní pole zakládá,
          spodní hledá — a je to vidět dřív, než se klikne. */}
      <div style={{
        borderTop: `1px solid ${theme.cardBorder}`,
        marginTop: 12, paddingTop: 10,
      }}>
        <div style={{
          fontSize: "10px", fontWeight: 700, letterSpacing: "0.07em",
          textTransform: "uppercase", color: theme.textSub, marginBottom: 5,
        }}>Hledat mezi lidmi, které už máš</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 200px", display: "flex" }}>
          <span aria-hidden="true" style={{
            position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
            fontSize: "13px", opacity: 0.65, pointerEvents: "none",
          }}>🔍</span>
          <input value={hledat} onChange={e => setHledat(e.target.value)}
            placeholder="Jméno, telefon nebo slovo z poznámky…"
            aria-label="Hledat mezi lidmi, které už máš"
            style={{ ...input(theme), width: "100%", paddingLeft: 32,
                     background: "transparent" }} />
        </div>
        <select value={role} onChange={e => setRole(e.target.value)}
          style={{ ...input(theme), flex: "0 1 160px", cursor: "pointer" }}>
          <option value="">všechny role</option>
          {aktivni(ciselniky, "role").map(r => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
      </div>
      </div>

      {/* ── CHYTRÉ SEZNAMY ──
          Tři otázky, na které se seznam Lidí dosud nedal zeptat,
          protože odpověď leží ve třech tabulkách zároveň:

            bez karty      — s nimi párování nefunguje, a je to
                             nejčastější důvod, proč zakázka
                             nikoho nenajde
            bez kontaktu   — jméno bez telefonu je k ničemu
            ticho půl roku — vztah, který tiše vyhasíná

          Každý ukazuje počet. Když je nula, dlaždice tam není —
          nabízet prázdný filtr nemá smysl. */}
      {Object.keys(stavy).length > 0 && (() => {
        const lidi = Object.values(stavy);
        const pocty = {
          bez_karty: lidi.filter(x => !x.ma_kartu).length,
          bez_kontaktu: lidi.filter(x => !x.ma_kontakt).length,
          ticho: lidi.filter(x => !x.posledni_dotyk ||
            (Date.now() - new Date(x.posledni_dotyk).getTime()) / 86400000 > 182).length,
        };
        const SEZNAMY = [
          { k: "bez_karty",   t: "bez karty",       n: "Nemají vyplněné, co hledají — zakázka je nenajde" },
          { k: "bez_kontaktu", t: "bez telefonu",   n: "Jméno bez telefonu a mailu" },
          { k: "ticho",       t: "půl roku ticho",  n: "Žádné oslovení, zápisek ani termín za posledního půl roku" },
        ].filter(x => pocty[x.k] > 0);
        if (!SEZNAMY.length) return null;
        return (
          <div style={{ display: "flex", gap: 5, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            {SEZNAMY.map(v => {
              const zap = seznam === v.k;
              return (
                <button key={v.k}
                  onClick={() => setSeznam(zap ? "" : v.k)}
                  title={v.n} aria-label={`${v.t} — ${v.n}`} aria-pressed={zap}
                  style={{
                    ...btnGhost(theme),
                    background: zap ? theme.accentSoft : "transparent",
                    color: zap ? theme.accent : theme.textSub,
                    borderColor: zap ? theme.accentBorder : theme.cardBorder,
                    fontWeight: zap ? 700 : 500,
                  }}>{v.t} · {pocty[v.k]}</button>
              );
            })}
            {seznam && (
              <button onClick={() => setSeznam("")}
                title="Zrušit filtr a ukázat všechny"
                aria-label="Zrušit chytrý seznam"
                style={{
                  ...btn(), background: "transparent", color: theme.textSub,
                  fontSize: 11.5, padding: "4px 8px",
                }}>zrušit</button>
            )}
          </div>
        );
      })()}

      <div style={{ display: "flex", gap: 5, marginBottom: 10, flexWrap: "wrap" }}>
        {RAZENI.map(v => {
          const zap = jak === v.k;
          return (
            <button key={v.k} onClick={() => setJak(v.k)} style={{
              ...btnGhost(theme),
              background: zap ? theme.accentSoft : "transparent",
              color: zap ? theme.accent : theme.textSub,
              borderColor: zap ? theme.accentBorder : theme.cardBorder,
              fontWeight: zap ? 700 : 500,
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

      {/* ══ HROMADNÁ ÚPRAVA ══════════════════════════════════
          Michal 26. 10.: „mohu například vyfiltrovat všechny
          kontakty se jménem ENYX, což je označení klubu, abych
          jim přiřadil stejný znak?"

          Vlna na tohle nestačí — u skupiny nerozhoduješ o každém
          zvlášť. Výběr se drží přes filtr: vyhledáš ENYX, označíš
          všechny nalezené, přiřadíš. Role se PŘIDÁVÁ, nepřepisuje:
          kdo už nějakou má, o ni nepřijde. */}
      {videt.length > 0 && (
        <div style={{
          display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
          marginBottom: 8, fontSize: "12px", color: theme.textSub,
        }}>
          <button onClick={() => setVyber(v =>
              v.size === videt.length ? new Set() : new Set(videt.map(r => r.person_id)))}
            title={vyber.size === videt.length
              ? "Zrušit výběr"
              : `Označit všech ${videt.length} nalezených`}
            style={{
              ...btn(), padding: "4px 10px", borderRadius: 13, fontSize: "11.5px",
              background: vyber.size ? theme.accentSoft : "transparent",
              border: `1px solid ${vyber.size ? theme.accentBorder : theme.cardBorder}`,
              color: vyber.size ? theme.accent : theme.textSub,
              fontWeight: vyber.size ? 700 : 500,
            }}>
            {vyber.size === videt.length && videt.length > 0
              ? `Zrušit výběr (${vyber.size})`
              : `Označit všech ${videt.length}`}
          </button>
          {vyber.size > 0 && (
            <>
              <select value={hromadnaCo} onChange={e => setHromadnaCo(e.target.value)}
                aria-label="Role k přidání"
                style={{ ...input(theme), flex: "0 1 170px", minHeight: 30,
                         fontSize: "11.5px", cursor: "pointer" }}>
                <option value="">přidat roli…</option>
                {aktivni(ciselniky, "role").map(r => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
              <button onClick={async () => {
                  if (!hromadnaCo) return;
                  setHromadneDelam(true);
                  const res = await hromadnaRole([...vyber], hromadnaCo);
                  setHromadneDelam(false);
                  setHromadnaHlaska(res.ok
                    ? `Role přidána ${res.pocet} ${res.pocet === 1 ? "člověku" : "lidem"}.`
                    + (res.pocet < vyber.size ? ` Zbytek ji už měl.` : "")
                    : (res.chyba || "Nepovedlo se."));
                  if (res.ok) { setVyber(new Set()); setHromadnaCo(""); setObnov(k => k + 1); }
                }}
                disabled={!hromadnaCo || hromadneDelam}
                title={hromadnaCo ? `Přidat roli ${vyber.size} označeným` : "Nejdřív vyber roli"}
                style={{ ...btnMain(theme), minHeight: 30, padding: "0 11px",
                         fontSize: "11.5px", opacity: hromadnaCo ? 1 : 0.5 }}>
                {hromadneDelam ? "…" : `Přidat ${vyber.size}`}
              </button>
              {[["prace", "💼 pracovní"], ["osobni", "🏠 osobní"]].map(([k, l]) => (
                <button key={k} onClick={async () => {
                    setHromadneDelam(true);
                    const res = await hromadnaOblast([...vyber], k);
                    setHromadneDelam(false);
                    setHromadnaHlaska(res.ok
                      ? `Nastaveno ${res.pocet} ${res.pocet === 1 ? "člověku" : "lidem"}.`
                      : (res.chyba || "Nepovedlo se."));
                    if (res.ok) { setVyber(new Set()); setObnov(x => x + 1); }
                  }}
                  disabled={hromadneDelam}
                  title={`Označit ${vyber.size} jako ${k === "prace" ? "pracovní" : "osobní"}`}
                  style={{ ...btn(), padding: "4px 10px", borderRadius: 13, fontSize: "11.5px",
                           background: "transparent", border: `1px solid ${theme.cardBorder}`,
                           color: theme.text }}>{l}</button>
              ))}
            </>
          )}
          <span style={{ flex: 1 }} />
          {/* Export bere to, co je zrovna vidět — stejný filtr,
              stejný výsledek. Žádné druhé zadávání kritérií. */}
          <button onClick={() => exportuj()}
            title={`Stáhnout ${videt.length} nalezených i s kritérii do XLSX`}
            style={{ ...btn(), padding: "4px 10px", borderRadius: 13, fontSize: "11.5px",
                     background: "transparent", border: `1px solid ${theme.cardBorder}`,
                     color: theme.textSub }}>⬇ XLSX</button>
        </div>
      )}
      {hromadnaHlaska && (
        <div style={{ fontSize: "11.5px", color: theme.green, marginBottom: 8 }}>{hromadnaHlaska}</div>
      )}

      {videt.map(r => (
        <Radek key={r.person_id} r={r} theme={theme} ciselniky={ciselniky}
          dotaz={hledat} onOtevri={() => onOtevriOsobu?.(r.person_id)}
          vybrany={vyber.has(r.person_id)}
          onVyber={() => setVyber(v => {
            const n = new Set(v);
            if (n.has(r.person_id)) n.delete(r.person_id); else n.add(r.person_id);
            return n;
          })} />
      ))}
    </div>
  );
}

function Radek({ r, theme, ciselniky, dotaz, onOtevri, vybrany = false, onVyber = null }) {
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
      outline: vybrany ? `2px solid ${theme.accent}` : "none",
      // Zelený proužek u lidí, kterým teď něco sedí. V dlouhém
      // seznamu je to jediné, co se dá přelétnout očima.
      borderLeft: `3px solid ${r.sedi_zakazek > 0 ? theme.green : "transparent"}`,
    }}>
      {/* Zaškrtávátko pro hromadnou úpravu. Klik na něj nesmí
          otevřít člověka — proto stopPropagation. */}
      {onVyber && (
        <button onClick={(e) => { e.stopPropagation(); onVyber(); }}
          title={vybrany ? "Odznačit" : "Označit pro hromadnou úpravu"}
          aria-label={vybrany ? "Odznačit" : "Označit"}
          aria-pressed={vybrany}
          style={{
            ...btn(), flexShrink: 0, width: 20, height: 20, padding: 0,
            borderRadius: 5, fontSize: "12px", lineHeight: "18px",
            border: `1.5px solid ${vybrany ? theme.accent : theme.inputBorder}`,
            background: vybrany ? theme.accent : "transparent", color: "#fff",
          }}>{vybrany ? "✓" : ""}</button>
      )}
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
            // "bez karty" se snadno plete s "bez kontaktu". Kontakt je
            // jméno a telefon, karta je to, CO ten člověk hledá — a jen
            // podle ní se dá párovat. Text to teď říká rovnou.
            r.karet > 0
              ? `🗂 ${pocet(r.karet, "karta", "karty", "karet")}`
              : "nevyplněno, co hledá",
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
