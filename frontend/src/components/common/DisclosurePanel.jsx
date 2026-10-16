import { useEffect, useId, useRef, useState } from 'react';
import { FiInfo, FiX } from 'react-icons/fi';

// A nonmodal panel: ordinary Tab order, Escape and outside-click dismissal.
// Keep contents mounted so closing a panel cannot cancel an ongoing operation.
export default function DisclosurePanel({ label, children, trigger, className = '' }) {
  const id = useId();
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event) => {
      if (document.querySelector('[aria-modal="true"]') || rootRef.current?.contains(event.target)) return;
      if (rootRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return;
      if (rootRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        buttonRef.current?.focus();
      }
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return <div ref={rootRef} className={`disclosure ${className}`}>
    <button ref={buttonRef} type="button" className={trigger ? 'workspace-button disclosure-trigger' : 'info-button'} aria-label={label} title={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      {trigger || <FiInfo aria-hidden="true" />}
    </button>
    <div id={id} hidden={!open} role="region" aria-label={label} className="disclosure-panel">
      <div className="disclosure-heading"><h3>{label}</h3><button type="button" className="info-button" aria-label={`Close ${label.toLowerCase()}`} onClick={() => { setOpen(false); buttonRef.current?.focus(); }}><FiX aria-hidden="true" /></button></div>
      {children}
    </div>
  </div>;
}
