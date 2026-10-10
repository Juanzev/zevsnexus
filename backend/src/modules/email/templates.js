// Layout dos e-mails transacionais. Todo dado vindo do usuário passa por escapeHtml.
import { env } from '../../config/env.js';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Link absoluto a partir de APP_URL — nunca do header Host (evita envenenar links de reset). */
export function appLink(pathname, params = {}) {
  const url = new URL(pathname, env.APP_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * Monta { subject, html, text }. `paragraphs` são textos simples (escapados aqui);
 * `action` é um botão opcional { label, url }.
 */
export function renderEmail({ subject, greeting, paragraphs, action, footer }) {
  const htmlParagraphs = paragraphs
    .map((text) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(text)}</p>`)
    .join('');
  const htmlAction = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#1d4ed8;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">${escapeHtml(action.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#475569">Se o botão não funcionar, copie e cole este endereço no navegador:<br>${escapeHtml(action.url)}</p>`
    : '';
  const htmlFooter = footer ? `<p style="margin:24px 0 0;font-size:13px;color:#64748b">${escapeHtml(footer)}</p>` : '';

  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;font-weight:700;font-size:18px">ZEVS Nexus</p>
<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
${htmlParagraphs}${htmlAction}${htmlFooter}
</div></body></html>`;

  const text = [greeting, ...paragraphs, action ? `${action.label}: ${action.url}` : null, footer]
    .filter(Boolean)
    .join('\n\n');

  return { subject, html, text };
}
