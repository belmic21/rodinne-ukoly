-- ═══════════════════════════════════════════════════════════════
-- ZAVŘENÍ VEŘEJNÉHO ÚLOŽIŠTĚ FOTEK
--
-- CO TENHLE SKRIPT DĚLÁ
--   Udělá z bucketu task-images soukromý a nastaví, kdo do něj
--   smí. Dosud byl otevřený: kdo měl odkaz, viděl fotku bez
--   přihlášení — a odkaz byl jen název souboru.
--
-- CO MAŽE
--   NIC. Žádný soubor se nedotkne. Jde pustit i dvakrát.
--
-- ───────────────────────────────────────────────────────────────
-- CO SE DĚLO
--
--   Fotka u poznámky v checklistu se nahrávala do veřejného
--   bucketu a do poznámky se uložila veřejná adresa. Přílohy
--   u úkolů to měly správně od začátku — soukromý bucket
--   a podepsané odkazy s hodinovou platností. Tohle byla jediná
--   cesta ven.
--
--   Aplikace od verze 261101 ukládá do poznámky CESTU a adresu
--   si podepisuje až při zobrazení. Starší poznámky s veřejnou
--   adresou se poznají podle „http" a chodí dál.
--
-- ───────────────────────────────────────────────────────────────
-- POŘADÍ JE DŮLEŽITÉ
--
--   1. Nejdřív nasaď aplikaci (Vercel z main, verze 261101_xxxx).
--   2. Teprve potom pusť tenhle skript.
--
--   Obráceně by stará aplikace přestala fotky zobrazovat, dokud
--   se nová nenasadí — pár minut, ale zbytečně.
--
-- KDE TO PUSTIT
--   Supabase → SQL Editor → nový dotaz → vložit celé → Run.
--
-- Datum: 1. 11. 2026
-- ═══════════════════════════════════════════════════════════════


-- ══ 1. CO JE TEĎ ═══════════════════════════════════════════════
-- Tohle nic nemění, jen se dívá. „public = true" je ta díra.

select id as "bucket", public as "veřejný",
       (select count(*) from storage.objects o where o.bucket_id = b.id) as "souborů"
  from storage.buckets b
 where id in ('task-images', 'attachments')
 order by id;


-- ══ 2. ZAVŘÍT ══════════════════════════════════════════════════

update storage.buckets
   set public = false
 where id = 'task-images';


-- ══ 3. KDO DOVNITŘ SMÍ ═════════════════════════════════════════
-- Přihlášený uživatel. Fotky z rodinných úkolů vidí ti, kdo jsou
-- v aplikaci — stejně jako přílohy. Mezi sebou se neoddělují,
-- protože úkol je sdílená věc a fotka je jeho součást.
--
-- Anonymní přístup tím končí: i kdo má odkaz, bez přihlášení
-- nedostane nic. A odkazy z aplikace jsou navíc podepsané
-- a platí hodinu.

drop policy if exists task_images_cteni on storage.objects;
create policy task_images_cteni on storage.objects
  for select to authenticated
  using (bucket_id = 'task-images');

drop policy if exists task_images_zapis on storage.objects;
create policy task_images_zapis on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-images');

drop policy if exists task_images_mazani on storage.objects;
create policy task_images_mazani on storage.objects
  for delete to authenticated
  using (bucket_id = 'task-images');


-- ══ 4. KONTROLA ════════════════════════════════════════════════

-- a) Bucket už veřejný není. Čekáš „false".
select id as "bucket", public as "veřejný"
  from storage.buckets where id = 'task-images';

-- b) Pravidla sedí. Čekáš tři řádky.
select policyname as "pravidlo", cmd as "na co"
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'task_images_%'
 order by policyname;

-- Po tomhle zkus v aplikaci otevřít úkol s fotkou u poznámky.
-- Musí se zobrazit. Když ne, napiš mi dřív, než budeš cokoli
-- měnit — fotky jsou pořád na místě, jen se k nim nedostává.
