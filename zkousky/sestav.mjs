/* Vyřízne z App.jsx čisté funkce, které jdou zkoušet bez Reactu
   a bez databáze, a uloží je jako modul.

   Proč vyříznout a ne importovat: App.jsx je jeden velký soubor,
   který si na začátku sahá na prohlížeč a na Supabase. Načíst ho
   celý jen kvůli třem funkcím by znamenalo předstírat půlku
   prohlížeče. */
import fs from "node:fs";
import path from "node:path";

const KOREN = path.resolve(import.meta.dirname, "..");
const zdroj = fs.readFileSync(path.join(KOREN, "src/App.jsx"), "utf8");

/* Každý kus se bere od začátku funkce po začátek té následující.
   Kdyby se funkce v App.jsx přejmenovala, sestavení spadne tady
   a ne až v nesrozumitelné chybě uprostřed zkoušky. */
const USEKY = [
  ["function parseQuickAdd(", "// Vrací predikce pro QuickAddBar"],
  /* Mezi parseSearchQuery a searchMatch leží i matchesPriorityToken
     a matchesDueToken — berou se s nimi, zvlášť by se vyřízly
     dvakrát. */
  ["function parseSearchQuery(", "function searchMatch("],
  ["const klicOdkazu = ", "async function getSignedUrl("],
  ["function jeAdresa(", "function FotkaPoznamky("],
  ["function daysDiff(", "\n/* Datum jako"],
];

/* Úseky se v App.jsx překrývají — daysDiff leží uvnitř úseku
   s parseQuickAdd, matchesPriorityToken uvnitř toho s hledáním.
   Vyříznout je podruhé by znamenalo dvakrát deklarovat totéž.
   Proto se před přidáním ptáme, jestli tam začátek už není. */
const kusy = [];
for (const [od, do_] of USEKY) {
  const i = zdroj.indexOf(od);
  if (i < 0) throw new Error(`V App.jsx chybí: ${od}`);
  const j = zdroj.indexOf(do_, i);
  if (j < 0) throw new Error(`V App.jsx chybí konec úseku za: ${od}`);
  if (kusy.some(k => k.includes(od))) continue;
  kusy.push(zdroj.slice(i, j));
}

const vystup = kusy.join("\n\n") + `
export { parseQuickAdd, parseSearchQuery, matchesPriorityToken,
         klicOdkazu, jeAdresa, daysDiff };
`;
fs.writeFileSync(path.join(import.meta.dirname, "app-funkce.mjs"), vystup);
console.log(`app-funkce.mjs: ${vystup.length} B`);
