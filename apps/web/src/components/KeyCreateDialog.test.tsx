import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import KeyCreateDialog from './KeyCreateDialog';

describe('KeyCreateDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders form when open', () => {
    render(<KeyCreateDialog isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Create Gateway Key')).toBeInTheDocument();
  });

  it('submits form and shows plaintext key once', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ plaintext: 'sk-rtr-12345', keyPrefix: 'sk-rtr-123' })
    });

    render(<KeyCreateDialog isOpen={true} onClose={() => {}} />);
    
    const input = screen.getByPlaceholderText('e.g. Production Application');
    fireEvent.change(input, { target: { value: 'Test Key' } });
    
    const submit = screen.getByRole('button', { name: 'Create Key' });
    fireEvent.click(submit);
    
    await waitFor(() => {
      expect(screen.getByText('sk-rtr-12345')).toBeInTheDocument();
    });
    
    expect(screen.getByText('Key Created Successfully')).toBeInTheDocument();
  });
});
