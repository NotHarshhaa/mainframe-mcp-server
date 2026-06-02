/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // Allow ESM-style ".js" import specifiers to resolve to ".ts" source in tests
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        // 151002: harmless "hybrid module kind" notice under NodeNext + ESM.
        diagnostics: { ignoreCodes: [151002] },
        tsconfig: {
          // Tests don't need the strict unused checks the build enforces
          noUnusedLocals: false,
          noUnusedParameters: false,
        },
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/index.ts'],
  coverageDirectory: 'coverage',
};
