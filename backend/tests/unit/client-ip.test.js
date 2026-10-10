import { createClientIpResolver } from '../../src/shared/security/client-ip.js';

function fakeRequest(headers, ip = '10.0.0.1') {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ip, socket: {}, get: (name) => lower[name.toLowerCase()] };
}

function resolve(resolver, req) {
  resolver(req, {}, () => {});
  return req.clientIp;
}

describe('IP real do cliente', () => {
  const secret = 'segredo-de-origem-cloudflare-123';

  test('aceita CF-Connecting-IP só com o segredo de origem correto', () => {
    const resolver = createClientIpResolver(secret);
    const req = fakeRequest({ 'X-Origin-Auth': secret, 'CF-Connecting-IP': '200.10.20.30' });
    expect(resolve(resolver, req)).toBe('200.10.20.30');
  });

  test('segredo errado ou ausente: ignora o header e usa req.ip', () => {
    const resolver = createClientIpResolver(secret);
    expect(resolve(resolver, fakeRequest({ 'X-Origin-Auth': 'errado', 'CF-Connecting-IP': '1.2.3.4' }))).toBe('10.0.0.1');
    expect(resolve(resolver, fakeRequest({ 'CF-Connecting-IP': '1.2.3.4' }))).toBe('10.0.0.1');
  });

  test('CF-Connecting-IP que não é IP é ignorado', () => {
    const resolver = createClientIpResolver(secret);
    const req = fakeRequest({ 'X-Origin-Auth': secret, 'CF-Connecting-IP': 'não-é-ip' });
    expect(resolve(resolver, req)).toBe('10.0.0.1');
  });

  test('sem segredo configurado, nunca confia no header', () => {
    const resolver = createClientIpResolver(undefined);
    const req = fakeRequest({ 'X-Origin-Auth': 'qualquer', 'CF-Connecting-IP': '1.2.3.4' });
    expect(resolve(resolver, req)).toBe('10.0.0.1');
  });
});
