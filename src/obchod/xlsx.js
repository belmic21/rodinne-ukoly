/* ═══════════════════════════════════════════════════════
   XLSX BEZ KNIHOVNY

   Michal chtěl export do XLSX. Hotová knihovna (SheetJS) váží
   podle sestavení 100 až 900 kB — u PWA, kterou otvíráš na
   mobilu, to není zadarmo.

   Jenže .xlsx je jen ZIP s několika XML soubory, a ZIP se dá
   napsat BEZ komprese (metoda „uložit"). Pak odpadá deflate
   a zbude jen CRC32 a pár hlaviček — osmdesát řádků místo
   knihovny.

   Soubor je o něco větší než komprimovaný, ale export pár set
   kontaktů má stejně desítky kilobajtů. Excel, LibreOffice
   i Google Tabulky to otevřou bez řečí.

   Texty jdou do buněk jako inlineStr. Díky tomu odpadá
   sdílená tabulka řetězců — o jeden soubor a jednu příležitost
   k chybě míň.
   ═══════════════════════════════════════════════════════ */

/* eslint-disable-next-line no-undef -- TextEncoder je v prohlížeči i v Node 18+ */
const KODER = new TextEncoder();

/* CRC32. Tabulka se spočítá při prvním použití — 256 položek,
   zlomek milisekundy, a ušetří to kilobajt zdrojáku. */
let TABULKA = null;
function crcTabulka() {
  if (TABULKA) return TABULKA;
  TABULKA = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    TABULKA[i] = c >>> 0;
  }
  return TABULKA;
}

function crc32(bajty) {
  const t = crcTabulka();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bajty.length; i++) c = t[(c ^ bajty[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* XML si hlídá pět znaků. Bez toho by jediné „&" v názvu firmy
   udělalo z celého sešitu nečitelný soubor. */
function xml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    /* Řídicí znaky v XML 1.0 nemají co dělat; v exportech
       z telefonu se občas objeví a Excel pak soubor odmítne. */
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

// Číslo sloupce na písmeno: 1 → A, 27 → AA.
function sloupec(n) {
  let s = "";
  while (n > 0) { const z = (n - 1) % 26; s = String.fromCharCode(65 + z) + s; n = (n - z - 1) / 26; }
  return s;
}

function list(radky) {
  const telo = radky.map((r, i) => {
    const bunky = r.map((h, j) => {
      const adr = `${sloupec(j + 1)}${i + 1}`;
      if (h === null || h === undefined || h === "") return "";
      if (typeof h === "number" && Number.isFinite(h)) {
        return `<c r="${adr}"><v>${h}</v></c>`;
      }
      return `<c r="${adr}" t="inlineStr"><is><t xml:space="preserve">${xml(h)}</t></is></c>`;
    }).join("");
    return `<row r="${i + 1}">${bunky}</row>`;
  }).join("");
  const sirka = Math.max(1, ...radky.map(r => r.length));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${Array.from({ length: sirka }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="22" customWidth="1"/>`).join("")}</cols>
<sheetData>${telo}</sheetData></worksheet>`;
}

const SOUBORY = (radky, nazevListu) => ([
  ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`],
  ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
  ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xml(nazevListu).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`],
  ["xl/worksheets/sheet1.xml", list(radky)],
]);

/* ZIP metodou „uložit". Žádná komprese, takže stačí CRC a délky;
   deflate by znamenal buď knihovnu, nebo vlastní kompresor. */
function zip(soubory) {
  const kusy = [];
  const stred = [];
  let pozice = 0;

  const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  for (const [jmeno, obsah] of soubory) {
    const jm = KODER.encode(jmeno);
    const data = KODER.encode(obsah);
    const crc = crc32(data);
    // 0x0800 = názvy a obsah jsou v UTF-8.
    const hlavicka = [
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(jm.length), ...u16(0),
    ];
    kusy.push(new Uint8Array(hlavicka), jm, data);
    stred.push({ jmeno: jm, crc, delka: data.length, pozice });
    pozice += hlavicka.length + jm.length + data.length;
  }

  const zacatekStredu = pozice;
  for (const z of stred) {
    const h = [
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(0), ...u16(0), ...u32(z.crc), ...u32(z.delka), ...u32(z.delka),
      ...u16(z.jmeno.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(z.pozice),
    ];
    kusy.push(new Uint8Array(h), z.jmeno);
    pozice += h.length + z.jmeno.length;
  }

  kusy.push(new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(stred.length), ...u16(stred.length),
    ...u32(pozice - zacatekStredu), ...u32(zacatekStredu), ...u16(0),
  ]));

  const celkem = kusy.reduce((a, k) => a + k.length, 0);
  const ven = new Uint8Array(celkem);
  let i = 0;
  for (const k of kusy) { ven.set(k, i); i += k.length; }
  return ven;
}

/* Hlavní vstup. `radky` je pole polí — první řádek jsou nadpisy.
   Vrátí Blob, který se dá rovnou stáhnout. */
export function sesit(radky, nazevListu = "List1") {
  const bajty = zip(SOUBORY(radky, nazevListu));
  return new Blob([bajty], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function stahni(blob, nazevSouboru) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nazevSouboru;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Uvolnit až po kliknutí, jinak Safari stáhne prázdný soubor.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
