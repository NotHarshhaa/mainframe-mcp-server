/**
 * Response formatters that turn normalized z/OS objects into compact,
 * AI-friendly text. Box-drawing tables mirror the examples in the README.
 */
import type { Dataset, Job, JobFailureAnalysis, Member, SpoolFile, UssEntry } from '../types/zos.js';
import type { TextToolResult } from '../types/tools.js';

/** Build a standard (non-error) MCP text result. */
export function textResult(text: string): TextToolResult {
  return { content: [{ type: 'text', text }] };
}

/**
 * Render a simple box-drawing table.
 *
 * @param headers - Column headers.
 * @param rows - Row cells (each row must match the header length).
 */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] ?? '').length)),
  );

  const pad = (value: string, width: number) => value.padEnd(width, ' ');
  const line = (left: string, mid: string, right: string) =>
    left + widths.map((w) => '─'.repeat(w + 2)).join(mid) + right;

  const renderRow = (cells: string[]) =>
    '│ ' + cells.map((cell, i) => pad(cell ?? '', widths[i])).join(' │ ') + ' │';

  if (rows.length === 0) {
    return [line('┌', '┬', '┐'), renderRow(headers), line('└', '┴', '┘')].join('\n');
  }

  return [
    line('┌', '┬', '┐'),
    renderRow(headers),
    line('├', '┼', '┤'),
    ...rows.map(renderRow),
    line('└', '┴', '┘'),
  ].join('\n');
}

/** Truncate text to a maximum number of lines, adding a clear notice. */
export function truncateLines(
  text: string,
  maxLines: number,
): { text: string; truncated: boolean; totalLines: number } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { text, truncated: false, totalLines: lines.length };
  }
  const kept = lines.slice(0, maxLines).join('\n');
  return {
    text: `${kept}\n... [truncated ${lines.length - maxLines} of ${lines.length} lines]`,
    truncated: true,
    totalLines: lines.length,
  };
}

/** Format a list of jobs as a table. */
export function formatJobList(jobs: Job[]): string {
  if (jobs.length === 0) return 'No jobs matched the given filters.';
  const rows = jobs.map((job) => [
    job.jobName,
    job.jobId,
    job.owner,
    job.status,
    job.returnCode ?? '—',
  ]);
  const header = `Jobs (${jobs.length} found)\n\n`;
  return header + renderTable(['Job Name', 'Job ID', 'Owner', 'Status', 'Return Code'], rows);
}

/** Format a single job's status as an aligned key/value block. */
export function formatJobStatus(job: Job): string {
  const lines = [
    `Job:          ${job.jobName} (${job.jobId})`,
    `Owner:        ${job.owner}`,
    `Status:       ${job.status}`,
    `Return Code:  ${job.returnCode ?? '(running)'}`,
  ];
  if (job.class) lines.push(`Class:        ${job.class}`);
  if (job.subsystem) lines.push(`Subsystem:    ${job.subsystem}`);
  if (job.phase) lines.push(`Phase:        ${job.phase}`);
  return lines.join('\n');
}

/** Format the spool (DD) file inventory of a job. */
export function formatSpoolFiles(jobName: string, jobId: string, files: SpoolFile[]): string {
  if (files.length === 0) return `No spool files found for ${jobName} (${jobId}).`;
  const rows = files.map((file) => [
    String(file.id),
    file.ddName,
    file.stepName ?? '—',
    file.procStep ?? '—',
    file.recordCount != null ? String(file.recordCount) : '—',
  ]);
  const header = `Spool files for ${jobName} (${jobId})\n\n`;
  return header + renderTable(['ID', 'DD Name', 'Step', 'ProcStep', 'Records'], rows);
}

/** Format a dataset list. */
export function formatDatasetList(datasets: Dataset[]): string {
  if (datasets.length === 0) return 'No datasets matched the given pattern.';
  const rows = datasets.map((ds) => [
    ds.name,
    ds.dsorg ?? '—',
    ds.recfm ?? '—',
    ds.lrecl != null ? String(ds.lrecl) : '—',
    ds.migrated ? 'MIGRATED' : (ds.volume ?? '—'),
  ]);
  const header = `Datasets (${datasets.length} found)\n\n`;
  return header + renderTable(['Name', 'DSORG', 'RECFM', 'LRECL', 'Volume'], rows);
}

/** Format a PDS member list. */
export function formatMemberList(dsn: string, members: Member[]): string {
  if (members.length === 0) return `No members found in ${dsn}.`;
  const rows = members.map((member) => [member.name, member.modified ?? '—']);
  const header = `Members of ${dsn} (${members.length} found)\n\n`;
  return header + renderTable(['Member', 'Modified'], rows);
}

/** Format a USS directory listing. */
export function formatUssListing(path: string, entries: UssEntry[]): string {
  if (entries.length === 0) return `Directory ${path} is empty.`;
  const rows = entries.map((entry) => [
    entry.mode ?? '—',
    entry.user ?? '—',
    entry.group ?? '—',
    entry.size != null ? String(entry.size) : '—',
    entry.type,
    entry.name,
  ]);
  const header = `USS listing of ${path} (${entries.length} entries)\n\n`;
  return header + renderTable(['Mode', 'User', 'Group', 'Size', 'Type', 'Name'], rows);
}

/** Format a failed-job analysis bundle (matches README Example 1 shape). */
export function formatFailureAnalysis(analysis: JobFailureAnalysis): string {
  const { job } = analysis;
  const lines = [
    `Job:     ${job.jobName} (${job.jobId})`,
    `Status:  ${job.returnCode ?? job.status}`,
    `Step:    ${analysis.failedStep ?? '(unknown)'}${
      analysis.failedProgram ? ` - ${analysis.failedProgram}` : ''
    }`,
    `Reason:  ${analysis.reason}`,
  ];
  if (analysis.evidence.length > 0) {
    lines.push(`Spool:   ${analysis.evidence[0]}`);
    for (const extra of analysis.evidence.slice(1)) {
      lines.push(`         ${extra}`);
    }
  }
  lines.push(`Fix:     ${analysis.suggestedFix}`);
  return lines.join('\n');
}
