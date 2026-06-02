/**
 * z/OS domain types.
 *
 * These are intentionally a small, AI-friendly subset of the rich objects the
 * Zowe SDK returns. We normalize the SDK shapes into stable types so the tool
 * layer (and downstream AI agents) don't depend on SDK-internal field names.
 */

/** Lifecycle status of a job as reported by JES. */
export type JobStatus = 'INPUT' | 'ACTIVE' | 'OUTPUT' | 'UNKNOWN';

/** A normalized z/OS batch job. */
export interface Job {
  /** Job name, e.g. PAYJOB01. */
  jobName: string;
  /** JES job id, e.g. JOB01234. */
  jobId: string;
  /** Owner (user id) that submitted the job. */
  owner: string;
  /** Current lifecycle status. */
  status: JobStatus;
  /**
   * Raw return code or completion status string from JES,
   * e.g. "CC 0000", "JCL ERROR", "ABEND S806". `null` while still running.
   */
  returnCode: string | null;
  /** Job class, e.g. "A". */
  class?: string;
  /** z/OS subsystem the job ran under, e.g. "JES2". */
  subsystem?: string;
  /** Optional execution phase description. */
  phase?: string;
}

/** A single spool (DD) file produced by a job. */
export interface SpoolFile {
  /** JES spool file id (used to download a specific DD). */
  id: number;
  /** DD name, e.g. "JESMSGLG", "SYSOUT". */
  ddName: string;
  /** Step name that produced this DD, if applicable. */
  stepName?: string;
  /** Procedure step name, if applicable. */
  procStep?: string;
  /** Approximate record count. */
  recordCount?: number;
}

/** A normalized dataset (catalog) entry. */
export interface Dataset {
  /** Fully-qualified dataset name. */
  name: string;
  /** Dataset organization, e.g. "PO" (PDS), "PS" (sequential). */
  dsorg?: string;
  /** Record format, e.g. "FB", "VB". */
  recfm?: string;
  /** Logical record length. */
  lrecl?: number;
  /** Volume serial the dataset resides on. */
  volume?: string;
  /** True when the dataset is migrated/archived (HSM). */
  migrated?: boolean;
}

/** A PDS member. */
export interface Member {
  /** Member name. */
  name: string;
  /** Last-modified date/time if available. */
  modified?: string;
  /** Member version if version tracking is enabled. */
  version?: number;
}

/** A USS (Unix System Services) directory entry. */
export interface UssEntry {
  /** Entry name (relative to the listed directory). */
  name: string;
  /** "file", "directory", or "symlink". */
  type: 'file' | 'directory' | 'symlink' | 'other';
  /** Size in bytes for regular files. */
  size?: number;
  /** Owning user. */
  user?: string;
  /** Owning group. */
  group?: string;
  /** Permission string, e.g. "-rwxr-xr-x". */
  mode?: string;
  /** Last modified timestamp. */
  modified?: string;
}

/** Result of analyzing a failed job. */
export interface JobFailureAnalysis {
  job: Job;
  /** Abend or error code, e.g. "S806", "S0C7", "U0100", or null if none found. */
  abendCode: string | null;
  /** Step where the failure occurred, if identifiable. */
  failedStep: string | null;
  /** Program/module name associated with the failure, if identifiable. */
  failedProgram: string | null;
  /** Human-readable explanation of the failure. */
  reason: string;
  /** The most relevant spool message line(s) used to reach the conclusion. */
  evidence: string[];
  /** Suggested remediation. */
  suggestedFix: string;
}

/** A single abend-code reference entry. */
export interface AbendCodeInfo {
  code: string;
  title: string;
  category: 'system' | 'user';
  explanation: string;
  commonCauses: string[];
  suggestedFix: string;
}

/** A normalized CICS region summary from CMCI. */
export interface CicsRegion {
  applid: string;
  status: string;
  cicsplex?: string;
  sysid?: string;
  jobname?: string;
  jobid?: string;
}

/** A CICS transaction definition from CMCI. */
export interface CicsTransaction {
  tranid: string;
  program: string;
  status?: string;
  taskcount?: string;
}

/** A Db2 catalog object. */
export interface Db2CatalogEntry {
  name: string;
  schema: string;
  type: string;
}

/** A batch failure risk assessment. */
export interface FailureRisk {
  jobName: string;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  failureCount: number;
  topAbend: string | null;
  trend: 'STABLE' | 'INCREASING' | 'DECREASING';
  recommendation: string;
}

/** Extended root-cause analysis for AI-assisted diagnostics. */
export interface RootCauseReport {
  analysis: JobFailureAnalysis;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  similarIncidents: string[];
  correlatedAbends: { code: string; count: number }[];
  actionItems: string[];
  summary: string;
}
