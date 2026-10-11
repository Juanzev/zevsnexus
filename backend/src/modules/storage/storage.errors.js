// Erros dos providers. O service traduz para a resposta da API.

/** O objeto mudou entre a conferência e a operação (ETag diferente). */
export class StoragePreconditionError extends Error {
  constructor(message = 'o objeto mudou desde a conferência') {
    super(message);
    this.name = 'StoragePreconditionError';
  }
}

/** Falha de comunicação com o storage (rede, 5xx, tempo esgotado). */
export class StorageUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}
