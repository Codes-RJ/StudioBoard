import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OperationStatusProvider, useOperationStatus } from '../OperationStatusContext';

function Controls() {
  const { startOperation } = useOperationStatus();
  const operation = useRef(null);
  return (
    <>
      <button onClick={() => {
        operation.current = startOperation('Importing dataset');
        operation.current.update('Parsing locally…');
      }}>Start</button>
      <button onClick={() => operation.current?.succeed('Ready in this browser.')}>Finish</button>
    </>
  );
}

describe('OperationStatusProvider', () => {
  it('shows one operation from progress through completion', () => {
    render(<OperationStatusProvider><Controls /></OperationStatusProvider>);

    fireEvent.click(screen.getByText('Start'));
    expect(screen.getByRole('status')).toHaveTextContent('Importing dataset');
    expect(screen.getByRole('status')).toHaveTextContent('Parsing locally…');

    fireEvent.click(screen.getByText('Finish'));
    expect(screen.getByRole('status')).toHaveTextContent('Ready in this browser.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Importing dataset status' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
