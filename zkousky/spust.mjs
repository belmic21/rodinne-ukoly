/* Spustí všechny sady *.test.mjs v téhle složce.

   Zkoušky patří do repozitáře. Dřív žily vedle něj a při výměně
   prostředí zmizely — i s tím, co chytaly. */
import fs from "node:fs";
import path from "node:path";

await import("./sestav.mjs");

const slozka = import.meta.dirname;
const sady = fs.readdirSync(slozka).filter(f => f.endsWith(".test.mjs")).sort();

let celkem = 0, chyb = 0, sadSChybou = 0;
for (const soubor of sady) {
  const { kontroly } = await import(path.join(slozka, soubor));
  const padlo = kontroly.filter(([, ok]) => !ok);
  celkem += kontroly.length;
  chyb += padlo.length;
  if (padlo.length) sadSChybou++;
  console.log(`  ${padlo.length ? "✗" : "✓"} ${soubor.replace(".test.mjs", "").padEnd(16)} ${kontroly.length - padlo.length} z ${kontroly.length}`);
  for (const [co] of padlo) console.log(`        ✗  ${co}`);
}
console.log(`\nProšlo ${celkem - chyb} z ${celkem} kontrol v ${sady.length} ${sady.length === 1 ? "sadě" : "sadách"}.`);
if (chyb) console.log(`Sad s chybou: ${sadSChybou}`);
process.exit(chyb ? 1 : 0);
