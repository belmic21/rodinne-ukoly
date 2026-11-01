/* ══ ZADÁVACÍ ŘÁDEK ══
   Michal 30. 10.: „celé to musí být intuitivní, pokud někde máme
   něco k zapamatování bez nápovědy, tak to oprav."
   A 1. 11.: „u okna zadání je text nápověda zkratek, ale když na
   něj kliknu, zavře se a nic se nezobrazí."

   Tahle sada hlídá dvě věci: že obě pole mluví stejnou řečí,
   a že se zkratky dají najít bez zapamatování. */
import fs from "node:fs";
import path from "node:path";
import { parseQuickAdd, parseSearchQuery, matchesPriorityToken } from "./app-funkce.mjs";

const KOREN = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(KOREN, "src/App.jsx"), "utf8");

export const kontroly = [];
const over = (co, ok) => kontroly.push([co, !!ok]);
const zadej = (t) => parseQuickAdd(t, { users: [{ name: "Petra" }] });
const hledej = (q) => parseSearchQuery(q).tokens;

// ══ 1. PRIORITA MÁ HODNOTY, KTERÝM APLIKACE ROZUMÍ ══
/* Aplikace zná urgent / important / low. Dřív se tu vyráběly
   „high" a „medium", které nezná nikdo — úkol označený +u se pak
   neřadil nahoru, nepočítal se do „co hoří" a filtr na akutní ho
   nenašel. Mlčky, protože nic nespadlo. */
over("+u je akutní",             zadej("A +u").priority === "urgent");
over("+m je důležité",           zadej("A +m").priority === "important");
over("+l je nízká",              zadej("A +l").priority === "low");
over("nevyrábí se high",         zadej("A +u").priority !== "high");
over("ani medium",               zadej("A +m").priority !== "medium");

/* Diakritika nesmí rozhodovat: JS hranice slova \b zná jen
   anglickou abecedu, takže „+akutní" dřív neprošlo vůbec
   a „+důležité" prošlo omylem — chytlo se z něj jen „d". */
over("+akutní projde",           zadej("A +akutní").priority === "urgent");
over("+důležité projde",         zadej("A +důležité").priority === "important");
over("+nízká projde",            zadej("A +nízká").priority === "low");

/* Co prioritou není, se z názvu nesmí ztratit. */
over("+dph zůstane v názvu",     zadej("cena +dph").title.trim() === "cena +dph");
over("a není to priorita",       zadej("cena +dph").priority === null);

// ══ 2. CO SE DÁ ZADAT, SE DÁ I NAJÍT ══
/* Jinak si člověk musí pamatovat dva slovníky. */
for (const znak of ["u", "urgent", "h", "akutni", "m", "dulezite", "l", "nizka"]) {
  over(`+${znak}: zadané se i najde`,
    matchesPriorityToken(zadej(`A +${znak}`).priority, znak));
}

// ══ 3. VYKŘIČNÍK ZNAMENÁ TERMÍN V OBOU POLÍCH ══
/* Nejhorší past: stejná klávesa, dva významy. Při zadávání to
   byl termín, při hledání priorita. */
over("při zadávání je ! termín", zadej("A !zítra").dueDate !== null);
over("při hledání taky",         hledej("!dnes").some(t => t.key === "due"));
over("a není to priorita",       !hledej("!dnes").some(t => t.key === "priority"));
over("priorita je plus i tady",  hledej("+u").some(t => t.key === "priority"));

// ══ 4. DELŠÍ ZÁPIS ZŮSTÁVÁ ══
/* Kdo si zvykl psát due:today, nesmí přijít o to, co mu fungovalo. */
for (const [dotaz, klic] of [["due:today", "due"], ["priority:urgent", "priority"],
                             ["assigned:petra", "assigned"], ["status:done", "status"]]) {
  over(`${dotaz} pořád funguje`, hledej(dotaz).some(t => t.key === klic));
}

// ══ 5. ZKRATKY JDOU VIDĚT BEZ ZAPAMATOVÁNÍ ══
over("nabídka je vidět po kliknutí",
  /fokus && !text\.trim\(\) && !showFull/.test(app));
/* Hledá se podmínka VYKRESLENÍ, ne jen ten výraz kdekoli —
   stejný výraz je i u šipky ▾/▸ a hrubé hledání by prošlo,
   i kdyby se nápověda zase schovala za rozklik. */
over("zkratky jsou rovnou rozbalené (na širokém)",
  /\{\(showQuickHelp \|\| \(!uzko && fokus && !text\.trim\(\)\)\) && \(\(\) => \{/.test(app));

/* Tlačítko nápovědy stojí mimo pole. Bez tohohle kliknutí nejdřív
   sebere poli zaměření, celý blok zmizí — a nápověda se nestihne
   otevřít. Přesně to Michal viděl. */
const blokNapovedy = app.slice(app.indexOf("══ ZKRATKY ══"),
                               app.indexOf("Nápověda zkratek") + 40);
over("tlačítko nekrade zaměření",
  /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/.test(blokNapovedy));
over("chipy taky ne",
  (app.match(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/g) || []).length >= 2);

over("placeholder říká, co lomítko umí",
  /nebo \/ na téma, poznámku, hledání/.test(app));
over("legenda zná lomítko",      /"Jinam než do úkolu"/.test(app));

/* Dvě kopie legendy v aplikaci musí říkat totéž — dvě nápovědy,
   které se rozejdou, jsou horší než jedna. */
over("obě legendy mají prioritu jedním řádkem",
  (app.match(/desc: "Jak moc hoří"/g) || []).length === 1
  && (app.match(/\["\+priorita", "Jak moc hoří"/g) || []).length === 1);
over("a ani jedna nemluví o high", !/"Vysoká priorita"/.test(app));

// ══ 6. ZNAČKA JE NAPSANÁ NA TLAČÍTKU ══
/* Čtyři tlačítka pod polem dělají přesně to, co značky ! @ # +
   v textu. Dokud byly značky jen v legendě, byla to druhá řeč
   k naučení. Napsané na tlačítku se učí samy. */
const radaTlacitek = app.slice(app.indexOf("const IconButton ="),
                               app.indexOf("{/* Datum popover */}"));
over("tlačítko umí nést značku",  /znacka &&/.test(app));
for (const [znak, co] of [["!", "termín"], ["@", "osoba"], ["#", "seznam"], ["+", "priorita"]]) {
  over(`${co} má na tlačítku ${znak}`, radaTlacitek.includes(`znacka="${znak}"`));
}
over("a popisek to říká slovy",
  (app.match(/v textu to samé napíšeš jako/g) || []).length === 4);
/* Značka je poznámka pod čarou, ne nadpis — ikona zůstává tím
   hlavním. (Michal: nepřehánět to s tučným písmem.) */
over("značka není tučná",         /fontSize: "11px", fontWeight: 400,/.test(app));

// ══ 7. NA TELEFONU SE TO MUSÍ VEJÍT ══
/* Michal 1. 11. se snímkem z mobilu: „na mobilu se zobrazuje
   takto, není vidět nic."

   Nápověda otevřená natrvalo sežrala s klávesnicí celou
   obrazovku a vytlačila pod okraj displeje i ta tlačítka, na
   která jsem zrovna psal značky. Pořadí důležitosti na telefonu:
   pole, pak tlačítka, teprve potom nápověda. */
over("existuje rozlišení úzké obrazovky", /const uzko = sirka < 640;/.test(app));
over("šipka ukazuje totéž",
  /\(showQuickHelp \|\| \(!uzko && fokus && !text\.trim\(\)\)\) \? "▾" : "▸"/.test(app));

/* Řádek možností se zalamoval na dva řádky a tím tlačítka
   odsouval. Na úzké obrazovce je jednořádkový a odroluje se. */
const chipy = app.slice(app.indexOf("══ CO TOHLE POLE UMÍ ══"), app.indexOf("{hlaska && ("));
over("chipy se na úzké nezalamují",  /flexWrap: uzko \? "nowrap" : "wrap"/.test(chipy));
over("a dají se odrolovat",          /overflowX: uzko \? "auto" : "visible"/.test(chipy));
over("chip se nesmršťuje",           /flexShrink: 0, whiteSpace: "nowrap"/.test(chipy));
over("na úzké odpadá i slovo navíc", /\{!uzko && <span/.test(chipy));

/* Dlouhý placeholder se na telefonu ořízl uprostřed slova. */
over("placeholder je na úzké kratší", /\? "Napiš úkol a Enter…"/.test(app));

// ══ 8. TÉMA JE V NABÍDCE ══
over("téma je mezi lomítky",     /dest: "tema"/.test(app));
over("Enter míří na téma",       (app.match(/dest: temaCmd \? "tema"/g) || []).length === 2);
over("zapisuje do map_temata",   /pridejTema\(currentUser\?\.name, \{ personId/.test(app));
over("bez člověka nic nezapíše", /Téma musí patřit člověku/.test(app));
