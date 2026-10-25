import { registerPending, takePending, pendingCount, clearPending } from '../../../src/tools/jobs/pending-approvals.js';

describe('pending-approvals store', () => {
  beforeEach(() => clearPending());

  it('registers and consumes a pending submission one-time', () => {
    const entry = registerPending('//PAYJOB01 JOB ...', 'CHG000123', []);
    expect(entry.token).toMatch(/^[0-9a-f]{24}$/);
    expect(entry.changeTicket).toBe('CHG000123');
    expect(pendingCount()).toBe(1);

    const taken = takePending(entry.token);
    expect(taken?.jcl).toBe('//PAYJOB01 JOB ...');
    expect(pendingCount()).toBe(0);

    // One-time use: the token is gone after the first take.
    expect(takePending(entry.token)).toBeUndefined();
  });

  it('expires pending submissions after the TTL', () => {
    const realNow = Date.now;
    const entry = registerPending('//J', undefined, []);
    expect(pendingCount()).toBe(1);

    // Jump 11 minutes forward.
    jest.spyOn(global.Date, 'now').mockReturnValue(realNow() + 11 * 60 * 1000);
    try {
      expect(pendingCount()).toBe(0);
      expect(takePending(entry.token)).toBeUndefined();
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('sweeps only expired entries', () => {
    const realNow = Date.now;
    registerPending('//OLD', undefined, []);
    jest.spyOn(global.Date, 'now').mockReturnValue(realNow() + 11 * 60 * 1000);
    const fresh = registerPending('//NEW', undefined, []);
    jest.restoreAllMocks();

    expect(pendingCount()).toBe(1);
    expect(takePending(fresh.token)?.jcl).toBe('//NEW');
  });
});
