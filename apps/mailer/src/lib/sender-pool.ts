import 'dotenv/config';

export type SenderAddress = {
  email: string;
  name: string | null;
  domain: string;
};

type FromAddressRaw = string;

function parseFromAddresses(raw: FromAddressRaw): SenderAddress[] {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const results: SenderAddress[] = [];
  const emailRe = /([^<\s,]+@[^>\s,]+)/;
  const nameRe = /^\s*"?([^"<]+?)"?\s*</;

  for (const part of parts) {
    const emailMatch = part.match(emailRe);
    if (!emailMatch || !emailMatch[1]) continue;
    const email = emailMatch[1].toLowerCase();
    const atIdx = email.lastIndexOf('@');
    const domain = atIdx >= 0 ? email.slice(atIdx + 1) : '';
    let name: string | null = null;
    const nameMatch = part.match(nameRe);
    if (nameMatch?.[1]) {
      name = nameMatch[1].trim();
    }
    results.push({ email, name, domain });
  }

  if (results.length === 0) {
    const defaultDomain = process.env.DEFAULT_SENDING_DOMAIN ?? 'example.com';
    results.push({
      email: `no-reply@${defaultDomain}`,
      name: null,
      domain: defaultDomain,
    });
  }
  return results;
}

class SenderPool {
  private addresses: SenderAddress[];
  private idx = 0;

  constructor() {
    const raw = process.env.DEFAULT_FROM_ADDRESSES ?? '';
    this.addresses = parseFromAddresses(raw);
  }

  pickNext(): SenderAddress {
    const addr = this.addresses[this.idx % this.addresses.length];
    this.idx = (this.idx + 1) % this.addresses.length;
    if (!addr) {
      return this.addresses[0] as SenderAddress;
    }
    return addr;
  }

  all(): SenderAddress[] {
    return [...this.addresses];
  }

  listDomains(): string[] {
    return Array.from(new Set(this.addresses.map((a) => a.domain)));
  }

  reload(): void {
    const raw = process.env.DEFAULT_FROM_ADDRESSES ?? '';
    this.addresses = parseFromAddresses(raw);
    this.idx = 0;
  }
}

export const senderPool = new SenderPool();
