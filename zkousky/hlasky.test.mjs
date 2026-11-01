/* ══ HLÁŠKY BEZ STROPU ══
   Michal 31. 10.: „denní omezení na 1 hlášku je hloupé
   a zbytečné, některý den je 5 hlášek a pak nemám měsíc žádnou."

   Strop nebyl nastavení, ale tvar dat: hláška byla dvojice
   sloupců na dni a den je jeden řádek. Teď má vlastní tabulku.

   Zkouší se zdroj, ne běžící aplikace — komponenty deníku jsou
   zapletené do prohlížeče a vytáhnout je sem by znamenalo
   předstírat půlku DOM. Co jde ověřit chováním, ověřuje
   migrace proti skutečnému PostgreSQL. */
import fs from "node:fs";
import path from "node:path";

const KOREN = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(KOREN, "src/App.jsx"), "utf8");
const sql = fs.readFileSync(path.join(KOREN, "src/obchod/hlasky_261101.sql"), "utf8");

export const kontroly = [];
const over = (co, ok) => kontroly.push([co, !!ok]);

// ══ 1. STROP JE PRYČ ══
/* Tohle je ta věc, kterou Michal viděl na obrazovce. */
/* Hledá se v tom, co se vykreslí, ne v celém souboru — ta věta
   zůstala v komentářích u obou oprav a hrubé hledání ji chytalo.
   Komentář o zrušené věci je v pořádku, vyskakující okno ne. */
const bezKomentaru = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
over("okno o přepsání zmizelo",     !/Nová ji přepíše/.test(bezKomentaru));
over("i text o jedné na den",       !/Na den připadá jedna hláška/.test(bezKomentaru));
over("a jeho stav taky",            !/confirmOverwrite/.test(app));
over("zadání rovnou ukládá",        /const trySave = doSave;/.test(app));

// ══ 2. ZÁPIS PŘIDÁVÁ, NEPŘEPISUJE ══
over("existuje přidání",            /async function apiAddQuote\(/.test(app));
over("vkládá do story_quotes",      /from\("story_quotes"\)\s*\n?\s*\.insert\(/.test(app));
over("stará funkce je pryč",        !/apiSetStoryQuote/.test(app));
over("nikde se nepíše do quote sloupce",
  !/quote: q \|\| null/.test(app));

// ══ 3. ÚPRAVA A MAZÁNÍ PODLE ID ══
/* Dokud byla hláška jedna na den, stačilo datum. Teď jich den
   může mít pět a datum by neřeklo kterou. */
over("úprava bere id",              /async function apiUpdateQuote\(id,/.test(app));
over("mazání bere id",              /async function apiDeleteQuote\(id\)/.test(app));
const prohlizec = app.slice(app.indexOf("const startEditQuote"), app.indexOf("const reloadQuotesLocal"));
over("prohlížeč edituje podle id",  /setEditingQuote\(q\.id\)/.test(prohlizec));
over("a maže podle id",             /apiDeleteQuote\(id\)/.test(prohlizec));
over("nikde už datum jako klíč",    !/saveEditQuote\(s\.date\)|deleteQuote\(s\.date\)/.test(app));

// ══ 4. DEN UKAZUJE VŠECHNY ══
over("den drží seznam hlášek",      /const \[dayQuotes, setDayQuotes\]/.test(app));
over("načítá je zvlášť",            /apiLoadDayQuotes\(currentUser\?\.name, date\)/.test(app));
over("vykresluje všechny",          /dayQuotes\.map\(q =>/.test(app));
over("prázdný den pozná podle nich",
  /entriesRead\.length === 0 && dayQuotes\.length === 0/.test(app));
over("po přidání se seznam doplní", /setDayQuotes\(prev => \[\.\.\.prev, res\.quote\]\)/.test(app));

// ══ 5. NÁVRHY JMEN BEROU I NOVOU TABULKU ══
/* Jinak by se jméno zadané u hlášky přestalo nabízet u zápisku. */
const navrhy = app.slice(app.indexOf("async function apiRecentStoryPeople"),
                         app.indexOf("/* ── Panel „Co jsi ten den udělal"));
over("čte dny i hlášky",            /from\("story_quotes"\)/.test(navrhy));
over("a chybějící tabulku ustojí",  /hlasky\.data \|\| \[\]/.test(navrhy));

// ══ 6. STARÉ SLOUPCE ZŮSTÁVAJÍ JAKO ZÁLOHA ══
/* Dokud Michal neřekne, že je všechno v pořádku. */
over("migrace je nemaže",           !/drop column/i.test(sql));
over("ani tabulku dnů",             !/drop table/i.test(sql));
over("a říká to nahlas",            /jako záloha/.test(sql));

// ══ 7. MIGRACE ══
over("zakládá tabulku",             /create table if not exists public\.story_quotes/.test(sql));
over("datum je povinné",            /date\s+date not null/.test(sql));
over("autor nepovinný",             /person\s+text,/.test(sql));
over("stěhuje staré hlášky",        /insert into public\.story_quotes[\s\S]*from public\.daily_stories/.test(sql));
over("prázdné texty nestěhuje",     /trim\(d\.quote\) <> ''/.test(sql));
over("podruhé nepřidá nic",         /not exists \(\s*\n\s*select 1 from public\.story_quotes/.test(sql));
over("zapíná RLS",                  /enable row level security/.test(sql));
over("má čtyři pravidla",
  (sql.match(/create policy story_quotes_/g) || []).length === 4);
over("a kontrolu, že čísla sedí",   /bylo ve dnech/.test(sql));
