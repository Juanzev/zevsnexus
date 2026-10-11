// Contexto da requisição repassado do controller ao service: quem age, em qual empresa e de onde.
// É a base da auditoria (usuário, tenant, request id, IP, user-agent).

export function requestContext(req) {
  return Object.freeze({
    user: req.user ?? null,
    userId: req.user?.id ?? null,
    companyId: req.tenant?.companyId ?? null,
    membershipId: req.tenant?.membershipId ?? null,
    permissions: req.tenant?.permissions ?? new Set(),
    timezone: req.tenant?.timezone ?? null,
    actorType: req.platformAdmin ? 'platform_admin' : 'user',
    requestId: req.id ?? null,
    ip: req.clientIp ?? null,
    userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
  });
}
