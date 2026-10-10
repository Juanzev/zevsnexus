// Busca textual segura (pág. 06 §3): o texto do usuário é sempre literal — curingas escapados.
export function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
