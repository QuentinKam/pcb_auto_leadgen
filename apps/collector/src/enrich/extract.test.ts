import { describe, expect, test } from 'bun:test';
import { emptySignals, extractSignals, mergeSignals } from './extract.ts';

const HTML = `<!doctype html>
<html>
  <head>
    <title>Volterra Robotics</title>
    <meta name="description" content="Autonomous mobile robots for cold-chain logistics." />
  </head>
  <body>
    <p>We are a robotics company building autonomous mobile robots (AMR) for warehouse and cold-chain logistics. Founded in 2015, we design and manufacture control boards for every robot we ship.</p>
    <div class="products">
      <h3>Motor Control Board</h3>
      <h3>Sensor Interface Board</h3>
      <h3>Marketing Brochure</h3>
    </div>
    <a href="mailto:sales@volterra-robotics.example?subject=hi">Contact sales</a>
    <p>Email us at info@volterra-robotics.example or call the office.</p>
    <script>const leaked = 'setup@noise.example';</script>
  </body>
</html>`;

describe('extractSignals', () => {
  test('抽取标题 / 描述 / 简介 / 产品 / 邮箱', () => {
    const signals = extractSignals(HTML, 'https://volterra-robotics.example');

    expect(signals.title).toBe('Volterra Robotics');
    expect(signals.description).toBe('Autonomous mobile robots for cold-chain logistics.');
    expect(signals.about).toContain('We are a robotics company');
    expect(signals.products).toContain('Motor Control Board');
    expect(signals.products).toContain('Sensor Interface Board');
    expect(signals.products).not.toContain('Marketing Brochure');
    expect(signals.emails).toContain('sales@volterra-robotics.example');
    expect(signals.emails).toContain('info@volterra-robotics.example');
    expect(signals.emails).not.toContain('setup@noise.example');
    expect(signals.industrySignals).toContain('robotics');
    expect(signals.wordCount).toBeGreaterThan(10);
  });

  test('mergeSignals 合并标量与数组', () => {
    const a = { ...emptySignals(), about: 'We are A', products: ['x'], text: 'hello' };
    const b = {
      ...emptySignals(),
      description: 'B description',
      products: ['x', 'y'],
      text: 'world',
      wordCount: 5,
    };

    const merged = mergeSignals(a, b);
    expect(merged.about).toBe('We are A');
    expect(merged.description).toBe('B description');
    expect(merged.products).toEqual(['x', 'y']);
    expect(merged.text).toBe('hello world');
    expect(merged.wordCount).toBe(5);
  });
});
