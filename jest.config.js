module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'api/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
};