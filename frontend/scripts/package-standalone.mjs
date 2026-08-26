import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const nextDir = resolve(root, '.next');
const standaloneDir = resolve(nextDir, 'standalone');
const sourceStatic = resolve(nextDir, 'static');
const targetStatic = resolve(standaloneDir, '.next', 'static');
const sourcePublic = resolve(root, 'public');
const targetPublic = resolve(standaloneDir, 'public');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(resolve(standaloneDir, 'server.js')))) {
  throw new Error('Standalone server.js is missing. Run next build first.');
}
if (!(await exists(sourceStatic))) {
  throw new Error('.next/static is missing. Run next build first.');
}

await mkdir(resolve(standaloneDir, '.next'), { recursive: true });
await rm(targetStatic, { recursive: true, force: true });
await cp(sourceStatic, targetStatic, { recursive: true });

if (await exists(sourcePublic)) {
  await rm(targetPublic, { recursive: true, force: true });
  await cp(sourcePublic, targetPublic, { recursive: true });
}

console.log('PASS | standalone Next.js assets packaged');
