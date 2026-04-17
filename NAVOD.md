# 📋 Rodinné úkoly — Kompletní návod ke spuštění

Ahoj Michale! Tady je kompletní postup, jak rozjet tvou aplikaci od nuly. Celé to zabere asi **1-2 hodiny**, ale pak to běží zdarma navždy.

---

## ✅ Co budeš potřebovat

- Email
- Mobil/PC s prohlížečem
- Trochu trpělivosti :)

**Žádné platby. Žádná kreditka. Vše zdarma.**

---

## 🎯 Postup v 5 krocích

### KROK 1: Vytvoř si účet na Supabase (databáze)

1. Jdi na **https://supabase.com**
2. Klikni na **"Start your project"** (vpravo nahoře)
3. Přihlaš se přes GitHub nebo Google (doporučuji Google)
4. Po přihlášení klikni **"New project"**
5. Vyplň:
   - **Organization:** zvol nebo vytvoř (jméno organizace, klidně "Doma")
   - **Project name:** `rodinne-ukoly`
   - **Database password:** vymysli silné heslo a **ULOŽ SI HO!** (například do správce hesel)
   - **Region:** `Central EU (Frankfurt)` — nejblíže Česku
   - **Pricing plan:** `Free`
6. Klikni **"Create new project"**
7. **Počkej 2-3 minuty**, než se projekt vytvoří

### KROK 2: Vytvoř databázové tabulky

1. V Supabase v levém menu klikni na ikonu **SQL Editor** (vypadá jako `</>`)
2. Klikni **"New query"** (vpravo nahoře)
3. **Otevři soubor `supabase-schema.sql`** ze složky této aplikace
4. **Zkopíruj jeho celý obsah** a vlož do okna v Supabase
5. Klikni **"Run"** vpravo dole (nebo Ctrl/Cmd + Enter)
6. Měla by se objevit zpráva **"Success. No rows returned"** — perfektní!

### KROK 3: Získej přístupové údaje

1. V levém menu klikni na **Settings** (ikona ozubeného kolečka dole)
2. V podmenu vyber **API**
3. Najdeš tam dvě důležité věci:
   - **Project URL** (něco jako `https://abcdefgh.supabase.co`)
   - **Project API keys** → vyber `anon public` (dlouhý řetězec)
4. **Tyto dvě hodnoty si zkopíruj** — budeš je potřebovat za chvíli

### KROK 4: Nahraj kód na Vercel (hosting)

1. Jdi na **https://vercel.com**
2. Klikni **"Sign Up"** → přihlaš se **stejným Google účtem** jako u Supabase
3. Po přihlášení klikni **"Add New..."** → **"Project"**
4. Vercel se zeptá na GitHub. Pokud nemáš GitHub:
   - Otevři novou záložku, jdi na **https://github.com**
   - Vytvoř si tam zdarma účet (stejný email)
5. Vraťme se k Vercelu — bude chtít, abys nahrál kód:

**Nejjednodušší cesta — nahraj přes GitHub:**

a) V GitHubu vpravo nahoře klikni **"+"** → **"New repository"**
b) Název: `rodinne-ukoly`, nech Public, klikni **"Create repository"**
c) Na další stránce uvidíš návod. Vyber **"uploading an existing file"**
d) **Přetáhni do okna celou složku** `rodinne-ukoly` z této ZIP složky (kromě `node_modules` pokud existuje)
e) Dole klikni **"Commit changes"**
f) Vrať se na **vercel.com** → **"Add New Project"** → uvidíš `rodinne-ukoly` → klikni **"Import"**

g) Vercel se zeptá na nastavení — **DŮLEŽITÉ**:
   - **Framework Preset:** Vite (mělo by se rozpoznat samo)
   - Klikni na **"Environment Variables"** a přidej:
     - Name: `VITE_SUPABASE_URL` → Value: tvoje Project URL ze Supabase
     - Klikni **"Add"**
     - Name: `VITE_SUPABASE_ANON_KEY` → Value: tvůj anon key ze Supabase
     - Klikni **"Add"**
6. Klikni **"Deploy"** a počkej 1-2 minuty

7. **Hotovo!** Vercel ti dá odkaz typu `rodinne-ukoly-xxx.vercel.app`

### KROK 5: První spuštění a sdílení

1. Otevři odkaz, který ti dal Vercel
2. **První obrazovka:** vytvoř hlavní účet (admin)
   - Tvoje jméno: `Michal`
   - PIN: vyber si 4místný PIN (zapamatuj si!)
3. Po vytvoření jsi uvnitř aplikace
4. Klikni nahoře na **⚙️ (ozubené kolo)** → otevře se **Správa uživatelů**
5. **Přidej Petru:**
   - Jméno: `Petra`
   - PIN: domluv se s Petrou na jejím PINu
6. **Pošli Petře odkaz** (ten z Vercelu) — přihlásí se svým jménem a PINem
7. Pro snadný přístup:
   - **Na mobilu:** otevři odkaz → menu prohlížeče → **"Přidat na plochu"** → bude vypadat jako nativní app
   - **Na PC:** otevři odkaz → záložka v Chromu → **"Instalovat aplikaci"**

---

## 🎉 To je vše! Aplikace běží a synchronizuje se v reálném čase

**Co máš teď:**
- Webová aplikace na vlastní URL (Vercel)
- Databáze v cloudu (Supabase)
- Real-time synchronizace mezi všemi zařízeními
- PWA — instalovatelná jako appka na telefon i PC
- **Vše zdarma**

**Cena dlouhodobě:** 0 Kč/měsíc.

---

## 🛠 Časté otázky a problémy

### "Když chci přidat dalšího uživatele (děti)"
Stačí v aplikaci kliknout na **⚙️** a přidat. Neomezený počet.

### "Jak změnit PIN?"
Smaž uživatele přes ⚙️ a vytvoř znovu s novým PINem (admina nelze smazat — pokud potřebuješ změnit jeho PIN, napiš mi).

### "Ztratil jsem admin PIN!"
Jdi do Supabase → Table Editor → users → najdi svůj řádek → uprav `pin`.

### "Aplikace přestala fungovat"
Pravděpodobně se Supabase projekt pozastavil (po 7 dnech bez použití).
1. Jdi na supabase.com
2. Otevři projekt
3. Najdeš tlačítko **"Restore"** nebo **"Resume"**
4. Po pár sekundách běží zase
*(Aplikace má vestavěný keep-alive ping, takže pokud ji používáte denně, k pauze nedojde.)*

### "Chci přidat vlastní doménu"
Vercel → tvůj projekt → Settings → Domains → přidej svoji doménu zdarma.

### "Jak udělat zálohu dat?"
Supabase → Table Editor → vyber tabulku → Export. Doporučuji jednou za měsíc.

### "Jak nainstalovat na iPhone (Petra)?"
1. Otevři odkaz v Safari (musí být Safari!)
2. Tlačítko **Sdílet** (čtvereček se šipkou nahoru)
3. **"Přidat na plochu"** (Add to Home Screen)
4. Hotovo — appka je na ploše

### "Jak nainstalovat na Android (já)?"
1. Otevři odkaz v Chrome
2. Vpravo nahoře tři tečky
3. **"Nainstalovat aplikaci"** nebo **"Přidat na plochu"**

---

## 📁 Co najdeš v této složce

```
rodinne-ukoly/
├── 📄 NAVOD.md                  ← tenhle návod (čteš teď)
├── 📄 supabase-schema.sql       ← SQL skript pro Supabase (KROK 2)
├── 📁 src/                      ← zdrojový kód aplikace
│   ├── App.jsx                  ← hlavní aplikace
│   ├── main.jsx                 ← React entry point
│   └── supabase.js              ← databázové připojení
├── 📁 public/                   ← obrázky a ikony
├── package.json                 ← seznam knihoven
├── vite.config.js               ← konfigurace builderu
├── index.html                   ← HTML obal
├── .env.example                 ← šablona pro lokální vývoj
└── .gitignore                   ← co neukládat do GitHubu
```

---

## ❓ Potřebuješ pomoc?

Pokud někde uvízneš, napiš mi konkrétně:
- Ve kterém kroku jsi
- Jakou chybu vidíš
- Screenshot pokud možno

Pomohu ti to dořešit.

**Hodně štěstí, Michale! Až to spustíš, dej vědět jak to jde 🎉**
