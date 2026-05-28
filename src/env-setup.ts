/**
 * Must be imported as the FIRST import in index.ts.
 * Loads .env with override:true so .env values take precedence over
 * stale/empty system env vars set at the OS level (common in dev environments).
 *
 * In production without a .env file, the real system/CI env vars still win
 * because dotenv.config() is a no-op when there is no .env file.
 */
import dotenv from 'dotenv';

dotenv.config({ override: true });
