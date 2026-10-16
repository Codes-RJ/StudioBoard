import { useEffect, useRef } from 'react';
const dialogs = [];
let originalOverflow;
const focusableSelector = 'button, a[href], input, select, textarea, summary, [contenteditable="true"], [tabindex]';

export const isModalControlVisible = (element, dialog) => {
  if (element.tabIndex < 0 || element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (ancestor.tagName === 'DETAILS' && !ancestor.open) {
      const summary = [...ancestor.children].find((child) => child.tagName === 'SUMMARY');
      if (!summary?.contains(element)) return false;
    }
    if (ancestor === dialog) break;
  }
  return true;
};

export default function useModalFocus(dialogRef, { open = true, onClose, initialFocusRef, returnFocusRef, resetKey } = {}) {
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    // Safari pointer clicks do not always focus a button. Callers can retain
    // their explicit opener so closing a dialog still returns keyboard focus.
    const previous = returnFocusRef?.current || document.activeElement;
    if (!dialogs.length) originalOverflow = document.body.style.overflow;
    const entry = { dialog, previous }; dialogs.push(entry); document.body.style.overflow = 'hidden';
    const controls = () => [...dialog.querySelectorAll(focusableSelector)].filter((element) => isModalControlVisible(element, dialog))
      .sort((left, right) => (left.tabIndex > 0 ? left.tabIndex : Infinity) - (right.tabIndex > 0 ? right.tabIndex : Infinity));
    const focusFirst = () => (initialFocusRef?.current && isModalControlVisible(initialFocusRef.current, dialog)
      ? initialFocusRef.current : controls()[0] || dialog).focus();
    focusFirst();
    const handleKey = (event) => {
      if (dialogs.at(-1) !== entry) return;
      if (event.key === 'Escape' && closeRef.current) { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const elements = controls(); const first = elements[0]; const last = elements.at(-1);
      if (!elements.length) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !elements.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !elements.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const handleFocus = (event) => { if (dialogs.at(-1) === entry && !dialog.contains(event.target)) focusFirst(); };
    window.addEventListener('keydown', handleKey, true); document.addEventListener('focusin', handleFocus);
    return () => {
      window.removeEventListener('keydown', handleKey, true); document.removeEventListener('focusin', handleFocus);
      const index = dialogs.indexOf(entry); const wasTop = index === dialogs.length - 1; if (index >= 0) dialogs.splice(index, 1);
      document.body.style.overflow = dialogs.length ? 'hidden' : originalOverflow;
      if (wasTop && previous?.isConnected && (document.activeElement === document.body || dialog.contains(document.activeElement))) previous.focus({ preventScroll: true });
    };
  }, [dialogRef, open, initialFocusRef, returnFocusRef, resetKey]);
}
