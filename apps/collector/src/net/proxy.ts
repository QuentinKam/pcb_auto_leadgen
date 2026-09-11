/**
 * 代理 IP 池配置（Bright Data）。
 * 优先使用完整的 BRIGHTDATA_PROXY_URL；否则由 token + 用户名拼装。
 * 未配置时返回 null，采集走直连。
 */
export function resolveProxyUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.BRIGHTDATA_PROXY_URL?.trim();
  if (explicit) return explicit;

  const token = env.BRIGHTDATA_TOKEN?.trim();
  const username = env.BRIGHTDATA_PROXY_USERNAME?.trim();
  if (!token || !username) return null;

  const host = env.BRIGHTDATA_PROXY_HOST?.trim() || 'brd.superproxy.io';
  const port = env.BRIGHTDATA_PROXY_PORT?.trim() || '33335';
  return `http://${encodeURIComponent(username)}:${encodeURIComponent(token)}@${host}:${port}`;
}
