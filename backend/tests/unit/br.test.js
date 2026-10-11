import {
  isValidCnpj,
  isValidCpf,
  isValidPhone,
  normalizeCep,
  normalizeCnpj,
  normalizeCpf,
  normalizePhone,
} from '../../src/shared/br.js';

describe('CNPJ', () => {
  test('aceita CNPJ numérico válido, com ou sem máscara', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181');
  });

  test('aceita o CNPJ alfanumérico (exemplo oficial da Receita Federal)', () => {
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12abc34501de35')).toBe(true);
    expect(normalizeCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });

  test('recusa dígito verificador errado, tamanho errado e sequência repetida', () => {
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('12.ABC.345/01DE-36')).toBe(false);
    expect(isValidCnpj('1122233300018')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCnpj('11.222.333/0001-AB')).toBe(false);
  });
});

describe('CPF', () => {
  test('aceita CPF válido, com ou sem máscara, e guarda só os dígitos', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('11144477735')).toBe(true);
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
  });

  test('recusa dígito errado, tamanho errado, letras e sequência repetida', () => {
    for (const value of ['529.982.247-24', '5299822472', '5299822472A', '111.111.111-11', '000.000.000-00', '']) {
      expect(isValidCpf(value)).toBe(false);
    }
  });
});

describe('telefone e CEP', () => {
  test('normaliza para dígitos e aceita fixo e celular com DDD', () => {
    expect(normalizePhone('(92) 98765-4321')).toBe('92987654321');
    expect(normalizePhone('+55 92 3234-5678')).toBe('9232345678');
    expect(isValidPhone('92987654321')).toBe(true);
    expect(isValidPhone('9232345678')).toBe(true);
  });

  test('recusa sem DDD ou com DDD inválido', () => {
    expect(isValidPhone('987654321')).toBe(false);
    expect(isValidPhone('02987654321')).toBe(false);
  });

  test('CEP só com dígitos', () => {
    expect(normalizeCep('69.050-010')).toBe('69050010');
  });
});
