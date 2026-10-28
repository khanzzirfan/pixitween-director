// Owned by S7a. Clippy fetches the scene image itself, so the URL must be public https.
export class PublicUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicUrlError';
  }
}

const ipv4 = (h: string): number[] | undefined => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  return m ? m.slice(1).map(Number) : undefined;
};

function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0') return true;
  const v4 = ipv4(host);
  if (v4) {
    const [a, b] = v4 as [number, number];
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (host.includes(':')) return host === '::1' || host === '::' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host);
  return false;
}

export function assertPublicUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new PublicUrlError(`Not a valid URL: ${url}.`);
  }
  if (u.protocol !== 'https:' || isPrivateHost(u.hostname)) {
    throw new PublicUrlError(
      `Clippy fetches the scene image itself, so PUBLIC_BASE_URL must be a public https URL (the deployed server, or a tunnel the owner approved). Got ${u.hostname}.`,
    );
  }
  return u;
}

export function publicAssetUrl(baseUrl: string | undefined, assetUrl: string): string {
  if (!baseUrl) throw new PublicUrlError('PUBLIC_BASE_URL is not set.');
  const full = `${baseUrl.replace(/\/+$/, '')}/${assetUrl.replace(/^\/+/, '')}`;
  return assertPublicUrl(full).toString();
}
