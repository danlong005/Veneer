// Reads a screens folder for `veneer check` (check.ts): every definition,
// macro and recorded screen, with a finding for each file that can't be
// used, then the checks in @veneer/screens.

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RECORDINGS_DIR, checkScreens, validateDefinition, validateMacro, validateRecording,
  type CheckFinding, type Macro, type Recording, type ScreenDefinition,
} from '@veneer/screens';

/** Files in the screens folder that are not definitions. */
const NOT_DEFINITIONS = new Set(['global.style.json']);

export interface FolderCheck {
  definitions: number;
  macros: number;
  recordings: number;
  findings: CheckFinding[];
}

export async function checkFolder(dir: string): Promise<FolderCheck> {
  const problems: CheckFinding[] = [];
  const read = async <T>(file: string, validate: (v: unknown) => T, name: (v: T) => string): Promise<T | undefined> => {
    try {
      const text = await fs.readFile(path.join(dir, file), 'utf8');
      let json: unknown;
      try { json = JSON.parse(text); } catch (err) { throw new Error(`It is not valid JSON: ${(err as Error).message}`); }
      const value = validate(json);
      const expected = `${name(value)}.json`;
      if (path.basename(file) !== expected) throw new Error(`Its name is "${name(value)}", so the file must be called ${expected}.`);
      return value;
    } catch (err) {
      problems.push({ level: 'error', file, message: (err as Error).message });
      return undefined;
    }
  };

  const definitions: ScreenDefinition[] = [];
  for (const name of await jsonFiles(dir)) {
    if (NOT_DEFINITIONS.has(name)) continue;
    const def = await read(name, validateDefinition, (d) => d.id);
    if (def) definitions.push(def);
  }
  const macros: Macro[] = [];
  for (const name of await jsonFiles(path.join(dir, 'macros'))) {
    const macro = await read(`macros/${name}`, validateMacro, (m) => m.name);
    if (macro) macros.push(macro);
  }
  const recordings: Recording[] = [];
  for (const name of await jsonFiles(path.join(dir, RECORDINGS_DIR))) {
    const r = await read(`${RECORDINGS_DIR}/${name}`, validateRecording, (x) => x.name);
    if (r) recordings.push(r);
  }
  const findings = [...problems, ...checkScreens({ definitions, macros, recordings })];
  findings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  return { definitions: definitions.length, macros: macros.length, recordings: recordings.length, findings };
}

async function jsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export type ReportFormat = 'text' | 'github' | 'json';

/** The report as text for a person, GitHub Actions annotations, or JSON. */
export function formatReport(result: FolderCheck, dir: string, format: ReportFormat): string {
  if (format === 'json') return JSON.stringify(result, null, 2);
  const errors = result.findings.filter((f) => f.level === 'error').length;
  const warnings = result.findings.length - errors;
  const counted = `${plural(result.definitions, 'definition')}, ${plural(result.macros, 'macro')} and ${plural(result.recordings, 'recorded screen')}`;
  const summary = `Checked ${counted}: ${errors === 0 && warnings === 0 ? 'no problems.' : `${plural(errors, 'error')}, ${plural(warnings, 'warning')}.`}`;
  if (format === 'github') {
    // Paths relative to the repository root, so annotations land on the file.
    const rel = path.relative(process.cwd(), dir) || '.';
    const lines = result.findings.map((f) => `::${f.level} file=${path.posix.join(rel.split(path.sep).join('/'), f.file)},title=Veneer check::${escape(f.message)}`);
    return [...lines, summary].join('\n');
  }
  const byFile = new Map<string, CheckFinding[]>();
  for (const f of result.findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const out: string[] = [];
  for (const [file, list] of byFile) {
    out.push(file);
    for (const f of list) out.push(`  ${f.level === 'error' ? 'error  ' : 'warning'}  ${f.message}`);
  }
  if (result.recordings === 0) out.push(`No screens are recorded in ${RECORDINGS_DIR}/, so only the files themselves were checked. Record screens from the designer (Record for checks).`);
  out.push(summary);
  return out.join('\n');
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** GitHub workflow commands need %, CR and LF escaped. */
const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
