// Respostas da API nunca vão para cache e não carregam conteúdo ativo (pág. 06 §7).
export function apiHeaders(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  next();
}
