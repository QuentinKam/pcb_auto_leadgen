import { describe, expect, it } from 'bun:test';
import { decideDraftReuse } from './generator.ts';

describe('草稿复用策略', () => {
  it('已有 generated 草稿且未强制刷新时复用', () => {
    expect(decideDraftReuse(false, 2)).toBe('reuse');
    expect(decideDraftReuse(undefined, 1)).toBe('reuse');
  });

  it('尚无 generated 草稿时重新生成', () => {
    expect(decideDraftReuse(false, 0)).toBe('regenerate');
    expect(decideDraftReuse(undefined, 0)).toBe('regenerate');
  });

  it('force=true 时一律重新生成（用于「重新生成」按钮）', () => {
    expect(decideDraftReuse(true, 0)).toBe('regenerate');
    expect(decideDraftReuse(true, 5)).toBe('regenerate');
  });
});
