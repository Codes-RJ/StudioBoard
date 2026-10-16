import { useRef, useState } from 'react';
import useModalFocus from '../../hooks/useModalFocus';
export default function BackupPassphraseDialog({ restoring, onClose, onSubmit, returnFocusRef }) {
  const dialog = useRef(null); const password = useRef(null); useModalFocus(dialog, { onClose, initialFocusRef: password, returnFocusRef });
  const [passphrase, setPassphrase] = useState(''); const [confirmation, setConfirmation] = useState(''); const [error, setError] = useState('');
  const submit = (event) => {
    event.preventDefault();
    if ([...passphrase].length < 12 || (!restoring && passphrase !== confirmation)) { setError('Use at least 12 characters and matching passphrases.'); return; }
    const value = passphrase; setPassphrase(''); setConfirmation(''); onSubmit(value);
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="backup-protection-title" tabIndex={-1} className="w-full max-w-md rounded-2xl bg-white p-6 text-slate-900 shadow-2xl">
      <h2 id="backup-protection-title" className="font-serif text-2xl font-normal tracking-tight">{restoring ? 'Unlock encrypted backup' : 'Create encrypted backup'}</h2>
      <p className="my-3 text-sm">This passphrase protects the downloaded backup. Keep it separately: a forgotten passphrase cannot be recovered. Your open browser workspace stays unencrypted.</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-sm font-semibold">Backup passphrase<input ref={password} type="password" autoComplete={restoring ? 'current-password' : 'new-password'} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>
        {!restoring && <label className="text-sm font-semibold">Confirm backup passphrase<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border px-3 py-2">Cancel</button><button type="submit" className="rounded-lg bg-indigo-700 px-3 py-2 font-semibold text-white">{restoring ? 'Unlock and restore' : 'Encrypt and download'}</button></div>
      </form>
    </section>
  </div>;
}
