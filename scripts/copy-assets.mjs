// Copies the zero-build admin UI assets into dist/ so `node dist/index.js` can
// serve them. Run automatically by `npm run build`.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'admin', 'ui');
const dest = join(root, 'dist', 'admin', 'ui');

await mkdir(dirname(dest), { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`Copied admin UI -> ${dest}`);
