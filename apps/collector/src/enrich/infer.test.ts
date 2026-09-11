import { describe, expect, test } from 'bun:test';
import { inferEmployeeCount, inferFundingStage, inferIndustry } from './infer.ts';

describe('inferIndustry', () => {
  test('命中行业关键词返回 scorer 对齐的标签', () => {
    expect(inferIndustry('We build autonomous mobile robots and AMR fleets')).toBe('robotics');
    expect(inferIndustry('FDA Class II medical device manufacturer')).toBe('medical_devices');
    expect(inferIndustry('Supplying ADAS sensors to Tier 1 automotive customers')).toBe(
      'automotive'
    );
  });

  test('无命中返回 null', () => {
    expect(inferIndustry('We sell shoes and apparel online')).toBeNull();
  });
});

describe('inferEmployeeCount', () => {
  test('识别常见人数写法', () => {
    expect(inferEmployeeCount('A team of 120 people in Shenzhen')).toBe(120);
    expect(inferEmployeeCount('More than 500 employees worldwide')).toBe(500);
    expect(inferEmployeeCount('340+ employees')).toBe(340);
  });

  test('无人数信息返回 null', () => {
    expect(inferEmployeeCount('We build robots')).toBeNull();
  });
});

describe('inferFundingStage', () => {
  test('识别融资阶段', () => {
    expect(inferFundingStage('We closed a Series B round in 2025')).toBe('b');
    expect(inferFundingStage('Raised seed funding from angels')).toBe('seed');
    expect(inferFundingStage('Now publicly traded on NASDAQ')).toBe('ipo');
  });

  test('无融资信息返回 null', () => {
    expect(inferFundingStage('We build robots')).toBeNull();
  });
});
