// Cada arquivo de teste tem o próprio registro de módulos (e o próprio pool): fecha ao terminar.
afterAll(async () => {
  const { closePool } = await import('../../src/shared/db.js');
  await closePool();
});
