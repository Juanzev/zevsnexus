// Classes de erro da API (pág. 08). O errorHandler converte em
// { error: { code, message, details, requestId } } com o status de cada classe.

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(code = 'BAD_REQUEST', message = 'Requisição inválida.', details) {
    super(400, code, message, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(code = 'AUTH_REQUIRED', message = 'Faça login para continuar.') {
    super(401, code, message);
  }
}

export class AuthorizationError extends AppError {
  constructor(code = 'FORBIDDEN', message = 'Você não tem permissão para esta ação.') {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(code = 'NOT_FOUND', message = 'Não encontrado.') {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(code = 'CONFLICT', message = 'Conflito com o estado atual do recurso.', details) {
    super(409, code, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(details, code = 'VALIDATION_ERROR', message = 'Confira os campos destacados.') {
    super(422, code, message, details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.') {
    super(429, 'RATE_LIMITED', message);
  }
}
