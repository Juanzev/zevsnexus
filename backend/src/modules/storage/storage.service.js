// Storage da aplicação (ARCHITECTURE §10): um provider por processo, escolhido por STORAGE_PROVIDER.
// Produção só sobe com r2 (validado em config/env.js).
import path from 'node:path';
import { backendDir, env } from '../../config/env.js';
import { createLocalProvider } from './providers/local.provider.js';
import { createMemoryProvider } from './providers/memory.provider.js';
import { createR2Provider } from './providers/r2.provider.js';

function createProvider() {
  switch (env.storageProvider) {
    case 'r2':
      return createR2Provider({
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
      });
    case 'local':
      return createLocalProvider({ rootDir: path.resolve(backendDir, env.STORAGE_LOCAL_DIR), baseUrl: env.appOrigin });
    case 'memory':
      return createMemoryProvider({ baseUrl: env.appOrigin });
    default:
      throw new Error(`STORAGE_PROVIDER desconhecido: ${env.storageProvider}`);
  }
}

let provider;

export function storage() {
  provider ??= createProvider();
  return provider;
}

/** As rotas /dev-storage/* só existem com provider local ou memory. */
export function usesDevStorage() {
  return env.storageProvider !== 'r2';
}
