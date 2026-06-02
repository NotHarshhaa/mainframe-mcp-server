import { parseCmciXml } from '../../../src/utils/cmci-parser.js';

describe('cmci-parser', () => {
  it('parses CMCI XML rows into objects', () => {
    const xml = `
      <response>
        <results>
          <row>
            <col name="APPLID">CICSA</col>
            <col name="CICSSTATUS">ACTIVE</col>
          </row>
        </results>
      </response>`;
    const rows = parseCmciXml(xml);
    expect(rows).toHaveLength(1);
    expect(rows[0].applid).toBe('CICSA');
    expect(rows[0].cicsstatus).toBe('ACTIVE');
  });

  it('returns empty array for XML without rows', () => {
    expect(parseCmciXml('<response></response>')).toEqual([]);
  });
});
