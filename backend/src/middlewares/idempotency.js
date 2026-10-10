// Idempotency-Key (pág. 08) em operações que criam dinheiro ou documento:
// - mesma chave + mesmo corpo → devolve a resposta salva, com `Idempotent-Replayed: true`;
// - mesma chave + corpo diferente → 422; ainda processando → 409;
// - erro (4xx/5xx) não consome a chave; a chave vale 24 h; escopo = empresa + método + caminho real.
// Vai no pipeline depois de validate (pág. 08).
import { createHash } from 'node:crypto';
import { idempotencyRepository } from '../modules/idempotency/idempotency.repository.js';
import { ConflictError, ValidationError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

const VALID_KEY = /^[A-Za-z0-9_-]{8,128}$/;

/** JSON com chaves ordenadas: o mesmo corpo sempre gera o mesmo hash. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function keyError(code, message) {
  return new ValidationError([{ field: 'Idempotency-Key', code, message }], code, message);
}

export function idempotency() {
  return async function idempotencyGuard(req, res, next) {
    const key = req.get('idempotency-key');
    if (!key) throw keyError('IDEMPOTENCY_KEY_REQUIRED', 'Envie o cabeçalho Idempotency-Key.');
    if (!VALID_KEY.test(key)) throw keyError('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key inválido.');

    const repo = idempotencyRepository();
    const userId = req.user.id;
    const scope = `${req.tenant?.companyId ?? '-'}:${req.method} ${req.baseUrl}${req.path}`;
    const requestHash = createHash('sha256').update(canonical(req.body ?? {})).digest('hex');

    const recordId = await repo.acquire({ userId, companyId: req.tenant?.companyId ?? null, scope, key, requestHash });
    if (!recordId) {
      const saved = await repo.find({ userId, scope, key });
      if (saved.request_hash !== requestHash) {
        throw keyError('IDEMPOTENCY_KEY_REUSED', 'Esta Idempotency-Key já foi usada com outro conteúdo.');
      }
      if (saved.status === 'processing') {
        throw new ConflictError('IDEMPOTENCY_IN_PROGRESS', 'Esta operação ainda está sendo processada.');
      }
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(saved.response_status).json(saved.response_body);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      res.locals.idempotencyBody = body;
      return originalJson(body);
    };
    res.on('finish', () => {
      const done =
        res.statusCode < 400
          ? repo.complete(recordId, { status: res.statusCode, body: res.locals.idempotencyBody ?? null })
          : repo.release(recordId);
      done.catch((err) => logger.error({ err }, 'falha ao registrar Idempotency-Key'));
    });
    next();
  };
}
