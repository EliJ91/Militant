import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('opens the dashboard from the landing button', () => {
    const { container } = render(<App />);

    expect(screen.queryByText('Member Access')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /enter|login/i }));

    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect(window.location.hash).toBe('#dashboard');
    expect(screen.getByText('Review kept, lost, resolved, and donated loot from CTA logs.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open tool/i })).not.toBeInTheDocument();
    expect(screen.getByText('Under Construction')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pending' })).toBeInTheDocument();
    expect(screen.getByText('Make a suggestion!')).toBeInTheDocument();
    expect(container.querySelectorAll('.topbar .navigation-button')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /loot monitor/i }));

    expect(screen.getByRole('heading', { name: /loot monitor/i })).toBeInTheDocument();
    expect(window.location.hash).toBe('#loot-monitor');
  });
});
