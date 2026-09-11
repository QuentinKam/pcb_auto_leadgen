import type { Browser } from 'playwright';

/**
 * Playwright 降级抓取：静态 HTML 正文过少（强 JS 渲染站点）时使用。
 * 浏览器未安装时自动降级为 null，并只在首次失败时告警，不阻塞采集。
 */
let browserUnavailable = false;

export interface BrowserFetchOptions {
  timeoutMs?: number;
}

export async function fetchRenderedHtml(
  url: string,
  options: BrowserFetchOptions = {}
): Promise<string | null> {
  const browser = await launchBrowser();
  if (!browser) return null;

  try {
    const page = await browser.newPage();
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs ?? 20_000,
    });
    return await page.content();
  } catch (error) {
    console.warn(
      `[collector] Playwright fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  } finally {
    await browser.close();
  }
}

async function launchBrowser(): Promise<Browser | null> {
  if (browserUnavailable) return null;
  try {
    const { chromium } = await import('playwright');
    return await chromium.launch({ headless: true });
  } catch (error) {
    browserUnavailable = true;
    console.warn(
      `[collector] Playwright unavailable, JS-rendered fallback disabled (run: pnpm exec playwright install chromium). ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}
