# Rodinné úkoly — jak je to poskládané

Čti tohle první, až se k projektu vrátíš po delší době.
Soubory mají vlastní hlavičky s detailem; tenhle přehled odpovídá
na to, **jak do sebe zapadají a proč to tak je**.

Stav k 8. 10. 2026.

---

## Co to je a kde to běží

Webová aplikace (PWA) pro vlastní potřebu. Tři služby v řadě:

```
GitHub  →  Vercel  →  Supabase
 kód       sestavení   databáze, přihlašování, úložiště
           a hosting
```

Změna v kódu = commit na GitHubu. Vercel to sám sestaví a nasadí.
**Když sestavení spadne, na web se nic nedostane a běží stará verze.**
To je pojistka, ne porucha.

---

## Jak je kód rozdělený

```
src/
  App.jsx          úkoly, poznámky, deník, mapa, připomínky — vše ostatní
  supabase.js      připojení k databázi a převody řádek ↔ objekt
  obchod/          obchodní modul, samostatně
    ui.js          styly, formátování peněz a dat, verze modulu
    api.js         všechny dotazy do databáze pro obchod
    ObchodSheet.jsx  hlavní okno, záložky, směrování mezi obrazovkami
    Site.jsx       síť — karty investorů, hledání lidí
    Zakazka.jsx    provizní řetězec a geneze oslovení
    Osoba.jsx      člověk ze všech stran
    Sdileni.jsx    sdílení zakázek a správa uživatelů
    Ciselniky.jsx  úprava seznamů (typy, fáze, stavy…)
```

### Proč je obchod zvlášť

`App.jsx` má přes 28 tisíc řádků a jednou nás to stálo výpadek:
úprava trefila špatné místo, protože stejný kus kódu byl v souboru
dvakrát. Kontrola syntaxe to nechytila — syntakticky to bylo v pořádku.

Obchodní modul je proto od začátku rozdělený na malé soubory.
`App.jsx` se **nepřepisoval** — velký refaktor je riziko, které
nemělo smysl podstupovat. Kusy se odlupují postupně, když se do nich
stejně sahá.

Modul nic neimportuje z `App.jsx`. Barvy a přihlášeného uživatele
dostává zvenčí jako parametry. Díky tomu se dá upravovat samostatně.

---

## Verze — dvě čísla, dva významy

| Kde | Co to je |
|---|---|
| `FILE_VERSION` v `App.jsx` | odpovídá názvu dodaného souboru `App_RRMMDD_HHMM.jsx` |
| `OBCHOD_VERZE` v `obchod/ui.js` | verze modulu, vidíš ji v hlavičce okna Obchod |
| `APP_VERSION` ve spodní liště | čas, kdy Vercel sestavil build — s názvem souboru se neshoduje nikdy |

Modul se dá aktualizovat bez zásahu do `App.jsx`, proto má vlastní číslo.

### Nahrávání

GitHub ukládá **každý soubor samostatným commitem** a Vercel na každý
spustí sestavení. Při nahrávání čtyř souborů proběhnou čtyři sestavení
a první tři spadnou — v tu chvíli jsou na místě jen některé.
**Platí až poslední.** Nahraj všechno, teprve pak kontroluj Vercel.

Typická chyba při částečném nahrání vypadá takhle:

```
✘ No matching export in "obchod/api.js" for import "zalozOsobu"
```

Znamená to, že chybí druhý soubor z dvojice, která na sebe odkazuje.

### Návrat zpátky

Vercel → Deployments → předchozí nasazení → Promote to Production.
Databáze se tím nijak nedotkne.

---

## Databáze

### Vlastnictví a přihlášení

Přihlášení běží přes Supabase Auth. Tabulka `profiles` spojuje účet
se **jménem**, kterým jsou podepsaná všechna data (`Michal`, `David`…).
Funkce `me()` vrátí jméno přihlášeného a na ni se odkazují všechna
pravidla.

Jména se v datech používají schválně — při zavádění účtů se tím
nemusel přepsat ani jeden z 326 existujících úkolů.

### Tabulky

**Původní aplikace:** `tasks`, `notes`, `reminders`, `task_comments`,
`attachments`, `custom_lists`, `daily_stories`, `user_categories`,
`user_story_settings`, `user_notification_prefs`, `push_subscriptions`,
`user_blocks`, `users` (stará, zůstala kvůli seznamu jmen).

**Mapa:** `map_people`, `map_facts` — znalostní báze vztahů.

**Obchod:**

| Tabulka | K čemu |
|---|---|
| `deal_projects` | zakázky; `kod` je `MB-10001`, číslo z `deal_project_seq` |
| `deal_cards` | co kdo hledá (`poptavka`) nebo má kolem sebe (`nabidka`) |
| `deal_participants` | kdo je na zakázce napojený, provizní řetězec, podíly |
| `deal_approaches` | koho jsem oslovil a jak to dopadlo |
| `deal_shares` | komu zakázku sdílím a co přesně uvidí |
| `deal_enums` | všechny seznamy na jednom místě |
| `deal_settings` | předpona před číslem zakázky |
| `pozvanky` | kdo se smí zaregistrovat |

### Pět vrstev obchodu

```
1  člověk        map_people + role_tagy (čím je obecně)
2  karty         deal_cards (co hledá / co má)
3  zakázka       deal_projects
4  účastníci     deal_participants (čím je v TÉHLE zakázce)
5  oslovení      deal_approaches
```

Role jsou na dvou místech schválně. Radek je obecně investor
i developer, ale v konkrétní zakázce je právě jedním z nich.
Klient je pro Davida majitel, David je pro Michala prostředník —
role se v řetězci posouvá.

Vrstvy 4 a 5 jsou oddělené, protože odpovídají na jiné otázky:
„kdo na tom je" a „koho jsem zkoušel".

### Časová osa

Nemá vlastní tabulku. Události se zapisují do `map_facts`
s vyplněným `person_id` i `project_id`. Proto klik na Davida ukáže
i obchodní dění — je to jedna osa, jen filtrovaná jinak.

---

## Bezpečnost

Do září 2026 byla databáze veřejně čitelná i zapisovatelná.
Opravovalo se to ve fázích a platí:

- Nepřihlášený (role `anon`) nemá **nikde nic**.
- Přihlášený vidí jen řádky se svým jménem — `owner = me()`.
- Nový uživatel začíná v **prázdném prostředí**.
- Úkoly navíc vidíš i tehdy, když jsou ti přiřazené nebo s tebou sdílené.

**Pozor na pravidla v PostgreSQL: sčítají se, neprotínají.** Jedno
staré pravidlo „povol všem" přebije všechna omezení vedle sebe.
Tenhle problém tu jednou byl a stál za to ho najít.

### Sdílení

Protistrana **nečte tabulku zakázek**. Čte ji přes funkci
`deal_sdilene_se_mnou()`, která nepovolené sloupce vrátí prázdné —
ta data se z databáze vůbec neodešlou. Kdyby četla tabulku přímo,
stačila by jedna chyba v podmínce a viděla by všechno.

Kontakty, karty investorů a mapa se nesdílí nikdy. Není to přepínač,
databáze je druhé straně neumí vydat.

### Pozvánky

Bez pozvánky se nikdo nezaregistruje — hlídá to spouštěč
`trg_novy_ucet` nad `auth.users`. Záchranná brzda, kdyby se registrace
zasekla:

```sql
drop trigger if exists trg_novy_ucet on auth.users;
```

---

## Rozhodnutí, která vypadají divně, ale mají důvod

**Číslo zakázky má předponu `MB-`.** Samotné `10025` by na disku
trefilo i faktury, částky a kusy datumů. `MB-10025` je jedinečný
řetězec. Číslo se nikdy nemění ani nerecykluje, i když se zakázka
přejmenuje nebo smaže.

**Velikost je číslo, ne přihrádka.** Filtr „nad 50" vrátí i 85 a 100.
Přihrádková varianta by 85 bytů schovala.

**Při párování jsou typ a kraj tvrdé podmínky, cena a velikost se jen
bodují.** Investor na retail nemá vidět rodinné domy. Ale projekt za
45 milionů má vyskočit i u investora, který psal 50–100 — s poznámkou,
že je pod jeho hranicí. Úplně mimo rozsah vypadne.

**Součet podílů se nevynucuje.** Ne každý obchod je rozdělený do stovky.
Systém upozorní, ale uložit nechá.

**V číselnících se liší vypnout a smazat.** Vypnutá položka zůstane
u starých dat, jen ji nově nevybereš. Smazat jde jen to, co nic
nepoužívá — systém si to ověří.

**Klíč vs. popisek.** V datech je neměnný klíč (`rodinny_dum`),
ty vidíš popisek („Rodinný dům"). Přejmenování je proto bezpečné
a promítne se i do starých záznamů.

**Přehled člověka se otevírá jako překryv.** Kdyby nahradil detail
zakázky, React by ho zahodil i s rozepsaným textem.

**Mazání zakázky je měkké.** Řádek zůstane, jen se schová — číslo
zakázky drží pojmenování složek na disku.

---

## Co je vědomě nedodělané

- **Fotky v poznámkách** jsou v koši `task-images`, který je veřejný.
  Adresa je zapsaná v textu poznámky, takže zavřením koše by zmizely.
  Oprava znamená projít staré poznámky a přepsat adresy na podepsané.
- **Přílohy u zakázky** jsou jen odkaz na složku, ne soubory v systému.
- **Karta investora** neumí tvrdou podmínku, všechno jen boduje.
- **Lupa** hledá slova, ne otázky typu „co jsem řešil s Novákem v létě".
- **Stará tabulka `users`** zůstává kvůli seznamu jmen. PINy už jsou
  smazané, přihlašování přes ně dávno neběží.

---

## Zkratky v hlavním poli

| Zkratka | Co udělá |
|---|---|
| `/u` | úkol (výchozí i bez lomítka) |
| `/p` | poznámka |
| `/d` | denní příběh |
| `/m` | mapa — `/m martin: prodává octavii` |
| `/z` | zakázka — `/z rodinný dům Beroun 3,5 mil` |
| `/k` | kdo — jméno nebo telefon, otevře přehled člověka |

`/k` hledá jen lidi a nic jiného — na zvonící telefon.
Lupa nahoře naopak hledá napříč vším.
