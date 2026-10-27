import { deriveAnnotations } from '../../../src/utils/define-tool.js';

describe('utils/define-tool annotations', () => {
  it('marks read tools read-only, idempotent, and non-destructive', () => {
    for (const name of ['read_dataset', 'list_jobs', 'investigate_incident', 'search_internal_docs']) {
      const annotations = deriveAnnotations(name);
      expect(annotations.readOnlyHint).toBe(true);
      expect(annotations.destructiveHint).toBe(false);
      expect(annotations.idempotentHint).toBe(true);
      expect(annotations.title).toBe(
        name.split('_').map((p) => p[0].toUpperCase() + p.slice(1)).join(' '),
      );
    }
  });

  it('marks write tools as mutating', () => {
    for (const name of ['submit_jcl', 'approve_write', 'cancel_job', 'issue_console_command', 'create_incident_ticket']) {
      expect(deriveAnnotations(name).readOnlyHint).toBe(false);
    }
  });

  it('marks only genuinely destructive tools with destructiveHint', () => {
    expect(deriveAnnotations('submit_jcl').destructiveHint).toBe(true);
    expect(deriveAnnotations('cancel_job').destructiveHint).toBe(true);
    expect(deriveAnnotations('issue_console_command').destructiveHint).toBe(true);
    // Mutating but not destructive.
    expect(deriveAnnotations('hold_job').destructiveHint).toBe(false);
    expect(deriveAnnotations('cics_newcopy').destructiveHint).toBe(false);
    // External side effect, not destructive.
    expect(deriveAnnotations('create_incident_ticket').destructiveHint).toBe(false);
    expect(deriveAnnotations('create_incident_ticket').idempotentHint).toBe(false);
  });
});
