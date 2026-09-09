import 'dotenv/config';
import * as crypto from 'node:crypto';
import { Resend } from 'resend';
import { injectUnsubscribeFooter } from './unsubscribe.ts';

export type ResendSendParams = {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
};

export type ResendSendResult = {
  success: boolean;
  messageId: string | null;
  errorMessage: string | null;
  usedMock: boolean;
};

class ResendClient {
  private client: Resend | null = null;
  private mockCounter = 0;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey && !apiKey.startsWith('re_xx') && apiKey.length > 10) {
      try {
        this.client = new Resend(apiKey);
        console.log('[mailer] Resend SDK initialized');
      } catch (err) {
        console.warn('[mailer] Resend init failed, falling back to mock:', err);
        this.client = null;
      }
    } else {
      console.warn(
        '[mailer] RESEND_API_KEY not configured or placeholder, using MOCK mode (all sends logged, not delivered)'
      );
      this.client = null;
    }
  }

  get isMock(): boolean {
    return this.client == null;
  }

  async send(params: ResendSendParams): Promise<ResendSendResult> {
    const toEmail = params.to[0] ?? '';
    const withUnsub = injectUnsubscribeFooter(params.html, params.text, toEmail);

    const payload: Record<string, unknown> = {
      from: params.from,
      to: params.to,
      subject: params.subject,
      reply_to: params.replyTo ?? process.env.DEFAULT_REPLY_TO ?? undefined,
      headers: params.headers ?? undefined,
      tags: params.tags ?? undefined,
    };
    if (withUnsub.html) payload.html = withUnsub.html;
    if (withUnsub.text) payload.text = withUnsub.text;

    if (this.client) {
      try {
        const res = await this.client.emails.send(payload as never);
        return {
          success: true,
          messageId: (res as { id?: string } | null)?.id ?? null,
          errorMessage: null,
          usedMock: false,
        };
      } catch (err) {
        return {
          success: false,
          messageId: null,
          errorMessage: err instanceof Error ? err.message : String(err),
          usedMock: false,
        };
      }
    }

    this.mockCounter += 1;
    const mockId = `mock_${Date.now()}_${this.mockCounter}`;
    console.log(
      `[mailer][MOCK] SEND → to=${params.to.join(',')} from=${params.from} subject="${params.subject}" mock_message_id=${mockId}`
    );
    return {
      success: true,
      messageId: mockId,
      errorMessage: null,
      usedMock: true,
    };
  }
}

export const resendClient = new ResendClient();

export function verifyResendWebhookSignature(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  rawBody: string
): boolean {
  const svixId = headers['svix-id'] as string | undefined;
  const svixTimestamp = headers['svix-timestamp'] as string | undefined;
  const svixSignature = headers['svix-signature'] as string | undefined;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedContent).digest('base64');

  const variants = String(svixSignature).split(' ');
  for (const v of variants) {
    const [, sig] = v.split(',');
    if (!sig) continue;
    if (timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
