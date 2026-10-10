// Fuso da empresa (pág. 07): vencimentos e períodos são interpretados nele, nunca no do servidor.
const supported = new Set(Intl.supportedValuesOf('timeZone'));
supported.add('UTC');

export function isValidTimezone(value) {
  return typeof value === 'string' && supported.has(value);
}
