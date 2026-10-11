// Provider de desenvolvimento: objetos em disco, em STORAGE_LOCAL_DIR (fora do git).
// A chave já vem validada (companies/<uuid>/files|uploads/<uuid>): não há como sair da raiz.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDevProvider } from './dev.provider.js';

export function createLocalProvider({ rootDir, baseUrl }) {
  const root = path.resolve(rootDir);
  const pathOf = (key) => path.join(root, ...key.split('/'));

  return createDevProvider({
    name: 'local',
    baseUrl,
    blobs: {
      async get(key) {
        try {
          return await readFile(pathOf(key));
        } catch (err) {
          if (err.code === 'ENOENT') return null;
          throw err;
        }
      },
      async set(key, body) {
        const target = pathOf(key);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, body);
      },
      async remove(key) {
        await rm(pathOf(key), { force: true });
      },
    },
  });
}
