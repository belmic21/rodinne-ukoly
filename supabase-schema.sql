-- ════════════════════════════════════════════════════════
-- RODINNÉ ÚKOLY — Supabase databázové schéma
-- ════════════════════════════════════════════════════════
-- Spusť tento skript v Supabase SQL Editoru (jednorázově)

-- ─── Tabulka uživatelů ───
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  pin TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Tabulka úkolů ───
CREATE TABLE IF NOT EXISTS tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  note TEXT,
  type TEXT DEFAULT 'simple',          -- 'simple' | 'complex'
  priority TEXT DEFAULT 'important',    -- 'urgent' | 'important' | 'low'
  category TEXT DEFAULT 'other',
  status TEXT DEFAULT 'active',         -- 'active' | 'in_progress' | 'done' | 'cancelled'
  due_date DATE,
  rec_days INTEGER DEFAULT 0,
  active_months INTEGER[] DEFAULT '{}',
  assign_to TEXT DEFAULT 'self',        -- 'self' | 'person' | 'both'
  assigned_to TEXT[] DEFAULT '{}',
  done_by TEXT[] DEFAULT '{}',
  seen_by TEXT[] DEFAULT '{}',
  checklist JSONB DEFAULT '[]'::jsonb,
  images JSONB DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  completed_by_user TEXT
);

-- ─── Indexy pro rychlejší dotazy ───
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);

-- ─── Realtime — povolit live aktualizace ───
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE users;

-- ─── Row Level Security (RLS) ───
-- Zjednodušený model: appka je rodinná, autentizace běží přes vlastní PIN systém,
-- proto povolujeme čtení/zápis přes anon key. Bezpečnost zajišťuje PIN kód v aplikaci.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Policy pro uživatele
CREATE POLICY "Allow all operations on users" ON users
  FOR ALL USING (true) WITH CHECK (true);

-- Policy pro úkoly
CREATE POLICY "Allow all operations on tasks" ON tasks
  FOR ALL USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════
-- HOTOVO! Databáze je připravená.
-- ════════════════════════════════════════════════════════
