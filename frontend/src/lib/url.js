// Redirecionamentos seguros: ?next= só aceita caminho interno — nunca //host nem /\host (open redirect).

export function safeNext(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  // Caracteres de controle (quebra de linha, tab…) nunca fazem parte de um caminho legítimo.
  if ([...value].some((char) => char.charCodeAt(0) < 0x20)) return null;
  return value;
}

/** Remove parâmetros sensíveis (ex.: token de e-mail) da barra de endereço, sem recarregar. */
export function stripQueryParams(...names) {
  const url = new URL(window.location.href);
  let changed = false;
  for (const name of names) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }
  if (changed) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
