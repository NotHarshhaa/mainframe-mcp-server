/**
 * JCL dataset-flow parser for job dependency analysis.
 *
 * Parses JOB/EXEC structure and DD statements to classify datasets as inputs
 * (DISP=SHR), updates (DISP=OLD), or outputs (NEW/MOD), and surfaces the PROCs
 * a job calls. The result lets an agent (or the `job_dependencies` tool)
 * reason about upstream/downstream batch dependencies from the JCL alone.
 *
 * Limitations (documented in the tool output):
 *   - PROCs are not expanded (their DDs live in procedure libraries).
 *   - Concatenated datasets after `DD *`/`DATA` instream data are skipped.
 *   - Backward-referenced DSNs (`*.DDNAME`) are reported as references.
 */
import { ValidationError } from './errors.js';

export type DatasetUsage = 'input' | 'output' | 'update' | 'reference' | 'instream';

export interface DatasetFlow {
  /** Dataset name (normalized upper-case) or `*.DDNAME` backward reference. */
  dsn: string;
  /** Raw DISP as written in the JCL (e.g. "(NEW,CATLG,DELETE)"). */
  disp?: string;
  usage: DatasetUsage;
}

export interface JclStep {
  stepName: string;
  /** `PGM=NAME` when a program is executed. */
  program?: string;
  /** PROC name when the step executes a cataloged procedure. */
  proc?: string;
  /** Cond parameter expression, when present. */
  cond?: string;
  ddnames: { ddName: string; flows: DatasetFlow[] }[];
}

export interface JobDependencyAnalysis {
  jobName: string | null;
  steps: JclStep[];
  inputDatasets: string[];
  outputDatasets: string[];
  updateDatasets: string[];
  /** Cataloged procedures invoked (not expanded). */
  procedures: string[];
  /** Analysis caveats the agent should know. */
  notes: string[];
}

const DSNAME_RE = /^DSN(AME)?=([^,\s]+)/i;

/** Join JCL continuation lines (statements start with `//`, no space after). */
function joinContinuations(text: string): string[] {
  const statements: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.startsWith('//')) continue; // instream data or blank
    if (line.startsWith('//*')) continue; // comment
    const trimmed = line.replace(/\s+$/, '');
    const last = statements[statements.length - 1];
    if (last != null && /^\/\/\s/.test(trimmed)) {
      // Continuation: `//` followed by whitespace continues the previous statement.
      statements[statements.length - 1] = last + trimmed.replace(/^\/\/\s*/, ' ');
    } else if (last != null && last.endsWith(',')) {
      statements[statements.length - 1] = last + trimmed.replace(/^\/\//, '');
    } else {
      statements.push(trimmed);
    }
  }
  return statements;
}

/** Classify a DISP into usage. */
export function classifyDisps(disp: string | undefined): DatasetUsage {
  const upper = (disp ?? '').toUpperCase();
  if (!upper) return 'reference';
  if (/\bNEW\b/.test(upper)) return 'output';
  if (/\bMOD\b/.test(upper)) return 'output';
  if (/\bSHR\b/.test(upper)) return 'input';
  if (/\bOLD\b/.test(upper)) return 'update';
  return 'reference';
}

/** Extract DSN + DISP from a DD statement body (everything after `DD`). */
export function parseDdStatement(statement: string): { ddName: string; flows: DatasetFlow[] } | null {
  const m = statement.match(/^\/\/(\S+)\s+DD\s+(.*)$/i);
  if (!m) return null;
  const ddName = m[1].toUpperCase();
  const body = m[2];
  const flows: DatasetFlow[] = [];

  // Instream data or dummy/no-referenced DDs.
  if (/^\s*\*/.test(body) || /^\/\*/.test(body)) {
    flows.push({ dsn: '(instream)', usage: 'instream' });
    return { ddName, flows };
  }
  if (/^\s*DUMMY\b/i.test(body) || /^\s*DD\s+DUMMY/i.test(body)) {
    return { ddName, flows: [{ dsn: 'DUMMY', usage: 'reference' }] };
  }

  // Split parameters on commas that are not inside parentheses.
  const params: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      params.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) params.push(current);

  let disp: string | undefined;
  for (const param of params) {
    const dsnMatch = param.match(DSNAME_RE);
    if (dsnMatch) {
      flows.push({ dsn: dsnMatch[2].toUpperCase(), usage: 'reference' });
      continue;
    }
    if (/^DISP=/i.test(param)) {
      disp = param.replace(/^DISP=/i, '').trim();
    }
  }

  const usage = classifyDisps(disp);
  for (const flow of flows) {
    if (flow.usage === 'reference') flow.usage = usage;
    flow.disp = disp;
  }
  return { ddName, flows };
}

/** Parse EXEC statements into steps with program/PROC info. */
function parseExecStatement(statement: string): JclStep | null {
  const m = statement.match(/^\/\/(\S+)\s+EXEC\s+(.*)$/i);
  if (!m) return null;
  const stepName = m[1].toUpperCase();
  const body = m[2];

  const procMatch = body.match(/(?:^|,)\s*PROC\s*=\s*([A-Z0-9@#$]{1,8})/i);
  const proc = procMatch ? procMatch[1].toUpperCase() : undefined;
  const pgmMatch = body.match(/PGM\s*=\s*([A-Z0-9@#$]{1,8})/i);
  const program = pgmMatch ? pgmMatch[1].toUpperCase() : undefined;
  const condMatch = body.match(/COND\s*=\s*(\([^)]*\)|EVEN|ONLY)/i);

  return {
    stepName,
    program: proc ? undefined : program,
    proc: proc ?? (!proc && !program && body.trim() && !/^PGM/i.test(body.trim()) ? body.split(',')[0].trim().toUpperCase() : undefined),
    cond: condMatch ? condMatch[1].toUpperCase() : undefined,
    ddnames: [],
  };
}

/**
 * Parse JCL text into a full dependency analysis. Throws ValidationError when
 * the text does not look like JCL at all.
 */
export function analyzeJclDependencies(raw: string): JobDependencyAnalysis {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!/^\/\//m.test(text)) {
    throw new ValidationError('Input does not look like JCL (no "//" statements found).');
  }

  const jobCard = text.match(/^\/\/([A-Z0-9@#$]{1,8})\s+JOB\b/im);
  const statements = joinContinuations(text);

  const steps: JclStep[] = [];
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  const updates = new Set<string>();
  const procs = new Set<string>();

  for (const statement of statements) {
    if (/^\/\/\S+\s+EXEC\s/i.test(statement)) {
      const step = parseExecStatement(statement);
      if (step) {
        steps.push(step);
        if (step.proc) procs.add(step.proc);
      }
      continue;
    }
    if (/^\/\/\S+\s+DD\s/i.test(statement) && steps.length > 0) {
      const dd = parseDdStatement(statement);
      if (dd) {
        steps[steps.length - 1].ddnames.push(dd);
        for (const flow of dd.flows) {
          if (flow.dsn === 'DUMMY' || flow.usage === 'instream') continue;
          if (flow.usage === 'input') inputs.add(flow.dsn);
          else if (flow.usage === 'output') outputs.add(flow.dsn);
          else if (flow.usage === 'update') updates.add(flow.dsn);
        }
      }
    }
  }

  return {
    jobName: jobCard ? jobCard[1].toUpperCase() : null,
    steps,
    inputDatasets: [...inputs].sort(),
    outputDatasets: [...outputs].sort(),
    updateDatasets: [...updates].sort(),
    procedures: [...procs].sort(),
    notes: [
      'PROCs are not expanded — DD statements inside cataloged procedures are not visible here.',
      'Backward references (*.DDNAME) and GDG generations carry over from the named dataset/DD.',
      'Datasets written by jobs that are not in this JCL must be correlated from other jobs\' output lists.',
    ],
  };
}
