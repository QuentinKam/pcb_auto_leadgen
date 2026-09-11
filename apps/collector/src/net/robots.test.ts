import { describe, expect, test } from 'bun:test';
import { isPathAllowed, parseRobotsTxt } from './robots.ts';

const SAMPLE = `
# sample robots.txt
User-agent: *
Disallow: /admin
Allow: /admin/public
Disallow: /private/*.pdf$
Crawl-delay: 3

User-agent: BadBot
Disallow: /
`;

describe('robots.txt', () => {
  test('解析并回读 crawl-delay', () => {
    const rules = parseRobotsTxt(SAMPLE, 'collector');
    expect(rules.disallow).toContain('/admin');
    expect(rules.allow).toContain('/admin/public');
    expect(rules.crawlDelayMs).toBe(3000);
  });

  test('Disallow 前缀拒绝，Allow 更长时放行', () => {
    const rules = parseRobotsTxt(SAMPLE, 'collector');
    expect(isPathAllowed(rules, '/admin/secret')).toBe(false);
    expect(isPathAllowed(rules, '/admin/public/report')).toBe(true);
    expect(isPathAllowed(rules, '/')).toBe(true);
  });

  test('通配 + $ 锚定', () => {
    const rules = parseRobotsTxt(SAMPLE, 'collector');
    expect(isPathAllowed(rules, '/private/report.pdf')).toBe(false);
    expect(isPathAllowed(rules, '/private/report.pdf.html')).toBe(true);
  });

  test('指定 UA 的分组优先于通配组', () => {
    const rules = parseRobotsTxt(SAMPLE, 'BadBot');
    expect(isPathAllowed(rules, '/')).toBe(false);
  });

  test('Disallow: 空值表示全站放行', () => {
    const rules = parseRobotsTxt('User-agent: *\nDisallow:\n', 'collector');
    expect(isPathAllowed(rules, '/anything')).toBe(true);
    expect(rules.disallow).toHaveLength(0);
  });
});
