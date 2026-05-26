-- Run this once in the Supabase SQL editor to add the original posting date column.
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

COMMENT ON COLUMN jobs.published_at IS
  'Original publication date reported by the source platform (Remotive, Adzuna, Gupy, etc.). NULL for AI-discovered jobs.';
