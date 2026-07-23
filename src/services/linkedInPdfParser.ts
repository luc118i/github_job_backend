// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfModule = require('pdf-parse');
const pdf = (pdfModule.default ?? pdfModule) as (buf: Buffer) => Promise<{ text: string }>;
import { LinkedInData } from '../types';
import { parseResumeText } from './resumeParser';

/** Extrai texto de qualquer PDF de currículo (LinkedIn ou não) e delega ao parser genérico. */
export async function parseLinkedInPdf(buffer: Buffer): Promise<LinkedInData> {
  const { text } = await pdf(buffer);
  return parseResumeText(text);
}
