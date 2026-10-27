import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const path = new URL('../.dev.vars', import.meta.url);
try {
  await writeFile(path, `ADMIN_TOKEN="${randomBytes(32).toString('hex')}"\n`, { mode: 0o600, flag: 'wx' });
  console.log('Created .dev.vars with a private setup password. Open it locally to copy ADMIN_TOKEN. Do not commit or share it.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.dev.vars already exists; left unchanged.');
}
