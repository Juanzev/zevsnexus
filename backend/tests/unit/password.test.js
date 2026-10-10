import { exceedsMaxBytes, hashPassword, verifyPassword } from '../../src/modules/auth/password.js';
import { newPassword } from '../../src/modules/auth/auth.validator.js';

describe('política de senha', () => {
  test('mínimo de 8 caracteres', () => {
    expect(newPassword.safeParse('1234567').success).toBe(false);
    expect(newPassword.safeParse('12345678').success).toBe(true);
  });

  test('máximo de 72 bytes, contando acentos como 2 bytes', () => {
    expect(exceedsMaxBytes('a'.repeat(72))).toBe(false);
    expect(exceedsMaxBytes('a'.repeat(73))).toBe(true);
    // 36 "ç" = 72 bytes em UTF-8; 37 passam do limite mesmo com só 37 caracteres.
    expect(exceedsMaxBytes('ç'.repeat(36))).toBe(false);
    expect(exceedsMaxBytes('ç'.repeat(37))).toBe(true);
    expect(newPassword.safeParse('ç'.repeat(37)).success).toBe(false);
  });
});

describe('verifyPassword', () => {
  test('confere a senha certa e recusa a errada', async () => {
    const hash = await hashPassword('senha-forte-123');
    await expect(verifyPassword('senha-forte-123', hash)).resolves.toBe(true);
    await expect(verifyPassword('senha-errada-123', hash)).resolves.toBe(false);
  });

  test('sem hash (usuário inexistente) devolve false', async () => {
    await expect(verifyPassword('qualquer-coisa', undefined)).resolves.toBe(false);
  });

  test('não trunca: senha acima de 72 bytes nunca confere', async () => {
    const base = 'a'.repeat(72);
    const hash = await hashPassword(base);
    await expect(verifyPassword(`${base}-sufixo`, hash)).resolves.toBe(false);
  });
});
