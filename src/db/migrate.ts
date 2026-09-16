import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ override: true });

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const sslDisabled = url.includes('sslmode=disable');
  const sslRequired = url.includes('sslmode=require');
  const pool = new Pool({
    connectionString: url,
    ssl: sslDisabled || (isLocal && !sslRequired) ? false : { rejectUnauthorized: false },
  });

  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  const statements = splitStatements(sql);
  console.log(`[migrate] aplicando src/db/schema.sql (${statements.length} comandos)...`);

  // Executa um comando por vez — alguns poolers (pgbouncer/Neon) não lidam
  // bem com uma única mensagem multi-statement e podem descartá-la em
  // silêncio sem erro, deixando o schema parcialmente (ou nada) aplicado.
  for (const statement of statements) {
    await pool.query(statement);
  }

  console.log('[migrate] schema aplicado com sucesso.');
  await pool.end();
}

// Divide o arquivo SQL em comandos individuais, respeitando blocos $$...$$
// (usados no corpo de funções) para não quebrar no ";" de dentro deles.
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarBlock = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '$' && sql[i + 1] === '$') {
      inDollarBlock = !inDollarBlock;
      current += '$$';
      i++;
      continue;
    }
    current += sql[i];
    if (sql[i] === ';' && !inDollarBlock) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((s) => s.length > 0);
}

main().catch((err) => {
  console.error('[migrate] falhou:', err);
  process.exit(1);
});
