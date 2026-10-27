import {
  investigateAbendPrompt,
  morningBatchHealthCheckPrompt,
  triageFailedJobPrompt,
} from '../../src/prompts/index.js';

describe('prompts', () => {
  describe('triageFailedJobPrompt', () => {
    it('targets a specific job when a jobId is given', () => {
      const text = triageFailedJobPrompt({ jobId: ' job01234 ' }, { incidentConfigured: true, docsConfigured: true });
      expect(text).toContain('JOB01234');
      expect(text).toContain('investigate_incident');
      expect(text).toContain('create_incident_ticket');
      expect(text).toContain('search_internal_docs');
    });

    it('walks the failure window when no jobId is given', () => {
      const text = triageFailedJobPrompt({ hours: '8' });
      expect(text).toContain('find_failed_jobs` with hours: 8');
      expect(text).toContain('summarize_abends');
      expect(text).not.toContain('create_incident_ticket');
    });

    it('mentions incident filing only when the integration is configured', () => {
      const withIncident = triageFailedJobPrompt({ jobId: 'JOB1' }, { incidentConfigured: true });
      const without = triageFailedJobPrompt({ jobId: 'JOB1' });
      expect(withIncident).toContain('create_incident_ticket');
      expect(without).not.toContain('create_incident_ticket');
    });
  });

  describe('morningBatchHealthCheckPrompt', () => {
    it('covers health, failures, prediction, capacity, and storage', () => {
      const text = morningBatchHealthCheckPrompt({ lookbackHours: '24' });
      expect(text).toContain('lookbackHours: 24');
      expect(text).toContain('system_health_summary');
      expect(text).toContain('predict_batch_failures');
      expect(text).toContain('get_volume_space');
      expect(text).toContain('get_job_capacity');
    });

    it('lists supporting tools when integrations are configured', () => {
      const text = morningBatchHealthCheckPrompt({}, { incidentConfigured: true, docsConfigured: true });
      expect(text).toContain('create_incident_ticket, search_internal_docs');
    });
  });

  describe('investigateAbendPrompt', () => {
    it('normalizes the code and references lookup + recent occurrences', () => {
      const text = investigateAbendPrompt({ code: 's0c7' }, { docsConfigured: true });
      expect(text).toContain('S0C7');
      expect(text).toContain('lookup_abend_code` with code: "S0C7"');
      expect(text).toContain('search_internal_docs');
      expect(text).toContain('summarize_abends');
    });
  });
});
