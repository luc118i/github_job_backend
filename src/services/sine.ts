/**
 * Emprega Brasil / SINE — desativado temporariamente.
 * O portal MTE apresenta falha de TLS e não retorna dados via REST.
 * Mantemos o export para não quebrar imports; retorna [] para não travar o fluxo.
 */
import { AdzunaJob } from './adzuna';
import { UserPreferences } from '../types';

export async function searchSineJobs(
  _queries: string[],
  _preferences?: UserPreferences,
  _blockedKeywords?: string[],
): Promise<AdzunaJob[]> {
  return [];
}
