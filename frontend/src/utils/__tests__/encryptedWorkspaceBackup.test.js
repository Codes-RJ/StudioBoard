import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptWorkspaceBackup, decryptWorkspaceBackup, isEncryptedWorkspaceBackup } from '../encryptedWorkspaceBackup';
import { readBlobBytes } from '../sourceFileStorage';
const previousCrypto = globalThis.crypto;
beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); });
afterAll(() => { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: previousCrypto }); });
const passphrase = 'fixture-only long backup passphrase';
const magicLength = new TextEncoder().encode('ADBACKUPENC1\n').length;
describe('authenticated encrypted workspace envelopes', () => {
  it('round-trips multiple chunks and hides original names/content', async () => {
    const bytes = new Uint8Array(1024 * 1024 + 37); bytes[0] = 255; bytes[1024 * 1024 + 36] = 128;
    const encrypted = await encryptWorkspaceBackup(new Blob([bytes]), passphrase);
    expect(await isEncryptedWorkspaceBackup(encrypted)).toBe(true);
    const restored = new Uint8Array(await readBlobBytes(await decryptWorkspaceBackup(encrypted, passphrase)));
    expect(Buffer.from(restored).equals(Buffer.from(bytes))).toBe(true);
    const another = await encryptWorkspaceBackup(new Blob([bytes]), passphrase);
    expect(Buffer.from(await readBlobBytes(another)).equals(Buffer.from(await readBlobBytes(encrypted)))).toBe(false);
  });
  it('rejects a wrong passphrase, damage, missing completion and trailing bytes', async () => {
    const encrypted = await encryptWorkspaceBackup(new Blob(['fixture original bytes']), passphrase);
    await expect(decryptWorkspaceBackup(encrypted, 'different long fixture passphrase')).rejects.toThrow('incorrect');
    const bytes = new Uint8Array(await readBlobBytes(encrypted)); bytes[bytes.length - 1] ^= 1;
    await expect(decryptWorkspaceBackup(new Blob([bytes]), passphrase)).rejects.toThrow('damaged');
    await expect(decryptWorkspaceBackup(encrypted.slice(0, encrypted.size - 25), passphrase)).rejects.toThrow();
    await expect(decryptWorkspaceBackup(new Blob([encrypted, 'trailing']), passphrase)).rejects.toThrow('trailing');
  });
  it('rejects reordered authenticated frames and dangerous KDF parameters', async () => {
    const encrypted = await encryptWorkspaceBackup(new Blob([new Uint8Array(1024 * 1024 + 20)]), passphrase);
    const bytes = new Uint8Array(await readBlobBytes(encrypted)); const headerLength = new DataView(bytes.buffer).getUint32(magicLength);
    const start = magicLength + 4 + headerLength; const firstLength = new DataView(bytes.buffer).getUint32(start) + 5;
    const secondLength = new DataView(bytes.buffer).getUint32(start + firstLength) + 5;
    const reordered = new Blob([bytes.slice(0, start), bytes.slice(start + firstLength, start + firstLength + secondLength), bytes.slice(start, start + firstLength), bytes.slice(start + firstLength + secondLength)]);
    await expect(decryptWorkspaceBackup(reordered, passphrase)).rejects.toThrow('damaged');
    const header = JSON.parse(new TextDecoder().decode(bytes.slice(magicLength + 4, start))); header.iterations = 999999999;
    const modified = new TextEncoder().encode(JSON.stringify(header)); const size = new Uint8Array(4); new DataView(size.buffer).setUint32(0, modified.length);
    await expect(decryptWorkspaceBackup(new Blob([bytes.slice(0, magicLength), size, modified, bytes.slice(start)]), passphrase)).rejects.toThrow('parameters');
  });
  it('honors cancellation and rejects weak passphrases before encryption', async () => {
    const signal = AbortSignal.abort();
    await expect(encryptWorkspaceBackup(new Blob(['fixture']), passphrase, { signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(encryptWorkspaceBackup(new Blob(['fixture']), 'short')).rejects.toThrow('12 characters');
  });
});
