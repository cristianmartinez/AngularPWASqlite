import { readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const buildTime = new Date().toISOString();

const content = `// Auto-generated — do not edit
export const BUILD_INFO = {
  version: '${pkg.version}',
  buildTime: '${buildTime}',
} as const;
`;

writeFileSync('src/app/build-info.ts', content);
console.log(`[build-info] v${pkg.version} @ ${buildTime}`);
