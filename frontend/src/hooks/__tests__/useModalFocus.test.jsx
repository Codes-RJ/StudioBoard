import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useModalFocus from '../useModalFocus';

function Dialog({ returnFocusRef }) {
  const dialog = useRef(null); useModalFocus(dialog, { returnFocusRef });
  return <div ref={dialog} role="dialog" aria-label="Keyboard fixture" tabIndex={-1}>
    <div style={{ display: 'none' }}><button>CSS hidden</button></div>
    <div aria-hidden="true"><button>Hidden from readers</button></div>
    <div style={{ visibility: 'hidden' }}><button>Invisible</button></div>
    <button>First</button>
    <details><summary>Advanced options</summary><button>Closed details control</button></details>
    <fieldset disabled><button>Disabled group</button></fieldset>
    <button tabIndex={-2}>Excluded tab stop</button><button>Last</button>
  </div>;
}

describe('modal focus with hidden controls', () => {
  it('returns focus to an explicit opener even when pointer activation left body focused', () => {
    const opener = document.createElement('button'); document.body.append(opener);
    expect(document.activeElement).toBe(document.body);
    const { unmount } = render(<Dialog returnFocusRef={{ current: opener }} />);
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    unmount(); expect(opener).toHaveFocus(); opener.remove();
  });
  it('starts on a visible control, skips closed detail content and restores opener focus', () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const { unmount } = render(<Dialog />);
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    screen.getByRole('button', { name: 'Last' }).focus(); fireEvent.keyDown(window, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    unmount(); expect(opener).toHaveFocus(); opener.remove();
  });
  it('recomputes visibility after a details section opens or the focused control becomes hidden', () => {
    const { unmount } = render(<Dialog />);
    const details = screen.getByText('Advanced options').parentElement;
    details.open = true;
    const control = screen.getByRole('button', { name: 'Closed details control' }); control.focus();
    details.open = false;
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    unmount();
  });
});
