import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { LinkedInData, LinkedInPosition, LinkedInEducation } from '../types';

function findCsv(zip: AdmZip, filename: string): string | null {
  const entry = zip.getEntries().find(
    (e) => e.name === filename || e.entryName.endsWith(`/${filename}`)
  );
  if (!entry) return null;
  return entry.getData().toString('utf8').replace(/^﻿/, '');
}

function parsePositions(zip: AdmZip): LinkedInPosition[] {
  const csv = findCsv(zip, 'Positions.csv');
  if (!csv) return [];

  const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];

  return records.map((r) => ({
    company: r['Company Name'] ?? '',
    title: r['Title'] ?? '',
    description: r['Description'] || null,
    location: r['Location'] || null,
    startedOn: r['Started On'] ?? '',
    finishedOn: !r['Finished On'] || r['Finished On'] === 'Present' ? null : r['Finished On'],
  }));
}

function parseEducation(zip: AdmZip): LinkedInEducation[] {
  const csv = findCsv(zip, 'Education.csv');
  if (!csv) return [];

  const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];

  return records.map((r) => ({
    school: r['School Name'] ?? '',
    degree: r['Degree Name'] || null,
    startDate: r['Start Date'] || null,
    endDate: r['End Date'] || null,
    notes: r['Notes'] || null,
  }));
}

export function parseLinkedInZip(buffer: Buffer): LinkedInData {
  const zip = new AdmZip(buffer);
  return {
    positions: parsePositions(zip),
    education: parseEducation(zip),
  };
}
