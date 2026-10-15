-- ═══════════════════════════════════════════════════════════════
-- KDE KDO SEDÍ
--
-- CO TENHLE SKRIPT DĚLÁ
--   Přidává lidem obec a jednu čtecí funkci pro cestování.
--
-- CO MAŽE
--   NIC. Jde pustit i dvakrát za sebou.
--
-- ───────────────────────────────────────────────────────────────
-- PROČ
--
--   Michal: „teď mi napsal kamarád, majitel velké firmy z Brna,
--   a to jsem v Brně byl nedávno a zapomněl jsem na něj."
--
--   U člověka se dosud žádné místo neukládalo. map_people má
--   jméno, kontakt, poznámku, štítky rolí a „kde jsme se potkali"
--   jako volný text — ale nic, podle čeho by se dalo hledat
--   „kdo je v Brně". Mapa, kterou aplikace má, barví okresy podle
--   ZAKÁZEK, ne podle lidí.
--
--   Obec se bere z číselníku obcí, který v databázi už je
--   (6 247 obcí, 77 okresů). Díky tomu je u každého člověka
--   i okres — a z okresu se dá počítat, koho máš cestou.
--
-- ───────────────────────────────────────────────────────────────
-- CO TENHLE SKRIPT NEDĚLÁ
--
--   Nedoplňuje nikomu obec. Odvozovat ji ze zakázek, na kterých
--   ten člověk visí, by u poloviny lidí lhalo — investor z Brna
--   může řešit pozemek v Chebu. Doplní se ručně, v aplikaci.
--
-- ───────────────────────────────────────────────────────────────
-- PŘED SPUŠTĚNÍM
--   Pusť ruční zálohu: GitHub → rodinne-ukoly-zalohy → Actions
--   → Záloha databáze → Run workflow.
--
-- Datum: 15. 10. 2026, 19:30
-- ═══════════════════════════════════════════════════════════════


-- ══ 1. OBEC U ČLOVĚKA ══════════════════════════════════════════

alter table public.map_people
  add column if not exists obec_kod text;

comment on column public.map_people.obec_kod is
  'Kód obce podle ČSÚ — klíč do tabulky obce. Odtud se bere i okres. '
  'Prázdno znamená „nevím", ne „nikde".';

create index if not exists map_people_obec on public.map_people (owner, obec_kod);


-- ══ 2. LIDÉ I S MÍSTEM A POSLEDNÍM DOTYKEM ═════════════════════
-- Jeden dotaz pro obrazovku „Jedu do…". Vzdálenosti se počítají
-- až v aplikaci: těžiště okresů jsou v mapě, ne v databázi, a
-- tahat je sem podruhé by znamenalo dvě verze téhož čísla.

create or replace function public.lide_s_mistem()
returns table (
  person_id      uuid,
  name           text,
  contact        text,
  obec_kod       text,
  obec           text,
  okres          text,
  kraj           text,
  met_at         text,
  posledni_dotyk timestamptz,
  osloveni       int,
  ma_kartu       boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id, p.name, p.contact, p.obec_kod, o.nazev, o.okres, o.kraj, p.met_at,
    /* Poslední dotyk: kdy se s tím člověkem naposled něco dělo.
       Založení se nepočítá — zapsat si někoho není kontakt. */
    greatest(
      (select max(a.created_at) from public.deal_approaches a
        where a.person_id = p.id and a.owner = p.owner),
      (select max(f.created_at) from public.map_facts f
        where f.person_id = p.id and f.owner = p.owner),
      (select max(t.created_at) from public.deal_terminy t
        where t.person_id = p.id and t.owner = p.owner)
    ),
    (select count(*)::int from public.deal_approaches a
      where a.person_id = p.id and a.owner = p.owner),
    exists (select 1 from public.deal_cards c
             where c.person_id = p.id and c.owner = p.owner and c.aktivni)
  from public.map_people p
  left join public.obce o on o.kod = p.obec_kod
  where p.owner = public.me()
$$;

comment on function public.lide_s_mistem is
  'Lidé přihlášeného uživatele i s obcí, okresem a tím, kdy se s nimi '
  'naposled něco dělo. Podklad pro „Jedu do…". security invoker.';

grant execute on function public.lide_s_mistem() to authenticated;


-- ══ 3. KONTROLA ════════════════════════════════════════════════

-- a) Sloupec i funkce stojí.
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='map_people'
      and column_name='obec_kod')                                as "sloupec obec_kod",
  (select count(*) from pg_proc where proname='lide_s_mistem')   as "funkce";
-- Čekáš 1 a 1.

-- b) Kolik lidí už obec má. Po prvním spuštění nula — doplňuje se
--    v aplikaci, skript nikomu nic nehádá.
select count(*) filter (where obec_kod is not null) as "s obcí",
       count(*) filter (where obec_kod is null)     as "bez obce",
       count(*)                                      as "celkem"
from public.map_people;

-- c) Zkouška naživo. V SQL editoru vrátí 0 řádků — me() tam není
--    nikdo přihlášený. Skutečná čísla uvidíš v aplikaci.
select count(*) as "lidí z funkce" from public.lide_s_mistem();
