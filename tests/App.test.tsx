import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/App';

describe('App scaffold', () => {
  it('renders the canvas workbench shell', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Reddix' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run flow/i })).toBeInTheDocument();
    expect(screen.getByText('Reddit')).toBeInTheDocument();
    expect(screen.getByText('X / Twitter')).toBeInTheDocument();
    // Sample flow has a Reddit search block (palette chip + node card + inspector header).
    expect(screen.getAllByText('Search Reddit').length).toBeGreaterThan(1);
    expect(screen.getByText(/command preview/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Command Trace' })).toBeInTheDocument();
  });

  it('focuses the palette search on Cmd-K', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText('Search blocks'));
  });
});
