import 'dotenv/config';
import * as crypto from 'node:crypto';

const INJECT_UNSUBSCRIBE = process.env.INJECT_UNSUBSCRIBE !== 'false';
const UNSUBSCRIBE_BASE_URL = process.env.UNSUBSCRIBE_BASE_URL ?? 'https://example.com';

function makeUnsubscribeToken(email: string): string {
  const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET ?? 'dev-only-insecure-secret';
  const payload = `${email}:${Math.floor(Date.now() / 1000)}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16);
  return `${Buffer.from(payload).toString('base64url')}.${hmac}`;
}

export function buildUnsubscribeLink(email: string): string {
  const token = makeUnsubscribeToken(email);
  const base = UNSUBSCRIBE_BASE_URL.replace(/\/+$/, '');
  return `${base}/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
}

export function injectUnsubscribeFooter(
  htmlBody: string | null | undefined,
  textBody: string | null | undefined,
  email: string
): { html?: string; text?: string } {
  if (!INJECT_UNSUBSCRIBE) {
    return { html: htmlBody ?? undefined, text: textBody ?? undefined };
  }
  const link = buildUnsubscribeLink(email);
  const out: { html?: string; text?: string } = {};

  if (textBody != null) {
    out.text = `${textBody}\n\n---\nUnsubscribe: ${link}`;
  }

  if (htmlBody != null) {
    const footer = `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#888;">
      If you no longer wish to receive emails from us, you can <a href="${link}" style="color:#888;">unsubscribe</a>.
    </div>`;
    if (/<\/body>/i.test(htmlBody)) {
      out.html = htmlBody.replace(/<\/body>/i, `${footer}</body>`);
    } else {
      out.html = `${htmlBody}${footer}`;
    }
  }

  return out;
}
