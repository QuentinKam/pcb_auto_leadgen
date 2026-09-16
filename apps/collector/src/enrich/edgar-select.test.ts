import { describe, expect, it } from 'bun:test';
import {
  companyNameTokens,
  extractDomains,
  extractEmails,
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
    const website = selectWebsite(
      ['myomnipod.com', 'insulet.com', 'xbrl.org'],
      [],
      'INSULET CORP'
    );
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
