import { cp, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(web, 'node_modules/pdfjs-dist');
const { version } = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
// The private ingress already serves _next/static. Versioned assets also avoid
// mixing a cached worker with a renderer from a later release.
const target = join(web, 'out/_next/static/pdfjs', version);
await mkdir(target, { recursive: true });
await cp(join(source, 'legacy/build/pdf.worker.min.mjs'), join(target, 'pdf.worker.min.mjs'));
await cp(join(source, 'LICENSE'), join(target, 'LICENSE'));
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(join(source, directory), join(target, directory), { recursive: true });
}
