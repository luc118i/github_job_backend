import { UserPreferences } from '../types';

/**
 * Formata as preferências do usuário em bloco de texto para incluir nos prompts de IA.
 * Usado por claude.ts e gemini.ts — centralizado aqui para evitar duplicação.
 */
export function buildPrefsBlock(prefs: UserPreferences | undefined): string {
  if (!prefs) return '';
  const lines: string[] = [];
  const modalityLabel: Record<string, string> = {
    remote: 'Remoto',
    presencial: 'Presencial',
    hybrid: 'Híbrido',
    any: '',
  };
  if (prefs.modality !== 'any') lines.push(`Modalidade: ${modalityLabel[prefs.modality]}`);
  if (prefs.location) lines.push(`Local preferido: ${prefs.location}`);
  if (prefs.salaryMin || prefs.salaryMax) {
    const range = [
      prefs.salaryMin && `R$ ${prefs.salaryMin}`,
      prefs.salaryMax && `R$ ${prefs.salaryMax}`,
    ]
      .filter(Boolean)
      .join(' – ');
    lines.push(`Faixa salarial: ${range}`);
  }
  if (prefs.level !== 'any') lines.push(`Nível: ${prefs.level}`);
  if (prefs.maxAgeDays) lines.push(`Período máximo: ${prefs.maxAgeDays} dias`);
  return lines.length ? '\n\nPREFERÊNCIAS (priorize):\n' + lines.join('\n') : '';
}
