import { describe, test, expect, mock } from 'bun:test';

let fakeSendResponse: unknown;
let capturedPayload: Record<string, unknown> | null = null;

class FakeResend {
  emails = {
    send: async (payload: Record<string, unknown>) => {
      capturedPayload = payload;
      return fakeSendResponse;
    },
  };
}

mock.module('resend', () => ({ Resend: FakeResend }));

process.env.RESEND_API_KEY = 're_test_key_abcdefghijklmnopqrstuvwxyz';

const { resendClient } = await import('./resend-client.ts');

const baseParams = {
  from: 'Sales Team <sales@rakuto.store>',
  to: ['seed@example.com'],
  subject: 'warmup test',
  text: 'hello',
};

describe('resend-client send result mapping', () => {
  test('SDK 返回 { data, error } 错误形态时应判定为失败并透出 errorMessage', async () => {
    fakeSendResponse = {
      data: null,
      error: { statusCode: 403, message: 'The rakuto.store domain is not verified.' },
    };
    const res = await resendClient.send(baseParams);
    expect(res.success).toBe(false);
    expect(res.messageId).toBeNull();
    expect(res.errorMessage).toContain('not verified');
    expect(res.usedMock).toBe(false);
  });

  test('SDK 返回 { data: { id }, error: null } 时应判定成功并取 data.id', async () => {
    fakeSendResponse = { data: { id: '4ef9a417-02e9-4d39-a752-6dedc6a6d63e' }, error: null };
    const res = await resendClient.send(baseParams);
    expect(res.success).toBe(true);
    expect(res.messageId).toBe('4ef9a417-02e9-4d39-a752-6dedc6a6d63e');
    expect(res.errorMessage).toBeNull();
  });

  test('tags 中的非法字符（如 domain 里的点）应被清洗为 ASCII 安全字符', async () => {
    fakeSendResponse = { data: { id: 'tag-test-id' }, error: null };
    await resendClient.send({
      ...baseParams,
      tags: [
        { name: 'domain', value: 'rakuto.store' },
        { name: 'tenant_id', value: '00000000-0000-0000-0000-000000000000' },
      ],
    });
    const tags = (capturedPayload?.tags ?? []) as { name: string; value: string }[];
    expect(tags).toHaveLength(2);
    for (const t of tags) {
      expect(t.name).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(t.value).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(tags[0]?.value).toBe('rakuto-store');
  });
});
