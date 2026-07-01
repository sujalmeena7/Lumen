import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import CredentialList from './CredentialList';

describe('CredentialList', () => {
  const mockCreds = [
    { provider: 'openai', label: 'prod key', createdAt: '2023-01-01', rotatedAt: null },
  ];

  it('shows add button for admin', () => {
    render(<CredentialList credentials={[]} isAdmin={true} />);
    expect(screen.getByText(/Add Credential/)).toBeInTheDocument();
  });

  it('hides add button for member', () => {
    render(<CredentialList credentials={[]} isAdmin={false} />);
    expect(screen.queryByText(/Add Credential/)).not.toBeInTheDocument();
  });

  it('renders credentials without ever showing a secret', () => {
    render(<CredentialList credentials={mockCreds} isAdmin={true} />);
    expect(screen.getByText('openai')).toBeInTheDocument();
    expect(screen.getByText('prod key')).toBeInTheDocument();
  });

  it('shows an empty state when there are no credentials', () => {
    render(<CredentialList credentials={[]} isAdmin={true} />);
    expect(screen.getByText(/No provider credentials configured/)).toBeInTheDocument();
  });

  it('hides delete actions for non-admins', () => {
    render(<CredentialList credentials={mockCreds} isAdmin={false} />);
    expect(screen.queryByTitle('Delete credential')).not.toBeInTheDocument();
  });
});
