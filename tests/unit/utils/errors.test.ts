import { ConnectionError, normalizeError } from '../../../src/utils/errors.js';

describe('errors/normalizeError', () => {
  it('maps authentication failures to ConnectionError', () => {
    const err = normalizeError(new Error('HTTP 401 Unauthorized'));
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.code).toBe('CONNECTION_ERROR');
  });

  it('maps network failures to ConnectionError', () => {
    const err = normalizeError(new Error('connect ECONNREFUSED 10.0.0.1:443'));
    expect(err).toBeInstanceOf(ConnectionError);
  });

  it('preserves MainframeMcpError subclasses', () => {
    const err = normalizeError(new ConnectionError('already mapped'));
    expect(err.message).toContain('already mapped');
  });
});
