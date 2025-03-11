
export default {
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],  // Handle TypeScript files
    '^.+\\.js$': ['babel-jest', { presets: ['@babel/preset-env'] }] // Handle JavaScript files
  },
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'ts', 'json', 'node'],
  transformIgnorePatterns: [
    "/node_modules/(?!your-esm-package-to-transform)/", // If needed, add exceptions for packages using ESM
  ],
};
