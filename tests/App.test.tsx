import { render, screen } from '@testing-library/react';
import { App } from '../src/App';

describe('App scaffold', () => {
  it('renders the workbench name during bootstrap', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Reddix' })).toBeInTheDocument();
  });
});

