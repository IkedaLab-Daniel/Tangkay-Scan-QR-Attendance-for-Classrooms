import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {}],
  },
  transformIgnorePatterns: ['node_modules/(?!(@scalar)/)'],
  setupFiles: ['<rootDir>/src/test/setup.ts'],
};

export default config;
