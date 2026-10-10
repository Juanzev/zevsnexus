// Erro da API no formato { error: { code, message, details, requestId } } (pág. 08).

const GENERIC_MESSAGES = {
  0: 'Sem conexão com o servidor. Verifique a internet e tente de novo.',
  429: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  500: 'Algo deu errado do nosso lado. Tente novamente em instantes.',
};

export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? [];
    this.requestId = requestId;
  }

  static from(status, payload) {
    const error = payload?.error ?? {};
    return new ApiError({
      status,
      code: error.code ?? 'UNKNOWN_ERROR',
      message: error.message ?? GENERIC_MESSAGES[status] ?? GENERIC_MESSAGES[500],
      details: error.details,
      requestId: error.requestId,
    });
  }

  static network() {
    return new ApiError({ status: 0, code: 'NETWORK_ERROR', message: GENERIC_MESSAGES[0] });
  }
}

export async function readJson(response) {
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}
