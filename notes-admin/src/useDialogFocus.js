import { useCallback, useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function focusableElements(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE)].filter(element => element.getClientRects().length && element.getAttribute('aria-hidden') !== 'true');
}

function focusDialog(dialog, initialFocusSelector) {
  const preferred = initialFocusSelector ? dialog.querySelector(initialFocusSelector) : null;
  (preferred || focusableElements(dialog)[0] || dialog).focus({ preventScroll: true });
}

export default function useDialogFocus(open, initialFocusSelector, onClose) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const onDialogKeyDown = useCallback(event => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (event.key === 'Escape') {
      if (event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current?.();
      return;
    }

    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const focusable = focusableElements(dialog);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }

    const activeIndex = focusable.indexOf(document.activeElement);
    const lastIndex = focusable.length - 1;
    if (event.shiftKey && activeIndex <= 0) {
      event.preventDefault();
      focusable[lastIndex].focus({ preventScroll: true });
    } else if (!event.shiftKey && (activeIndex < 0 || activeIndex === lastIndex)) {
      event.preventDefault();
      focusable[0].focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    if (!open || !dialogRef.current) return undefined;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let settleFocusFrame = 0;
    const focusFrame = requestAnimationFrame(() => {
      settleFocusFrame = requestAnimationFrame(() => {
        if (!dialog.contains(document.activeElement)) focusDialog(dialog, initialFocusSelector);
      });
    });
    const containFocus = event => {
      if (!dialog.contains(event.target)) focusDialog(dialog, initialFocusSelector);
    };
    document.addEventListener('focusin', containFocus);

    return () => {
      cancelAnimationFrame(focusFrame);
      cancelAnimationFrame(settleFocusFrame);
      document.removeEventListener('focusin', containFocus);
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => {
        const remainingDialog = document.querySelector('[role="dialog"][aria-modal="true"]');
        if (remainingDialog && !remainingDialog.contains(previousFocus)) return;
        const returnTarget = previousFocus?.isConnected && previousFocus !== document.body && previousFocus !== document.documentElement && !previousFocus.matches?.(':disabled')
          ? previousFocus
          : document.querySelector('[data-dialog-return-fallback]');
        returnTarget?.focus({ preventScroll: true });
      });
    };
  }, [open, initialFocusSelector]);

  return { dialogRef, onDialogKeyDown };
}
