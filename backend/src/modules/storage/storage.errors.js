// Erros dos providers. O service traduz para a resposta da API.

/** O objeto mudou entre a conferência e a operação (ETag diferente). */
export class StoragePreconditionError extends Error {
  constructor(message = 'o objeto mudou desde a conferência') {
    super(message);
    this.name = 'StoragePreconditionError';
  }
}

/** O objeto passa do tamanho que a operação aceita ler inteiro. */
export class StorageObjectTooLargeError extends Error {
  constructor(message = 'objeto grande demais para ler inteiro') {
    super(message);
    this.name = 'StorageObjectTooLargeError';
  }
}

/** Falha de comunicação com o storage (rede, 5xx, tempo esgotado). */
export class StorageUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}
