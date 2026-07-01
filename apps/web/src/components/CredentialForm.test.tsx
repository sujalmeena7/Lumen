import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CredentialForm from './CredentialForm';

describe('CredentialForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('submits the form and never displays the entered secret back', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, provider: 'openai', label: 'prod' }),
    });
    const onClose = vi.fn();

    render(<CredentialForm onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-super-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Credential' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText('sk-super-secret')).not.toBeInTheDocument();
  });

  it('surfaces a pending-approval response distinctly from a hard failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 202,
      json: async () => ({ status: 'pending_approval', approvalId: 'abc123' }),
    });
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const onClose = vi.fn();

    render(<CredentialForm onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Credential' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('admin approval'));
  });
});
