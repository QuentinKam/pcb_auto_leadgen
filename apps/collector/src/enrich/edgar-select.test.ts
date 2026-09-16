import { describe, expect, it } from 'bun:test';
import {
  companyNameTokens,
  extractDomains,
  extractEmails,
  extractItemBusiness,
  pickMainDoc,
  selectWebsite,
} from './edgar-select.ts';

describe('pickMainDoc', () => {
  it('picks the largest non-attachment htm', () => {
    const items = [
      { name: '0000897723-24-000012-index.html', size: 1000 },
      { name: 'sanm-ex211.htm', size: 500 },
      { name: 'R1.htm', size: 300 },
      { name: 'sanm-20231230.htm', size: 2_000_000 },
    ];
    expect(pickMainDoc(items)).toBe('sanm-20231230.htm');
  });

  it('filters EX attachments by various naming patterns', () => {
    const items = [
      { name: 'podd-ex1044.htm', size: 5_000_000 },
      { name: 'podd-exx211.htm', size: 4_000_000 },
      { name: 'podd-20211231.htm', size: 100 },
    ];
    expect(pickMainDoc(items)).toBe('podd-20211231.htm');
  });

  it('returns null when no candidate remains', () => {
    expect(pickMainDoc([{ name: 'R99.htm', size: 1 }])).toBe(null);
  });
});

describe('selectWebsite', () => {
  it('prefers domain matching a company-name token', () => {
    const website = selectWebsite(['myomnipod.com', 'insulet.com', 'xbrl.org'], [], 'INSULET CORP');
    expect(website).toBe('insulet.com');
  });

  it('weights email domains and ignores service providers', () => {
    const website = selectWebsite(
      ['ttmtech.com', 'dfinsolutions.com', 'newsfilecorp.com'],
      ['ttmtech.com'],
      'TTM TECHNOLOGIES INC'
    );
    expect(website).toBe('ttmtech.com');
  });

  it('matches multi-word names against combined slugs', () => {
    const website = selectWebsite(['mydario.com', 'dariohealth.com'], [], 'DarioHealth Corp.');
    expect(website).toBe('dariohealth.com');
  });

  it('returns null when nothing matches a name token', () => {
    expect(selectWebsite(['ilings.com', 'w3.org'], [], 'NORTECH SYSTEMS INC')).toBe(null);
  });
});

describe('companyNameTokens', () => {
  it('drops legal suffixes and short tokens', () => {
    expect(companyNameTokens('Array Technologies, Inc.')).toEqual(['array']);
  });
});

describe('extractEmails', () => {
  it('dedupes and lowercases emails from text and mailto', () => {
    const emails = extractEmails('Contact IR@Foo.com or ir@foo.com', ['Info@foo.com']);
    expect(emails).toEqual(['ir@foo.com', 'info@foo.com']);
  });

  it('rejects placeholders and image-like false matches', () => {
    expect(extractEmails('a@example.com 2x@2x.io', [])).toEqual([]);
  });
});

describe('extractDomains', () => {
  it('extracts bare and URL-form domains, deduped and order-preserving', () => {
    const domains = extractDomains('see www.insulet.com and https://insulet.com/x plus xbrl.org');
    expect(domains).toEqual(['insulet.com']);
  });
});

describe('extractItemBusiness', () => {
  // 生成约 N 词的填充正文，保证超过最短章节长度
  const filler = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => `we design and manufacture electronic assemblies ${i}`
    ).join(' ');

  const filingHtml = (body: string) => `<html><body><div>${body}</div></body></html>`;

  it('skips the TOC entry and extracts the body until Item 1A', () => {
    const html = filingHtml(`
      <p>Item 1. Business 3 Item 1A. Risk Factors 8 Item 2. Properties 20</p>
      <p>Item 1. Business Overview We are a maker of devices. ${filler(60)}</p>
      <p>Item 1A. Risk Factors Our stock is volatile.</p>
    `);
    const text = extractItemBusiness(html);
    expect(text).not.toBe(null);
    expect(text).toContain('Overview We are a maker of devices');
    expect(text).not.toContain('Risk Factors');
    expect(text).not.toContain('Item 2. Properties');
  });

  it('removes continued-page headers inside the section', () => {
    const html = filingHtml(`
      <p>Item 1.Business3Item 1A.Risk Factors5Item 1B.Unresolved Staff Comments9</p>
      <p>Item 1. Business Our Company ${filler(20)}</p>
      <p>Item 1. Business (continued) ${filler(20)}</p>
      <p>Item 1A. Risk Factors risks ahead</p>
    `);
    const text = extractItemBusiness(html);
    expect(text).not.toBe(null);
    expect(text ?? '').not.toMatch(/item\s*1[\s.:]*business/i);
    expect(text ?? '').toContain('Our Company');
  });

  it('falls back to Item 2 when the filing has no Item 1A', () => {
    const html = filingHtml(`
      <p>Item 1Business1Item 2Properties30</p>
      <p>Item 1. Business We build connectors. ${filler(60)}</p>
      <p>Item 2. Properties Our facilities</p>
    `);
    const text = extractItemBusiness(html);
    expect(text).toContain('We build connectors');
    expect(text).not.toContain('Our facilities');
  });

  it('returns null for amendments without an Item 1 section', () => {
    const html = filingHtml(`
      <p>FORM 10-K/A Amendment No. 1</p>
      <p>business experience of each of our directors ${filler(60)}</p>
      <p>Item 2. Properties</p>
    `);
    expect(extractItemBusiness(html)).toBe(null);
  });

  it('returns null when the detected section is too short', () => {
    const html = filingHtml(`
      <p>Item 1. Business tiny</p>
      <p>Item 1A. Risk Factors risks</p>
    `);
    expect(extractItemBusiness(html)).toBe(null);
  });
});
