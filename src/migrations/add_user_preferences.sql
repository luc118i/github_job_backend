-- Run this once in the Supabase SQL editor.
-- Safe to run multiple times (IF NOT EXISTS / OR REPLACE).

-- Career profile (already added previously, kept here for reference)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS career_profile JSONB DEFAULT NULL;

-- Job feedback preferences (blocked/liked keywords and sources)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.career_profile IS
  'Career profile collected via onboarding chat. Contains goals, work style, transition targets, etc.';

COMMENT ON COLUMN users.preferences IS
  'Job feedback preferences: blocked_keywords, liked_keywords, blocked_sources, liked_sources.';
