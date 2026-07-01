import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import KeyList from './KeyList';

describe('KeyList', () => {
  const mockKeys = [
    { id: '1', name: 'App 1', keyPrefix: 'sk-rtr-1', createdAt: '2023-01-01', lastUsedAt: null, revokedAt: null }
  ];

  it('shows create button for admin', () => {
    render(<KeyList keys={[]} isAdmin={true} />);
    expect(screen.getByText(/Create Key/)).toBeInTheDocument();
  });

  it('hides create button for member', () => {
    render(<KeyList keys={[]} isAdmin={false} />);
    expect(screen.queryByText(/Create Key/)).not.toBeInTheDocument();
  });

  it('renders keys', () => {
    render(<KeyList keys={mockKeys} isAdmin={true} />);
    expect(screen.getByText('App 1')).toBeInTheDocument();
    expect(screen.getByText('sk-rtr-1...')).toBeInTheDocument();
  });
});
