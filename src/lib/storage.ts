/**
 * Supabase Storage (private bucket) for the health record vault: reports,
 * prescriptions, scans, bills, discharge summaries, insurance papers.
 *
 * Off until SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. Files are never
 * public: the dashboard gets a short-lived signed link after an access check.
 * Removing a document only hides it (rule 6: user data is soft-deleted); the file stays.
 * REST shapes follow supabase/storage-js (StorageFileApi): /storage/v1/object/{bucket}/{path},
 * /storage/v1/object/sign/{bucket}/{path} -> { signedURL }.
 */
export interface StorageConfig {
  url: string; // https://<project>.supabase.co/storage/v1
  key: string;
  bucket: string;
}

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const SIGNED_URL_SECONDS = 300;

export function getStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig | null {
  const base = env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key) return null;
  return { url: `${base}/storage/v1`, key, bucket: env.SUPABASE_STORAGE_BUCKET?.trim() || 'health-records' };
}

function headers(cfg: StorageConfig, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${cfg.key}`, apikey: cfg.key, ...extra };
}

export class StorageError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** "parents/<parentId>/<random>-<safe file name>" */
export function storageKeyFor(parentId: string, fileName: string, random: string): string {
  const safe = fileName.toLowerCase().replace(/[^a-z0-9.\-_]+/g, '-').replace(/-+/g, '-').slice(-80) || 'file';
  return `parents/${parentId}/${random}-${safe}`;
}

export async function uploadObject(
  cfg: StorageConfig,
  key: string,
  data: Buffer,
  contentType: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const res = await fetchImpl(`${cfg.url}/object/${cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: headers(cfg, { 'Content-Type': contentType, 'x-upsert': 'false', 'cache-control': 'max-age=3600' }),
    body: new Uint8Array(data),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new StorageError(`upload failed (HTTP ${res.status}${body.message ? `: ${body.message}` : ''})`, res.status);
  }
}

export async function signedUrl(cfg: StorageConfig, key: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${cfg.url}/object/sign/${cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: headers(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
    signal: AbortSignal.timeout(15000)
  });
  const data = (await res.json().catch(() => ({}))) as { signedURL?: string; message?: string };
  if (!res.ok || !data.signedURL) throw new StorageError(`signing failed (HTTP ${res.status})`, res.status);
  return encodeURI(`${cfg.url}${data.signedURL}`);
}

/** Creates the private bucket (scripts/create-storage-bucket.ts). */
export async function createBucket(cfg: StorageConfig, fetchImpl: typeof fetch = fetch): Promise<'created' | 'exists'> {
  const res = await fetchImpl(`${cfg.url}/bucket`, {
    method: 'POST',
    headers: headers(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      id: cfg.bucket,
      name: cfg.bucket,
      public: false,
      file_size_limit: MAX_DOCUMENT_BYTES,
      allowed_mime_types: ALLOWED_DOCUMENT_TYPES
    })
  });
  if (res.ok) return 'created';
  const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string; statusCode?: string };
  if (/already exists|duplicate/i.test(`${body.message} ${body.error}`)) return 'exists';
  throw new StorageError(`bucket creation failed (HTTP ${res.status}: ${body.message || body.error || 'unknown'})`, res.status);
}
