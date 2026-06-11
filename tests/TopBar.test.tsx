import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from '../src/components/TopBar';

describe('TopBar provider health', () => {
  it('shows healthy and missing providers distinctly', () => {
    render(
      <TopBar
        lastSavedAt="Saved"
        onRun={vi.fn()}
        providers={[
          { provider: 'reddit', executable: 'rdt', available: true },
          { provider: 'twitter', executable: 'twitter', available: false }
        ]}
      />
    );

    expect(screen.getByLabelText('rdt healthy')).toBeInTheDocument();
    expect(screen.getByLabelText('twitter missing')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
  });

  it('shows a checking state while loading', () => {
    render(<TopBar lastSavedAt="Saved" onRun={vi.fn()} isHealthLoading />);
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });

  it('shows an error state when health is unavailable', () => {
    render(<TopBar lastSavedAt="Saved" onRun={vi.fn()} hasHealthError />);
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });

  it('links to the credential setup docs from the top bar', () => {
    render(<TopBar lastSavedAt="Saved" onRun={vi.fn()} />);
    const link = screen.getByRole('link', { name: /credentials/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('#credentials'));
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('explains how to set up each provider via a pill tooltip', () => {
    render(
      <TopBar
        lastSavedAt="Saved"
        onRun={vi.fn()}
        providers={[
          { provider: 'reddit', executable: 'rdt', available: true },
          { provider: 'twitter', executable: 'twitter', available: false }
        ]}
      />
    );
    expect(screen.getByLabelText('rdt healthy')).toHaveAttribute('title', expect.stringMatching(/rdt login/i));
    expect(screen.getByLabelText('twitter missing')).toHaveAttribute(
      'title',
      expect.stringMatching(/TWITTER_AUTH_TOKEN/)
    );
  });
});
