import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { EdgarSearchClient } from './edgar.ts';

const mockHttpRequest = vi.fn();

describe('EdgarSearchClient', () => {
  beforeEach(() => mockHttpRequest.mockClear());

  const makeClient = () =>
    new EdgarSearchClient({
      userAgent: 'PCBLeadGen test@example.com',
      http: { request: mockHttpRequest } as never,
    });

  it('parses SEC EDGAR search response into SearchHit array', async () => {
    const mockResponse = {
      hits: {
        total: { value: 2 },
        hits: [
          {
            _id: '0000897723-24-000012:sanm-20240315.htm',
            _source: {
              display_names: ['SANMINA CORP  (SANM)  (CIK 0000897723)'],
              ciks: ['897723'],
              sics: ['3672'],
              biz_locations: ['San Jose, CA'],
              file_date: '2024-03-15',
              form: '10-K',
            },
          },
          {
            _id: '0001116942-24-000008:ttmi-20231231.htm',
            _source: {
              display_names: ['TTM TECHNOLOGIES INC  (TTMI)  (CIK 0001116942)'],
              ciks: ['1116942'],
              sics: ['3679'],
              biz_locations: ['Santa Ana, CA'],
              file_date: '2024-02-20',
              form: '10-K',
            },
          },
        ],
      },
    };

    mockHttpRequest.mockResolvedValue({ data: mockResponse });

    const client = makeClient();
    const hits = await client.search({ keyword: 'printed circuit', count: 10 });

    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      title: 'SANMINA CORP',
      provider: 'edgar',
    });
    expect(hits[0].snippet).toContain('SIC: 3672');
    expect(hits[0].snippet).toContain('PCB Manufacturer');
    expect(hits[0].url).toContain('0000897723');
    expect(hits[0].accessionDir).toBe('0000897723-24-000012');

    expect(hits[1]).toMatchObject({
      title: 'TTM TECHNOLOGIES INC',
      provider: 'edgar',
    });
    expect(hits[1].snippet).toContain('SIC: 3679');
    expect(hits[1].snippet).not.toContain('PCB Manufacturer'); // SIC != 3672
  });

  it('returns empty array when response has no hits', async () => {
    mockHttpRequest.mockResolvedValue({ data: {} });

    const client = makeClient();
    const hits = await client.search({ keyword: 'nonexistent xyz', count: 5 });
    expect(hits).toHaveLength(0);
  });

  it('handles missing optional fields gracefully', async () => {
    mockHttpRequest.mockResolvedValue({
      data: {
        hits: {
          hits: [
            {
              _id: '',
              _source: { display_names: ['ACME CORP'], ciks: [], sics: [], biz_locations: [] },
            },
          ],
        },
      },
    });

    const client = makeClient();
    const hits = await client.search({ keyword: 'acme', count: 5 });

    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toBe(null);
  });

  it('maps SIC code to industry slug and human-readable label', async () => {
    mockHttpRequest.mockResolvedValue({
      data: {
        hits: {
          hits: [
            {
              _id: '0001145197-22-000012:podd-20211231.htm',
              _source: {
                display_names: ['INSULET CORP  (PODD)  (CIK 0001145197)'],
                ciks: ['1145197'],
                sics: ['3841'],
                biz_locations: ['Acton, MA'],
              },
            },
            {
              _id: '0000897723-24-000012:sanm-20231230.htm',
              _source: {
                display_names: ['SANMINA CORP  (SANM)  (CIK 0000897723)'],
                ciks: ['897723'],
                sics: ['3672'],
                biz_locations: ['San Jose, CA'],
              },
            },
          ],
        },
      },
    });

    const client = makeClient();
    const hits = await client.search({ keyword: 'pcb', count: 5 });

    expect(hits[0].industry).toBe('medical_devices');
    expect(hits[0].snippet).toContain('SIC: 3841 Surgical and Medical Devices');

    // SIC 3672 is a PCB manufacturer — industry slug must stay null
    expect(hits[1].industry).toBe(null);
  });

  it('strips lone trailing (CIK xxxx) when no ticker paren exists', async () => {
    mockHttpRequest.mockResolvedValue({
      data: {
        hits: {
          hits: [
            {
              _id: '0001103640-20-000015:omph-20200131.htm',
              _source: {
                display_names: ['OMPHALOS, CORP  (CIK 0001103640)'],
                ciks: ['1103640'],
                sics: ['3670'],
                biz_locations: ['Luchu Taoyuan County, F5'],
              },
            },
          ],
        },
      },
    });

    const client = makeClient();
    const hits = await client.search({ keyword: 'omphalos', count: 5 });

    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('OMPHALOS, CORP');
  });

  it('dedupes filings by CIK and truncates to count client-side', async () => {
    const sources = [
      {
        _id: '0000897723-20-000034:sanm-20201003.htm',
        _source: {
          display_names: ['SANMINA CORP  (SANM)  (CIK 0000897723)'],
          ciks: ['897723'],
          sics: ['3672'],
          biz_locations: ['San Jose, CA'],
          file_date: '2020-11-13',
        },
      },
      {
        _id: '0000897723-25-000018:sanm-20240928.htm',
        _source: {
          display_names: ['SANMINA CORP  (SANM)  (CIK 0000897723)'],
          ciks: ['897723'],
          sics: ['3672'],
          biz_locations: ['San Jose, CA'],
          file_date: '2024-11-27',
        },
      },
      {
        _id: '0001116942-22-000006:ttmi-20211231.htm',
        _source: {
          display_names: ['TTM TECHNOLOGIES INC  (TTMI)  (CIK 0001116942)'],
          ciks: ['1116942'],
          sics: ['3672'],
          biz_locations: ['Santa Ana, CA'],
          file_date: '2022-03-01',
        },
      },
      {
        _id: '0001145197-22-000012:podd-20211231.htm',
        _source: {
          display_names: ['INSULET CORP  (PODD)  (CIK 0001145197)'],
          ciks: ['1145197'],
          sics: ['3841'],
          biz_locations: ['Acton, MA'],
          file_date: '2022-02-24',
        },
      },
    ];
    mockHttpRequest.mockResolvedValue({ data: { hits: { hits: sources } } });

    const client = makeClient();
    const hits = await client.search({ keyword: 'pcb', count: 2 });

    // EDGAR ignores size and would return all 4 rows; client dedupes to 3 CIKs then slices to 2
    expect(hits).toHaveLength(2);
    expect(hits[0].title).toBe('SANMINA CORP');
    expect(hits[1].title).toBe('TTM TECHNOLOGIES INC');
  });

  it('respects count and offset parameters', async () => {
    mockHttpRequest.mockResolvedValue({ data: { hits: { hits: [] } } });

    const client = makeClient();
    await client.search({ keyword: 'pcb', count: 5, offset: 2 });

    // EDGAR builds the full URL (with query string) as the first arg
    const calledUrl = mockHttpRequest.mock.calls[0]![0] as string;
    const params = new URLSearchParams(calledUrl.split('?')[1] ?? '');
    expect(params.get('size')).toBe('5');
    expect(params.get('from')).toBe('10');
    expect(params.get('forms')).toBe('10-K,10-K405');
  });
});
