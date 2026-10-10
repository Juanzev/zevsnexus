// Provider Resend (pág. 14): API HTTP direta, sem SDK do fornecedor no core.
const RESEND_URL = 'https://api.resend.com/emails';

export function createResendProvider({ apiKey }) {
  return {
    name: 'resend',
    async send({ from, to, subject, html, text }) {
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Resend respondeu ${response.status}`);
      }
    },
  };
}
