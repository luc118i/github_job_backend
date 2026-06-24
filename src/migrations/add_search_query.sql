-- Run this once in the Supabase SQL editor.
-- Safe to run multiple times (IF NOT EXISTS).

-- Termo digitado nas buscas por texto (Route A de /profession-jobs).
-- NULL para buscas baseadas em perfil/LinkedIn (Route B).
ALTER TABLE searches
  ADD COLUMN IF NOT EXISTS query text DEFAULT NULL;

COMMENT ON COLUMN searches.query IS
  'Termo de busca digitado pelo usuário em buscas por texto. NULL para buscas por perfil. Usado para reaproveitar a última busca em "Descobrir Vagas".';
