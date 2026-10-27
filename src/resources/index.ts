/**
 * MCP resources (feature: mcp-native).
 *
 * Exposes mainframe data as addressable read-only resources alongside the
 * tools, so clients can browse and reference them directly:
 *
 *   mainframe://jobs/{jobId}/spool              — spool inventory for a job
 *   mainframe://jobs/{jobId}/spool/{ddName}     — one DD's spool content
 *   mainframe://datasets/{dsn}                  — PDS member listing
 *   mainframe://datasets/{dsn}/members/{member} — member content
 *   mainframe://reference/abend-codes           — built-in abend reference
 *
 * Every read is gated like the equivalent tool (read_dataset /
 * get_job_output / lookup_abend_code), so resource boundaries, RBAC,
 * data-protection masking, and audit apply unchanged.
 */
import type { ToolRegistrar } from '../types/tools.js';
import { defineResource, resourceBody } from '../utils/define-resource.js';
import { truncateLines, formatSpoolFiles, formatMemberList } from '../utils/formatters.js';
import {
  assertValidMemberName,
  normalizeDatasetName,
  listMembers,
  readDataset,
} from '../tools/datasets/shared.js';
import { fetchJob, fetchSpoolContent, fetchSpoolFiles } from '../tools/jobs/shared.js';
import { searchAbendCodes } from '../utils/abend-codes.js';
import { NotFoundError } from '../utils/errors.js';

export const registerMainframeResources: ToolRegistrar = (server, ctx) => {
  // --- Job spool -----------------------------------------------------------

  defineResource(server, ctx, {
    name: 'job-spool',
    uri: 'mainframe://jobs/{jobId}/spool',
    title: 'Job Spool Inventory',
    description: 'Spool file (DD) inventory for a JES job, e.g. mainframe://jobs/JOB01234/spool.',
    gateToolName: 'get_job_output',
    read: async (_uri, { jobId }) => {
      const job = await fetchJob(ctx, jobId);
      const files = await fetchSpoolFiles(ctx, job.jobName, job.jobId);
      return resourceBody(`Spool inventory — ${job.jobName} (${job.jobId})`, [
        {
          heading: 'Spool files',
          body:
            formatSpoolFiles(job.jobName, job.jobId, files) +
            `\n\nRead one DD's content via mainframe://jobs/${job.jobId}/spool/{ddName}.`,
        },
      ]);
    },
  });

  defineResource(server, ctx, {
    name: 'job-spool-dd',
    uri: 'mainframe://jobs/{jobId}/spool/{ddName}',
    title: 'Job Spool DD Content',
    description: "Content of one spool DD, e.g. mainframe://jobs/JOB01234/spool/JESYSMSG.",
    gateToolName: 'get_job_output',
    read: async (_uri, { jobId, ddName }) => {
      const job = await fetchJob(ctx, jobId);
      const upperDd = ddName.toUpperCase();
      const files = await fetchSpoolFiles(ctx, job.jobName, job.jobId);
      const file = files.find((f) => f.ddName.toUpperCase() === upperDd);
      if (!file) {
        throw new NotFoundError(
          `Job ${job.jobId} has no spool DD "${upperDd}". Available: ${files.map((f) => f.ddName).join(', ')}.`,
          { jobId, ddName },
        );
      }
      const raw = await fetchSpoolContent(ctx, job.jobName, job.jobId, file.id);
      const { text, truncated, totalLines } = truncateLines(raw, ctx.config.limits.maxJobOutputLines);
      return resourceBody(`Spool ${job.jobName} (${job.jobId}) — DD ${upperDd}`, [
        {
          heading: 'Content',
          body:
            (truncated
              ? `${text}\n... [showing first ${ctx.config.limits.maxJobOutputLines} of ${totalLines} lines]`
              : text),
        },
      ]);
    },
  });

  // --- Datasets ------------------------------------------------------------

  defineResource(server, ctx, {
    name: 'dataset-members',
    uri: 'mainframe://datasets/{dsn}',
    title: 'Dataset Member Listing',
    description: 'Member listing of a PDS/PDSE, e.g. mainframe://datasets/SYS1.PROCLIB.',
    gateToolName: 'get_dataset_info',
    resourceRefs: (v) => (v.dsn ? { dataset: v.dsn } : undefined),
    read: async (_uri, { dsn }) => {
      const normalized = normalizeDatasetName(dsn);
      const members = await listMembers(ctx, normalized);
      return resourceBody(`Members of ${normalized}`, [
        { heading: 'Members', body: formatMemberList(normalized, members) },
        {
          heading: 'Read a member',
          body: `Use mainframe://datasets/${normalized}/members/{member} for member content.`,
        },
      ]);
    },
  });

  defineResource(server, ctx, {
    name: 'dataset-member',
    uri: 'mainframe://datasets/{dsn}/members/{member}',
    title: 'Dataset Member Content',
    description: 'Content of one PDS member, e.g. mainframe://datasets/SYS1.PROCLIB/members/IKJACCNT.',
    gateToolName: 'read_dataset',
    resourceRefs: (v) => (v.dsn ? { dataset: v.dsn } : undefined),
    read: async (_uri, { dsn, member }) => {
      const normalizedDsn = normalizeDatasetName(dsn);
      assertValidMemberName(member);
      const raw = await readDataset(ctx, normalizedDsn, member.toUpperCase());
      const { text, truncated, totalLines } = truncateLines(raw, ctx.config.limits.maxDatasetReadLines);
      return resourceBody(`${normalizedDsn}(${member.toUpperCase()})`, [
        {
          heading: 'Content',
          body:
            (truncated
              ? `${text}\n... [showing first ${ctx.config.limits.maxDatasetReadLines} of ${totalLines} lines]`
              : text),
        },
      ]);
    },
  });

  // --- Reference -----------------------------------------------------------

  defineResource(server, ctx, {
    name: 'abend-codes',
    uri: 'mainframe://reference/abend-codes',
    title: 'Abend Code Reference',
    description: 'The built-in z/OS abend code reference catalog (system and user codes with remediation).',
    gateToolName: 'lookup_abend_code',
    read: async () => {
      const entries = searchAbendCodes();
      const table = entries
        .map((e) => `${e.code} — ${e.title}: ${e.explanation}`)
        .join('\n\n');
      return resourceBody('Abend code reference', [
        {
          heading: `Catalog (${entries.length} codes)`,
          body: `${table}\n\nUse lookup_abend_code for full entries, causes, and remediation steps.`,
        },
      ]);
    },
  });

  ctx.logger.debug('Registered MCP resources');
};
