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

function parseProfile(zip: AdmZip): { name: string | null; phone: string | null } {
  const csv = findCsv(zip, 'Profile.csv');
  if (!csv) return { name: null, phone: null };

  const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  if (!records.length) return { name: null, phone: null };

  const r = records[0];
  const first = r['First Name'] ?? '';
  const last = r['Last Name'] ?? '';
  const name = [first, last].filter(Boolean).join(' ') || null;

  const phoneCsv = findCsv(zip, 'PhoneNumbers.csv') ?? findCsv(zip, 'Phone Numbers.csv');
  let phone: string | null = null;
  if (phoneCsv) {
    const phoneRecords = parse(phoneCsv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
    phone = phoneRecords[0]?.['Phone Number'] ?? null;
  }

  return { name, phone };
}

function parseEmail(zip: AdmZip): string | null {
  const csv = findCsv(zip, 'Email Addresses.csv') ?? findCsv(zip, 'EmailAddresses.csv');
  if (!csv) return null;

  const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  const primary = records.find((r) => r['Primary']?.toLowerCase() === 'yes') ?? records[0];
  return primary?.['Email Address'] ?? null;
}

export function parseLinkedInZip(buffer: Buffer): LinkedInData {
  const zip = new AdmZip(buffer);
  const { name, phone } = parseProfile(zip);
  return {
    name,
    email: parseEmail(zip),
    phone,
    positions: parsePositions(zip),
    education: parseEducation(zip),
  };
}
