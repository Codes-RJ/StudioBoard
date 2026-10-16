# Encryption, MFA and credential rotation: implementation decisions

Status October 6: opt-in encrypted backups are implemented and verified. Full workspace encryption and server MFA enrollment remain designs requiring explicit migration/recovery choices. Existing local workspaces and server hashes remain readable.

## Local data and encrypted backup

The current IndexedDB workspace and ordinary Backup downloads remain plaintext. Encrypted backup creates a separately protected download. OS/browser profile encryption and checksums do not establish application encryption or protect against scripts running in the unlocked origin. Same-origin XSS can read unlocked data and issue authenticated requests even when it cannot read an HttpOnly cookie.

Implemented **encrypted backup** uses the `ADBACKUPENC1` versioned envelope, random 16-byte salt, calibrated PBKDF2-HMAC-SHA256 (600,000–2,000,000 iterations, approximately 500 ms derivation target), and nonextractable AES-256-GCM keys through Web Crypto. Each 1 MiB chunk uses an independent nonce made from a random 8-byte per-backup prefix and its 32-bit sequence number. Associated data authenticates the exact header, sequence and final/data flag; an encrypted completion record binds total bytes/chunks. Restore validates bounded parameters before derivation, authenticates all frames/footer, then runs the existing inner backup verification/staging before publication. Wrong passwords, tag changes, reordering, truncation and trailing data fail without publishing sources. Plaintext remains capped at 200 MiB and ciphertext at 200 MiB plus 64 KiB. Calibrated costs need real weak-device testing; the final ciphertext/decrypted Blob still scales with archive size.

Backup keys remain nonextractable and in memory only; passphrases are not written to browser storage, URLs, logs or telemetry. The dialog confirms new passwords and explains that forgotten passwords cannot be recovered. Unit tests use real Web Crypto, and Chromium/Firefox/WebKit fixture tests prove wrong-password rejection and original-byte restore. JavaScript strings cannot be reliably erased, and an unlocked same-origin script can access inputs/plaintext. Backup-only encryption adds no workspace lock or recovery key. A future full-workspace lock must terminate workers and clear relevant caches. Server password peppers do not belong in the browser.

Full workspace encryption needs a separate schema/version, original-byte/row/index coverage, crash-safe migration, rollback, multiple-tab lock handling and explicit unlocked/locked access paths. Keep a validated plaintext backup outside the migration transaction. Do not change the workspace origin without an export/migration path. Do not implement this as an opaque encryption wrapper around current arbitrary IndexedDB objects.

Decisions still needed for expansion: full workspace encryption, password recovery key support, lock timeout/tab semantics and whether searchable metadata may remain plaintext. Existing encrypted-backup behavior needs none of these activation decisions; broader migration must be opt-in and reviewed.

## Server MFA

Prefer WebAuthn/passkeys for administrators on the actual HTTPS relying-party domain. Verify challenges server-side, consume once with short expiry, bind to the authenticated enrollment/re-authentication session, validate RP ID/origin and require user verification. Never infer the RP ID from an arbitrary Host header. Support a second registered authenticator before enforcement. Recovery codes must be generated once, shown once, stored only as verifier hashes, individually consumed and rate-limited. Recovery/enrollment/removal and elevated administrator operations need audit events and token-version revocation.

If TOTP is also selected, encrypt its seed with a separate server-managed key, reject replay of an already-used time step, limit clock tolerance and attempts, and retain the same recovery requirements. MFA challenges must not return the final access token before successful verification. No self-service insecure "reset MFA" endpoint; define the operator recovery procedure before enforcing MFA on existing administrators.

Decisions needed: passkeys only or passkeys plus TOTP; actual RP domain; registration/recovery policy; existing-admin enrollment grace period; seed-key custody if TOTP is selected. Existing credentials must not be invalidated to simulate MFA.

## Password/pepper/signing-key rotation

Current passwords use random bcrypt salts, versioned HMAC-peppered material and cost 12. Unknown accounts now execute a current verifier; verification/rehashing runs outside the event loop. Preserve both legacy and `v2$` verification. A future Argon2id format must introduce its own explicit version and verify-and-upgrade after a successful login; never reinterpret existing bytes under a new scheme.

Pepper rotation requires version/key identifiers and a short-lived server-side old-key verification ring, upgrade on login, and a forced-reset/recovery plan for dormant accounts. Deleting the old pepper prematurely locks out those users. Signing-key rotation requires an explicit algorithm/key-ID allowlist, overlap shorter than the session lifetime, and incident revocation via token versions; do not choose algorithm/key locations from tokens. Keep signing secrets, pepper and optional MFA seed keys distinct and in operator-managed secret storage. Existing logout revokes every earlier token for that account, not only the current device.

Reference: [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [WebAuthn specification](https://www.w3.org/TR/webauthn-3/), [Web Crypto](https://www.w3.org/TR/WebCryptoAPI/). Only backup-file encryption is implemented here; full-workspace encryption, recovery-key support, MFA and credential rotation remain future designs.
