-- Run this once in the Supabase SQL editor to store the CV as structured blocks.
-- Safe to run multiple times (IF NOT EXISTS).
--
-- Career Studio M1: o currículo passa a ter os blocos (resumo, experiência,
-- projetos, skills, etc.) como fonte da verdade em JSON. A coluna `content`
-- (Markdown) continua existindo como derivação para PDF/retrocompatibilidade.

ALTER TABLE cvs
  ADD COLUMN IF NOT EXISTS content_blocks JSONB;

COMMENT ON COLUMN cvs.content_blocks IS
  'Blocos estruturados do currículo (CvBlock[]): id, type, title, content (Markdown), visible. Fonte da verdade do editor; `content` é o Markdown derivado.';
