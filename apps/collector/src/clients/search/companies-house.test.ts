import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { CompaniesHouseClient } from './companies-house.ts';

const mockHttpRequest = vi.fn();

describe('CompaniesHouseClient', () => {
  beforeEach(() => mockHttpRequest.mockClear());

  const makeClient = (apiKey = 'test-api-key') =>
    new CompaniesHouseClient({
      apiKey,
      http: { request: mockHttpRequest } as never,
    });

  it('throws if apiKey is empty', async () => {
    const client = new CompaniesHouseClient({ apiKey: '', http: mockHttpRequest as never });
    await expect(client.search({ keyword: 'test' })).rejects.toThrow(
      'Companies House API key required'
    );
  });

  it('parses Companies House response into SearchHit array', async () => {
    const mockResponse = {
      total_results: 2,
      items: [
        {
          title: 'ABC ELECTRONICS LIMITED',
          description: 'Active',
          company_number: '12345678',
          company_type: 'ltd',
          address: { locality: 'London', postal_code: 'EC1A 1BB', country: 'England' },
          date_of_creation: '2020-05-10',
          company_status: 'active',
        },
        {
          title: 'XYZ CIRCUITS PLC',
          description: 'Dissolved',
          company_number: '87654321',
          company_type: 'plc',
          address: { locality: 'Manchester', postal_code: 'M1 1AA' },
          date_of_creation: '2018-01-20',
          company_status: 'dissolved',
        },
      ],
    };

    mockHttpRequest.mockResolvedValue({ data: mockResponse });

    const hits = await makeClient().search({ keyword: 'printed circuit', count: 10 });

    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      title: 'ABC ELECTRONICS LIMITED',
      provider: 'companies-house',
    });
    expect(hits[0].url).toContain('12345678');
    expect(hits[0].snippet).toContain('London');
    expect(hits[0].snippet).toContain('EC1A 1BB');
    expect(hits[0].snippet).toContain('active');

    expect(hits[1]).toMatchObject({
      title: 'XYZ CIRCUITS PLC',
      provider: 'companies-house',
    });
    expect(hits[1].snippet).toContain('dissolved');
  });

  it('handles empty items array', async () => {
    mockHttpRequest.mockResolvedValue({ data: { items: [] } });

    const hits = await makeClient().search({ keyword: 'nonexistent', count: 5 });
    expect(hits).toHaveLength(0);
  });

  it('passes pagination params correctly', async () => {
    mockHttpRequest.mockResolvedValue({ data: { items: [] } });

    await makeClient().search({ keyword: 'pcb', count: 5, offset: 3 });

    // URL is the first argument; extract query string after '?'
    const calledUrl = mockHttpRequest.mock.calls[0]![0] as string;
    const params = new URLSearchParams(calledUrl.split('?')[1] ?? '');
    expect(params.get('items_per_page')).toBe('5');
    expect(params.get('start_index')).toBe('15'); // 3 * 5
  });

  it('sends Basic auth header with apiKey', async () => {
    mockHttpRequest.mockResolvedValue({ data: { items: [] } });

    await makeClient('my-secret-key').search({ keyword: 'test' });

    const calledArgs = mockHttpRequest.mock.calls[0]![1] as Record<string, unknown>;
    const headers = calledArgs.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
  });
});
