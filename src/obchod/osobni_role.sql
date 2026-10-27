-- ═══════════════════════════════════════════════════════════════
-- FÁZE 1c — OSOBNÍ KATEGORIE
--
-- CO TENHLE SKRIPT DĚLÁ
--   Přidá do číselníku rolí osobní skupinu: rodina, přátelé,
--   řemeslo, finance, zdraví, úřady a firmy. Stávající role
--   označí jako obchodní.
--
-- CO MAŽE
--   NIC. Jde pustit i dvakrát za sebou — role, která už existuje,
--   se přeskočí a tvoje úpravy (jiný popisek, jiné pořadí)
--   zůstanou.
--
-- ───────────────────────────────────────────────────────────────
-- PROČ ROLE A NE NOVÁ ŠKATULKA
--
--   Michal: „osobní kontakty bych rozdělil na služby, rodinu
--   a přátele. Nevím úplně, jak je třídit, aniž bych je nemusel
--   mazat."
--
--   Nová osa by nutila vybrat, co je „víc". Soused ale bývá
--   instalatér a nájemník bývá kamarád — a role se dají mít dvě.
--   Proto jeden číselník rolí a sloupec skupina, který v
--   deal_enums odjakživa je.
--
--   Co z toho plyne hned, bez jediné další řádky kódu:
--     · filtr podle role v Lidech funguje i na osobní,
--     · hromadná změna role funguje i na osobní,
--     · přepínač režimu v hlavičce (vše / pracovní / osobní)
--       drží obchodní seznam čistý.
--
-- ───────────────────────────────────────────────────────────────
-- KATEGORIE ZÁMĚRNĚ ŠIROKÉ
--
--   Osm přihrádek se dá přečíst na jeden pohled, dvacet ne —
--   a u tří tisíc kontaktů rozhoduje, jak dlouho trvá vybrat.
--
--   Začít hrubě nic nestojí: až zjistíš, že „Řemeslo a služby"
--   je ve skutečnosti instalatér, elektrikář a zahradník,
--   vyfiltruješ si je v Lidech a hromadnou změnou role rozdělíš.
--   Opačně, ze dvaceti přihrádek zpátky, to nejde.
--
--   Popisky i pořadí si přepíšeš sám v Nastavení → Seznamy.
--   Klávesy ve vlně se přerovnají podle pořadí.
--
-- ───────────────────────────────────────────────────────────────
-- PŘED SPUŠTĚNÍM
--   Pusť ruční zálohu: GitHub → rodinne-ukoly-zalohy → Actions
--   → Záloha databáze → Run workflow.
--
-- KDE TO PUSTIT
--   Supabase → SQL Editor → nový dotaz → vložit celé → Run.
--
-- Datum: 27. 10. 2026
-- ═══════════════════════════════════════════════════════════════


-- ══ 1. STÁVAJÍCÍ ROLE JSOU OBCHODNÍ ════════════════════════════
-- Jen těm, které skupinu zatím nemají. Kdo si ji už nastavil,
-- o ni nepřijde.
--
-- Aplikace bere jako osobní jen skupinu 'osobni' a všechno
-- ostatní za obchodní, takže tenhle krok není nutný k běhu —
-- je kvůli tomu, aby bylo v Nastavení → Seznamy vidět, co kam
-- patří.

update public.deal_enums
   set skupina = 'obchod'
 where kind = 'role'
   and (skupina is null or skupina = '');


-- ══ 2. OSOBNÍ KATEGORIE ════════════════════════════════════════
-- Zakládají se každému vlastníkovi, který už nějaké role má —
-- tím se trefí do tvého účtu, aniž bys sem psal svoje jméno.
--
-- sort_order 100+ drží osobní pod obchodními; ve vlně jsou
-- stejně v jiném kroku, ale v Nastavení se to pak lépe čte.

insert into public.deal_enums (owner, kind, key, label, skupina, sort_order, active)
select v.owner, 'role', n.key, n.label, 'osobni', n.poradi, true
  from (select distinct owner from public.deal_enums where kind = 'role') v
 cross join (values
    ('rodina',    'Rodina',                        110),
    ('pratele',   'Přítel / známý',                120),
    ('soused',    'Soused',                        130),
    ('najemnik',  'Nájemník',                      140),
    ('remeslo',   'Řemeslo a služby',              150),
    ('finance',   'Finance a pojištění',           160),
    ('zdravi',    'Zdraví',                        170),
    ('firma_os',  'Firma / úřad (auto, e-shop)',   180)
 ) as n(key, label, poradi)
 where not exists (
   select 1 from public.deal_enums d
    where d.owner = v.owner and d.kind = 'role' and d.key = n.key
 );


-- ══ 3. KONTROLA ════════════════════════════════════════════════

-- a) Jak se role rozdělily. U svého jména čekáš 8 osobních
--    a svoje dosavadní obchodní.
--
--    Dělí se po vlastnících schválně: číselník má každý svůj,
--    takže součet přes všechny by jen mátl — při dvou lidech
--    by u osmi kategorií hlásil šestnáct.
select owner                                      as "vlastník",
       coalesce(skupina, '(bez skupiny)')         as "skupina",
       count(*)                                   as "rolí",
       string_agg(label, ', ' order by sort_order) as "které"
  from public.deal_enums
 where kind = 'role'
 group by owner, skupina
 order by owner, skupina;

-- b) Ve vlně se na klávesy 1–9 vejde devět rolí v každém kroku.
--    Co je nad to, jde naklikat myší — ale je to signál, že je
--    přihrádek moc. Čekáš u sebe dvakrát „vejde se".
select owner as "vlastník",
  case when count(*) filter (where skupina is distinct from 'osobni') <= 9
       then 'vejde se' else 'POZOR: obchodních rolí je víc než 9' end as "obchodní",
  case when count(*) filter (where skupina = 'osobni') <= 9
       then 'vejde se' else 'POZOR: osobních rolí je víc než 9' end   as "osobní"
  from public.deal_enums
 where kind = 'role' and active
 group by owner
 order by owner;
