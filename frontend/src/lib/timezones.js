// Fusos do Brasil com rótulo amigável. O backend aceita qualquer fuso IANA válido.
export const BRAZIL_TIMEZONES = Object.freeze([
  { value: 'America/Noronha', label: 'Fernando de Noronha (UTC−2)' },
  { value: 'America/Sao_Paulo', label: 'Brasília — SP, RJ, MG, Sul, GO, DF… (UTC−3)' },
  { value: 'America/Bahia', label: 'Bahia (UTC−3)' },
  { value: 'America/Fortaleza', label: 'Ceará, RN, PB, PI, MA (UTC−3)' },
  { value: 'America/Recife', label: 'Pernambuco (UTC−3)' },
  { value: 'America/Maceio', label: 'Alagoas e Sergipe (UTC−3)' },
  { value: 'America/Belem', label: 'Pará — Belém (UTC−3)' },
  { value: 'America/Santarem', label: 'Pará — Santarém (UTC−3)' },
  { value: 'America/Araguaina', label: 'Tocantins (UTC−3)' },
  { value: 'America/Manaus', label: 'Amazonas — Manaus (UTC−4)' },
  { value: 'America/Boa_Vista', label: 'Roraima (UTC−4)' },
  { value: 'America/Porto_Velho', label: 'Rondônia (UTC−4)' },
  { value: 'America/Cuiaba', label: 'Mato Grosso (UTC−4)' },
  { value: 'America/Campo_Grande', label: 'Mato Grosso do Sul (UTC−4)' },
  { value: 'America/Rio_Branco', label: 'Acre (UTC−5)' },
  { value: 'America/Eirunepe', label: 'Amazonas — oeste (UTC−5)' },
]);

/** Fuso do navegador, se for um dos do Brasil; senão, Brasília. */
export function guessTimezone() {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return BRAZIL_TIMEZONES.some((zone) => zone.value === local) ? local : 'America/Sao_Paulo';
}

export const UFS = Object.freeze([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);
