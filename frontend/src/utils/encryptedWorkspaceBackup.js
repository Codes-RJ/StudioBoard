import { MAX_WORKSPACE_BACKUP_BYTES } from './workspaceBackupValidation';
import { readBlobBytes } from './sourceFileStorage';

const MAGIC = new TextEncoder().encode('ADBACKUPENC1\n');
const CHUNK_BYTES = 1024 * 1024;
const MIN_ITERATIONS = 600_000; const MAX_ITERATIONS = 2_000_000;
const MAX_ENCRYPTED_BYTES = MAX_WORKSPACE_BACKUP_BYTES + 64 * 1024;
const encoder = new TextEncoder(); const decoder = new TextDecoder('utf-8', { fatal: true });
const cancelled = (signal) => { if (signal?.aborted) throw new DOMException('Encrypted backup cancelled.', 'AbortError'); };
const subtle = () => { if (!globalThis.crypto?.subtle) throw new Error('Encrypted backups require HTTPS or localhost.'); return crypto.subtle; };
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unbase64 = (text, length) => {
  if (typeof text !== 'string' || text.length > 64) throw new Error('Invalid encryption header.');
  let bytes; try { bytes = Uint8Array.from(atob(text), (value) => value.charCodeAt(0)); } catch { throw new Error('Invalid encryption header.'); }
  if (bytes.length !== length || base64(bytes) !== text) throw new Error('Invalid encryption header.'); return bytes;
};
const numberBytes = (value) => { const result = new Uint8Array(4); new DataView(result.buffer).setUint32(0, value); return result; };
const join = (...parts) => { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; } return result; };
const passwordKey = (passphrase) => {
  if (typeof passphrase !== 'string' || [...passphrase].length < 12 || encoder.encode(passphrase).length > 1024) throw new Error('Use a backup passphrase of at least 12 characters (at most 1024 UTF-8 bytes).');
  const bytes = encoder.encode(passphrase);
  try { return subtle().importKey('raw', bytes, 'PBKDF2', false, ['deriveKey', 'deriveBits']); }
  finally { bytes.fill(0); }
};
const derive = (password, salt, iterations) => subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, password,
  { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const calibration = async (password, salt) => {
  const started = performance.now(); await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, password, 256);
  return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, Math.ceil(100_000 * 500 / Math.max(1, performance.now() - started))));
};
export const isEncryptedWorkspaceBackup = async (file) => {
  if (!file || file.size < MAGIC.length) return false;
  const bytes = new Uint8Array(await readBlobBytes(file.slice(0, MAGIC.length)));
  return MAGIC.every((value, index) => value === bytes[index]);
};
export const encryptWorkspaceBackup = async (file, passphrase, { signal, onProgress } = {}) => {
  cancelled(signal);
  if (!file || file.size > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('The backup exceeds the 200 MB plaintext limit.');
  const password = await passwordKey(passphrase); const salt = crypto.getRandomValues(new Uint8Array(16)); const prefix = crypto.getRandomValues(new Uint8Array(8));
  const iterations = await calibration(password, salt); cancelled(signal);
  const key = await derive(password, salt, iterations); cancelled(signal);
  const header = encoder.encode(JSON.stringify({ version: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations, salt: base64(salt), noncePrefix: base64(prefix), chunkBytes: CHUNK_BYTES }));
  const parts = [MAGIC, numberBytes(header.length), header]; let index = 0;
  const append = async (bytes, final) => {
    cancelled(signal); const counter = numberBytes(index); const flag = new Uint8Array([final ? 1 : 0]);
    const ciphertext = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: join(prefix, counter), additionalData: join(header, counter, flag), tagLength: 128 }, key, bytes));
    cancelled(signal); parts.push(numberBytes(ciphertext.length), flag, ciphertext); index++;
  };
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    const bytes = new Uint8Array(await readBlobBytes(file.slice(offset, offset + CHUNK_BYTES)));
    try { await append(bytes, false); } finally { bytes.fill(0); }
    onProgress?.({ bytes: Math.min(file.size, offset + CHUNK_BYTES), total: file.size });
  }
  await append(encoder.encode(JSON.stringify({ bytes: file.size, chunks: index })), true);
  return new Blob(parts, { type: 'application/octet-stream' });
};
export const decryptWorkspaceBackup = async (file, passphrase, { signal, onProgress } = {}) => {
  cancelled(signal);
  if (!file || file.size > MAX_ENCRYPTED_BYTES || !(await isEncryptedWorkspaceBackup(file))) throw new Error('Invalid or oversized encrypted backup.');
  let offset = MAGIC.length;
  const take = async (length) => {
    cancelled(signal); if (!Number.isSafeInteger(length) || length < 0 || offset + length > file.size) throw new Error('The encrypted backup is truncated.');
    const result = new Uint8Array(await readBlobBytes(file.slice(offset, offset + length))); offset += length; return result;
  };
  const headerLength = new DataView((await take(4)).buffer).getUint32(0);
  if (headerLength < 1 || headerLength > 4096) throw new Error('Invalid encryption header.');
  const headerBytes = await take(headerLength); let header;
  try { header = JSON.parse(decoder.decode(headerBytes)); } catch { throw new Error('Invalid encryption header.'); }
  if (!header || Object.keys(header).sort().join(',') !== 'chunkBytes,cipher,iterations,kdf,noncePrefix,salt,version'
    || header.version !== 1 || header.cipher !== 'AES-256-GCM' || header.kdf !== 'PBKDF2-SHA256' || header.chunkBytes !== CHUNK_BYTES
    || !Number.isSafeInteger(header.iterations) || header.iterations < MIN_ITERATIONS || header.iterations > MAX_ITERATIONS) throw new Error('Unsupported encryption parameters.');
  const salt = unbase64(header.salt, 16); const prefix = unbase64(header.noncePrefix, 8);
  const password = await passwordKey(passphrase); const key = await derive(password, salt, header.iterations); cancelled(signal);
  const parts = []; let bytes = 0; let index = 0;
  while (offset < file.size) {
    const frame = await take(5); const length = new DataView(frame.buffer).getUint32(0); const flag = frame[4];
    if (flag > 1 || length < 16 || length > (flag ? 256 : CHUNK_BYTES + 16) || index > 200) throw new Error('Invalid encrypted chunk.');
    const ciphertext = await take(length); const counter = numberBytes(index); let plaintext;
    try { plaintext = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: join(prefix, counter), additionalData: join(headerBytes, counter, new Uint8Array([flag])), tagLength: 128 }, key, ciphertext)); }
    catch { throw new Error('The passphrase is incorrect or the encrypted backup is damaged. Nothing was restored.'); }
    cancelled(signal);
    if (flag) {
      let footer; try { footer = JSON.parse(decoder.decode(plaintext)); } catch { throw new Error('Invalid encrypted completion record.'); }
      if (offset !== file.size || footer.bytes !== bytes || footer.chunks !== index) throw new Error('The encrypted backup is incomplete or has trailing data.');
      return new Blob(parts, { type: 'application/x-ndjson' });
    }
    if (!plaintext.length) throw new Error('Invalid empty encrypted data chunk.');
    bytes += plaintext.length;
    if (bytes > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('Decrypted bytes exceed the 200 MB policy.');
    parts.push(plaintext); index++; onProgress?.({ bytes, total: file.size });
  }
  throw new Error('The encrypted backup has no authenticated completion record.');
};
