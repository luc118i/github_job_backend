/**
 * Must be imported as the FIRST import in index.ts.
 * Loads .env with override:true so .env values take precedence over
 * stale/empty system env vars set at the OS level (common in dev environments).
 *
 * In production without a .env file, the real system/CI env vars still win
 * because dotenv.config() is a no-op when there is no .env file.
 */
import dotenv from 'dotenv';
import { setGlobalDispatcher, Agent } from 'undici';

dotenv.config({ override: true });

// ── Variáveis de ambiente obrigatórias ───────────────────────────────
// Falha imediatamente no boot se alguma estiver ausente — melhor que crash silencioso em runtime.
const REQUIRED_ENV: string[] = [
  'JWT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[env] ERRO: variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`);
  console.error('[env] Configure o arquivo .env antes de iniciar o servidor.');
  process.exit(1);
}

// Força IPv4 em todas as requisições fetch (undici).
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));
