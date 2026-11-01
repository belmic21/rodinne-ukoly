/* ══ FOTKY U POZNÁMEK NEJSOU VEŘEJNÉ ══
   Bucket task-images byl otevřený: kdo měl odkaz, viděl fotku bez
   přihlášení — a odkaz byl jen název souboru. Přílohy u úkolů to
   měly správně od začátku, tohle byla jediná cesta ven.

   Opraveno 1. 11. 2026. Do poznámky se ukládá CESTA, adresa se
   podepisuje až při zobrazení. */
import fs from "node:fs";
import path from "node:path";
import { klicOdkazu, jeAdresa } from "./app-funkce.mjs";

const KOREN = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(KOREN, "src/App.jsx"), "utf8");
const sql = fs.readFileSync(path.join(KOREN, "src/obchod/fotky_soukrome.sql"), "utf8");

export const kontroly = [];
const over = (co, ok) => kontroly.push([co, !!ok]);

// ══ 1. NAHRÁVÁNÍ NEVRACÍ VEŘEJNOU ADRESU ══
const nahravani = app.slice(app.indexOf("async function uploadTaskImage"),
                            app.indexOf("function autoDetectCategory"));
over("nahrávání nesahá na getPublicUrl", !/getPublicUrl/.test(nahravani));
over("a vrací cestu",                    /return filename;/.test(nahravani));
over("nikde jinde v aplikaci taky ne",   !/getPublicUrl/.test(app));

// ══ 2. ZOBRAZENÍ PODEPISUJE ══
over("fotka se podepisuje z task-images",
  /getSignedUrl\(cesta, "task-images"\)/.test(app));
over("poznámka nekreslí src přímo z uložené hodnoty",
  !/src=\{n\.imageUrl\}/.test(app));

// ══ 3. STARÉ POZNÁMKY S VEŘEJNOU ADRESOU CHODÍ DÁL ══
/* Fotek zatím nula, ale mezi nasazením a puštěním SQL může
   přibýt. Rozpoznání adresy je levná pojistka. */
over("http adresa se pozná",       jeAdresa("https://x.supabase.co/storage/v1/o/a.jpg"));
over("i bez s",                    jeAdresa("http://x/y.jpg"));
over("cesta se za adresu nepovažuje", !jeAdresa("note_123_abc.jpg"));
over("prázdno taky ne",            !jeAdresa("") && !jeAdresa(null) && !jeAdresa(undefined));

// ══ 4. KLÍČ CACHE NESE BUCKET ══
/* Dva soubory stejného jména ve dvou koších jsou dva různé
   soubory. Společná cache by jednomu podstrčila odkaz na druhý. */
over("výchozí je attachments",     klicOdkazu("a.jpg") === "attachments/a.jpg");
over("bucket se promítne",         klicOdkazu("a.jpg", "task-images") === "task-images/a.jpg");
over("stejné jméno, jiný kuš",     klicOdkazu("a.jpg", "task-images") !== klicOdkazu("a.jpg"));

/* A mazání z cache musí používat týž klíč jako ukládání —
   při přidání druhého bucketu se to rozešlo a cache by se
   přestala čistit, tiše. */
over("mazání skládá klíč stejně",
  (app.match(/_signedUrlCache\.delete\(klicOdkazu\(/g) || []).length === 2);
over("a nikde se nemaže holou cestou",
  !/_signedUrlCache\.delete\((?!klicOdkazu)/.test(app));

// ══ 5. SQL ZAVÍRÁ, CO MÁ ══
over("bucket se zavírá",           /set public = false/.test(sql));
over("čtení jen pro přihlášené",   /for select to authenticated/.test(sql));
over("zápis taky",                 /for insert to authenticated/.test(sql));
over("skript nic nemaže",          !/\bdrop table\b|\bdelete from\b/i.test(sql));
over("a říká pořadí nasazení",     /Nejdřív nasaď aplikaci/.test(sql));
