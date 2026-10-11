import { loggableUrl } from '../../src/middlewares/http-logger.js';

describe('URL no log de acesso', () => {
  test('sem query string (URL assinada do R2 e filtros de busca)', () => {
    expect(loggableUrl('/api/v1/documents?q=contrato&X-Amz-Signature=abc')).toBe('/api/v1/documents');
  });

  test('token do /dev-storage nunca vai para o log', () => {
    expect(loggableUrl('/dev-storage/upload/eyJvcCI6InB1dCJ9.assinatura')).toBe('/dev-storage/upload/[redacted]');
    expect(loggableUrl('/dev-storage/download/eyJvcCI6ImdldCJ9.assinatura?x=1')).toBe('/dev-storage/download/[redacted]');
  });
});
