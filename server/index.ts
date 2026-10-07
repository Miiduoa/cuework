import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RevisionStore } from './store.ts';
import { createApp } from './http.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = process.env.CUEWORK_DATA_DIR
  ? resolve(process.env.CUEWORK_DATA_DIR)
  : resolve(root, '.data');
const port = Number(process.env.PORT || '4173');
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be between 1 and 65535.');
mkdirSync(data, { recursive: true });
const store = new RevisionStore(resolve(data, 'cuework.sqlite'));
const server = createApp(store, resolve(root, 'dist'));
server.listen(port, '127.0.0.1', () =>
  console.log(`Cuework is ready at http://127.0.0.1:${port}\nSQLite revisions: ${data}`),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
