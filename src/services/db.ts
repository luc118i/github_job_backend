import { Pool, QueryResultRow } from 'pg';

// Pool compartilhado — usa DATABASE_URL (Postgres puro, ex: Koyeb Postgres).
// Substitui o cliente @supabase/supabase-js.
// SSL: desligado para Postgres local (dev), ligado por padrão para bancos
// remotos (Koyeb, Neon, etc. exigem TLS). Sobrescreva com sslmode=disable/require na URL.
const url = process.env.DATABASE_URL ?? '';
const isLocal = /localhost|127\.0\.0\.1/.test(url);
const sslDisabled = url.includes('sslmode=disable');
const sslRequired = url.includes('sslmode=require');

export const pool = new Pool({
  connectionString: url,
  ssl: sslDisabled || (isLocal && !sslRequired) ? false : { rejectUnauthorized: false },
});

export interface DbResult<T> {
  data: T[];
  error: Error | null;
}

/**
 * Executa uma query parametrizada e devolve o formato { data, error }
 * usado nas rotas (mesmo contrato do antigo cliente supabase-js), sem
 * lançar exceção — quem chama decide o que fazer com `error`.
 */
export async function db<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<DbResult<T>> {
  try {
    const { rows } = await pool.query<T>(sql, params);
    return { data: rows, error: null };
  } catch (err) {
    return { data: [], error: err as Error };
  }
}

// Arrays/objetos precisam ser serializados p/ colunas JSONB — o driver `pg`
// só serializa automaticamente para colunas do tipo array nativo do Postgres.
function serialize(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

/**
 * Insere N linhas de uma vez (união das chaves presentes em cada linha;
 * ausentes são preenchidas com NULL). Equivalente ao `.insert([...])` do
 * supabase-js. Devolve as linhas inseridas (RETURNING *).
 */
export async function insertRows<T extends QueryResultRow = QueryResultRow>(
  table: string,
  rows: Record<string, unknown>[],
): Promise<DbResult<T>> {
  if (rows.length === 0) return { data: [], error: null };
  const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const params: unknown[] = [];
  const valuesSql = rows
    .map((row) => {
      const placeholders = columns.map((col) => {
        params.push(col in row ? serialize(row[col]) : null);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    })
    .join(', ');
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valuesSql} RETURNING *`;
  return db<T>(sql, params);
}
