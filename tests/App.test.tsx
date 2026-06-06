import { render, screen } from '@testing-library/react';
import { App } from '../src/App';

describe('App scaffold', () => {
  it('renders the canvas workbench shell', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Reddix' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run Now/i })).toBeInTheDocument();
    expect(screen.getByText('Reddit Sources')).toBeInTheDocument();
    expect(screen.getByText('X/Twitter Sources')).toBeInTheDocument();
    expect(screen.getAllByText('Search Reddit').length).toBeGreaterThan(1);
    expect(screen.getByText('Command Preview')).toBeInTheDocument();
    expect(screen.getByText('Command Trace')).toBeInTheDocument();
  });
});
