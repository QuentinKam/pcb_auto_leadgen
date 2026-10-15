import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { OpenCorporatesClient } from './opencorporates.ts';

const mockHttpRequest = vi.fn();

describe('OpenCorporatesClient', () => {
  beforeEach(() => mockHttpRequest.mockClear());

  const makeClient = (token = 'test-token') =>
    new OpenCorporatesClient({
      apiToken: token,
      http: { request: mockHttpRequest } as never,
    });

  it('throws if apiToken is empty', async () => {
    const client = new OpenCorporatesClient({ apiToken: '', http: mockHttpRequest as never });
    await expect(client.search({ keyword: 'test' })).rejects.toThrow(
      'OpenCorporates API token required'
    );
  });

  it('parses OpenCorporates response into SearchHit array', async () => {
    const mockResponse = {
      results: {
        companies: {
          total: 2,
          company: [
            {
              company: {
                name: 'APEX CIRCUITS INC',
                company_number: 'C1234567',
                jurisdiction_code: 'us_de',
                incorporation_date: '2019-03-15',
                company_type: 'Corporation',
                current_status: 'Active',
              },
              opencorporates_url: 'https://opencorporates.com/companies/us_de/C1234567',
            },
            {
              company: {
                name: 'NEXUS ELECTRONICS LTD',
                company_number: '12345678',
                jurisdiction_code: 'gb',
                incorporation_date: '2018-07-22',
                company_type: 'Private limited company',
                current_status: 'Active',
                branch: 'Branch of non-UK entity',
              },
              opencorporates_url: 'https://opencorporates.com/companies/gb/12345678',
            },
          ],
        },
      },
    };

    mockHttpRequest.mockResolvedValue({ data: mockResponse });

    const hits = await makeClient().search({ keyword: 'printed circuit board', count: 10 });

    expect(hits).toHaveLength(2);

    expect(hits[0]).toMatchObject({
      title: 'APEX CIRCUITS INC',
      url: 'https://opencorporates.com/companies/us_de/C1234567',
      provider: 'opencorporates',
    });
    expect(hits[0].snippet).toContain('US_DE');
    expect(hits[0].snippet).toContain('Active');

    expect(hits[1]).toMatchObject({
      title: 'NEXUS ELECTRONICS LTD',
      provider: 'opencorporates',
    });
    expect(hits[1].snippet).toContain('GB');
    expect(hits[1].snippet).toContain('Branch');
  });

  it('adds dissolved marker for dead companies', async () => {
    mockHttpRequest.mockResolvedValue({
      data: {
        results: {
          companies: {
            company: [
              {
                company: {
                  name: 'OLD CORP',
                  jurisdiction_code: 'us',
                  dead: true,
                },
                opencorporates_url: 'https://opencorporates.com/companies/us/0001',
              },
            ],
          },
        },
      },
    });

    const hits = await makeClient().search({ keyword: 'test' });
    expect(hits[0].snippet).toContain('[DISSOLVED]');
  });

  it('uses country as jurisdiction_code when specified', async () => {
    mockHttpRequest.mockResolvedValue({ data: { results: { companies: { company: [] } } } });

    await makeClient().search({ keyword: 'pcb', country: 'de' });

    // URL is the first argument
    const calledUrl = mockHttpRequest.mock.calls[0]![0] as string;
    const params = new URLSearchParams(calledUrl.split('?')[1] ?? '');
    expect(params.get('jurisdiction_code')).toBe('de');
  });

  it('handles empty companies array', async () => {
    mockHttpRequest.mockResolvedValue({ data: { results: {} } });

    const hits = await makeClient().search({ keyword: 'nonexistent' });
    expect(hits).toHaveLength(0);
  });

  it('passes pagination correctly', async () => {
    mockHttpRequest.mockResolvedValue({ data: { results: { companies: { company: [] } } } });

    await makeClient().search({ keyword: 'pcb', count: 5, offset: 2 });

    // URL is the first argument
    const calledUrl = mockHttpRequest.mock.calls[0]![0] as string;
    const params = new URLSearchParams(calledUrl.split('?')[1] ?? '');
    expect(params.get('per_page')).toBe('5');
    expect(params.get('page')).toBe('3'); // offset 2 + 1
  });
});
