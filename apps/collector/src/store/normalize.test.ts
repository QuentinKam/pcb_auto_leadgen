import { describe, expect, test } from 'bun:test';
import {
  buildWebsiteUrl,
  cleanCompanyName,
  domainFromUrl,
  employeeCountToSizeBucket,
  isLikelyCompanyDomain,
  normalizeDomain,
} from './normalize.ts';

describe('normalizeDomain / domainFromUrl', () => {
  test('去协议 / www / 路径 / 查询串', () => {
    expect(domainFromUrl('https://www.acme-corp.com/about?utm=1#team')).toBe('acme-corp.com');
    expect(normalizeDomain('http://WWW.Acme.com:8443/x')).toBe('acme.com');
  });

  test('非法输入返回 null', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});

describe('isLikelyCompanyDomain', () => {
  test('过滤社媒与聚合站', () => {
    expect(isLikelyCompanyDomain('linkedin.com')).toBe(false);
    expect(isLikelyCompanyDomain('www.crunchbase.com')).toBe(false);
    expect(isLikelyCompanyDomain('acme-corp.com')).toBe(true);
  });
});

describe('employeeCountToSizeBucket', () => {
  test('映射到 size_bucket 区间', () => {
    expect(employeeCountToSizeBucket(8)).toBe('1-10');
    expect(employeeCountToSizeBucket(140)).toBe('51-200');
    expect(employeeCountToSizeBucket(340)).toBe('201-500');
    expect(employeeCountToSizeBucket(5000)).toBe('1001-5000');
    expect(employeeCountToSizeBucket(9000)).toBe('5000+');
    expect(employeeCountToSizeBucket(null)).toBeNull();
  });
});

describe('cleanCompanyName', () => {
  test('去掉标题后缀', () => {
    expect(cleanCompanyName('Volterra Robotics - Home')).toBe('Volterra Robotics');
    expect(cleanCompanyName('Acme Corp | Official Site')).toBe('Acme Corp');
    expect(cleanCompanyName('Globex')).toBe('Globex');
  });
});

describe('buildWebsiteUrl', () => {
  test('拼装 https 官网地址', () => {
    expect(buildWebsiteUrl('acme-corp.com')).toBe('https://acme-corp.com');
  });
});
