// Provider de teste: objetos num Map. Os testes podem inspecionar (keys/has) e limpar (clear).
import { createDevProvider } from './dev.provider.js';

export function createMemoryProvider({ baseUrl }) {
  const objects = new Map();
  const provider = createDevProvider({
    name: 'memory',
    baseUrl,
    blobs: {
      async get(key) {
        return objects.get(key) ?? null;
      },
      async set(key, body) {
        objects.set(key, Buffer.from(body));
      },
      async remove(key) {
        objects.delete(key);
      },
    },
  });
  return Object.assign(provider, {
    keys: () => [...objects.keys()],
    has: (key) => objects.has(key),
    clear: () => objects.clear(),
  });
}
