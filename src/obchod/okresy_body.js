/* ═══════════════════════════════════════════════════════
   TĚŽIŠTĚ OKRESŮ — pro počítání vzdáleností

   Soubor je vygenerovaný z okresy.js, needituj ho ručně.

   Souřadnice jsou v téže projektované ploše 1000 × 573 jako mapa.
   Jeden bod je zhruba 0,51 km — zjištěno porovnáním se šesti
   známými vzdušnými vzdálenostmi (Praha–Brno, Praha–Ostrava,
   Praha–Plzeň, Praha–Hradec, Brno–Ostrava, Mladá Boleslav–Brno).
   Odchylka vychází do sedmi procent.

   POZOR na to, co ta čísla znamenají: měří se mezi TĚŽIŠTI
   OKRESŮ, ne mezi obcemi. „Zhruba 40 km" tedy opravdu znamená
   zhruba. Na otázku „koho mám cestou" to stačí; na plánování
   trasy ne — a tvářit se jinak by bylo klamání.
   ═══════════════════════════════════════════════════════ */

export const KM_NA_BOD = 0.5135;

// [klíč okresu, x, y]
export const TEZISTE = [["benesov",393.5,305.4],["beroun",284,265.7],["kladno",294,197.2],["kolin",444.5,233.4],["kutna-hora",461.2,268.7],["melnik",353.2,162.6],["mlada-boleslav",415.9,151.2],["nymburk",442.1,196.1],["praha-vychod",380.4,225.6],["praha-zapad",331.1,242.3],["pribram",304.5,319.3],["rakovnik",243.3,219.3],["ceske-budejovice",363.7,473.8],["cesky-krumlov",328.9,522.1],["jindrichuv-hradec",441.5,460.4],["pelhrimov",457,370.4],["pisek",311.1,375.7],["prachatice",270.9,470.7],["strakonice",273.1,403.5],["tabor",384.9,382.7],["domazlice",123.4,358.3],["cheb",59.5,220.1],["karlovy-vary",133.9,197.4],["klatovy",193.8,403],["plzen-mesto",200.6,302.6],["plzen-jih",193.9,341.3],["plzen-sever",176.8,267.5],["rokycany",228.8,287],["sokolov",81.7,197],["tachov",102,295.4],["ceska-lipa",375,88.3],["decin",337.4,42.3],["chomutov",180,146.9],["jablonec",466.7,76.6],["liberec",435.1,55.3],["litomerice",310.1,130],["most",218,111.3],["teplice",252,102.4],["usti-nad-labem",289,83.2],["havlickuv-brod",511.2,319.2],["hradec-kralove",528.4,189.7],["chrudim",560.1,277.7],["jicin",488.7,150],["nachod",593.5,134.9],["pardubice",538,226.5],["rychnov",609.4,195.5],["semily",486.6,103.3],["svitavy",645.3,298.1],["trutnov",556.7,118.9],["usti-nad-orlici",640.8,245],["blansko",669.5,362.5],["brno-mesto",667.3,421.1],["brno-venkov",649.2,426.5],["breclav",696.5,502.2],["zlin",835.6,427.7],["hodonin",756.6,481],["jihlava",514.1,400.6],["kromeriz",791.4,404],["prostejov",725.4,360.9],["trebic",559.3,436.7],["uherske-hradiste",806.4,463.9],["vyskov",717.9,411],["znojmo",587.5,482.7],["zdar",591,366.2],["bruntal",795.1,241.5],["frydek-mistek",945.4,328.2],["karvina",940.2,279.9],["novy-jicin",871.7,319.7],["olomouc",768,312.2],["opava",859.7,265.3],["ostrava",909.5,287.4],["prerov",807.1,356.2],["sumperk",717.2,252.9],["vsetin",876.1,383.8],["jesenik",748.6,178.2],["louny",219.6,178.3],["praha",351.4,227]];

const BOD = Object.fromEntries(TEZISTE.map(([k, x, y]) => [k, [x, y]]));

export function bodOkresu(k) { return BOD[k] || null; }

// Vzdušná vzdálenost dvou okresů v kilometrech. Null, když jeden
// z nich neznáme — radši nic než vymyšlené číslo.
export function kmMeziOkresy(a, b) {
  const p = BOD[a], q = BOD[b];
  if (!p || !q) return null;
  return Math.hypot(p[0] - q[0], p[1] - q[1]) * KM_NA_BOD;
}

/* Jak daleko je okres od úsečky mezi dvěma okresy — tedy jak velká
   zajížďka. Úsečka, ne trasa: skutečné silnice neznáme a přímka je
   u otázky „koho mám po cestě" poctivější než vymyšlená cesta.
   Když je start stejný jako cíl, měří se prostě vzdálenost. */
export function kmOdTrasy(odkud, kam, kde) {
  const a = BOD[odkud], b = BOD[kam], p = BOD[kde];
  if (!a || !b || !p) return null;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const delka2 = dx * dx + dy * dy;
  if (delka2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]) * KM_NA_BOD;
  // Průmět bodu na úsečku, oříznutý na její konce.
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / delka2;
  t = Math.max(0, Math.min(1, t));
  const qx = a[0] + t * dx, qy = a[1] + t * dy;
  return Math.hypot(p[0] - qx, p[1] - qy) * KM_NA_BOD;
}
