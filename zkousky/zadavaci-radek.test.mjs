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
over("zkratky jsou rovnou rozbalené",
  /\{\(showQuickHelp \|\| \(fokus && !text\.trim\(\)\)\) && \(\(\) => \{/.test(app));

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

// ══ 6. TÉMA JE V NABÍDCE ══
over("téma je mezi lomítky",     /dest: "tema"/.test(app));
over("Enter míří na téma",       (app.match(/dest: temaCmd \? "tema"/g) || []).length === 2);
over("zapisuje do map_temata",   /pridejTema\(currentUser\?\.name, \{ personId/.test(app));
over("bez člověka nic nezapíše", /Téma musí patřit člověku/.test(app));
