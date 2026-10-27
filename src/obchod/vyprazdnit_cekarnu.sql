-- ═══════════════════════════════════════════════════════════════
-- VYPRÁZDNĚNÍ ČEKÁRNY PO ŠPATNÉM IMPORTU
--
-- CO TENHLE SKRIPT DĚLÁ
--   Smaže z čekárny kontakty z jednoho souboru — ale JEN ty,
--   o kterých jsi ještě nerozhodl.
--
-- CO NESMAŽE
--   · Nikoho z Lidí. Koho jsi už zařadil, zůstává.
--   · Žádný řádek čekárny, u kterého jsi klikl (zařazeno,
--     osobní, odloženo). Ty jen vypíše, ať víš, co s nimi.
--
--   Je to schválně opatrné. Špatný import se dá zopakovat,
--   smazaný člověk s poznámkou ne.
--
-- ───────────────────────────────────────────────────────────────
-- JAK TO POUŽÍT
--
--   1. Pusť nejdřív jen ČÁST 1 (označ ji myší a dej Run).
--      Ukáže, co v čekárně je a z jakého souboru.
--   2. V ČÁSTI 2 nahraď <SOUBOR> názvem ze sloupce „z jakého
--      souboru". Apostrofy nech, měň jen text mezi nimi.
--   3. Pusť ČÁST 2.
--
-- Datum: 27. 10. 2026
-- ═══════════════════════════════════════════════════════════════


-- ══ ČÁST 1 — CO V ČEKÁRNĚ JE ═══════════════════════════════════
-- Tohle nic nemění, jen se dívá.

select
  coalesce(zdroj, '(bez názvu)')               as "z jakého souboru",
  count(*)                                     as "celkem",
  count(*) filter (where stav = 'ceka')        as "nerozhodnuto",
  count(*) filter (where stav = 'zarazeno')    as "už v Lidech",
  count(*) filter (where stav = 'osobni')      as "už osobní",
  count(*) filter (where stav = 'odlozeno')    as "odloženo",
  min(created_at)                              as "naimportováno"
from public.map_cekarna
group by zdroj
order by min(created_at);

-- Ukázka pěti jmen, ať je vidět, jak se rozebrala.
select name as "jméno", contact as "kontakt", firma as "firma", zdroj as "soubor"
  from public.map_cekarna
 where stav = 'ceka'
 order by created_at
 limit 5;


-- ══ ČÁST 2 — SMAZÁNÍ ═══════════════════════════════════════════
-- Spusť až poté, co sis v části 1 ověřil název souboru.

do $$
declare
  -- ↓↓↓ JEDINÉ MÍSTO, KAM SE PÍŠE ↓↓↓
  v_zdroj text := '<SOUBOR>';
  -- ↑↑↑ ------------------------- ↑↑↑
  v_smazano int;
  v_zustalo int;
  v_lidi    int;
begin
  /* Pojistka je tvarová, ne porovnáním s výplní: kdybys v editoru
     dal „nahradit vše", změnila by se i pojistka a zablokovala by
     tě, i když jsi název vyplnil správně. Název souboru lomené
     závorky neobsahuje, výplň ano. */
  if v_zdroj like '%<%' or v_zdroj like '%>%' or length(v_zdroj) < 3 then
    raise exception 'Název souboru ještě není vyplněný. Nahraď <SOUBOR> hodnotou z části 1.';
  end if;

  if not exists (select 1 from public.map_cekarna where zdroj = v_zdroj) then
    raise exception 'Soubor „%" v čekárně není. Zkontroluj název v části 1 — musí sedět přesně.', v_zdroj;
  end if;

  -- Co už prošlo tvým rozhodnutím, se nemaže.
  select count(*) into v_zustalo
    from public.map_cekarna where zdroj = v_zdroj and stav <> 'ceka';

  select count(*) into v_lidi
    from public.map_cekarna where zdroj = v_zdroj and person_id is not null;

  delete from public.map_cekarna
   where zdroj = v_zdroj and stav = 'ceka';
  get diagnostics v_smazano = row_count;

  raise notice 'Smazáno nerozhodnutých: %', v_smazano;
  if v_zustalo > 0 then
    raise notice 'Ponecháno rozhodnutých: % (z toho % vzniklo jako člověk v Lidech)', v_zustalo, v_lidi;
    raise notice 'Ty si projdi ručně — výpis je níž.';
  else
    raise notice 'Rozhodnuto nebylo nic, čekárna je z tohohle souboru prázdná.';
  end if;
end $$;


-- ══ ČÁST 3 — KOHO SIS UŽ ZAŘADIL ═══════════════════════════════
-- Pokud měli špatné jméno, oprav je v Lidech v kartě člověka,
-- nebo je tam smaž a přijdou znovu s novým importem.

select c.name     as "jak to přišlo ze souboru",
       p.name     as "jak je uložený v Lidech",
       c.stav     as "stav",
       p.id       as "id člověka"
  from public.map_cekarna c
  left join public.map_people p on p.id = c.person_id
 where c.stav <> 'ceka'
 order by c.zpracovano_at desc nulls last;
