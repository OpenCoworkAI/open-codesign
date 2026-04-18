import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('renders children alone when label is undefined', () => {
    const { container } = render(
      <Tooltip label={undefined}>
        <button type="button">Send</button>
      </Tooltip>,
    );

    expect(screen.getByRole('button', { name: 'Send' })).toBeDefined();
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(container.querySelector('span.relative')).toBeNull();
  });

  it('renders children alone when label is empty string', () => {
    render(
      <Tooltip label="">
        <button type="button">Send</button>
      </Tooltip>,
    );

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('wraps children with tooltip element when label is provided', () => {
    render(
      <Tooltip label="Disabled because no API key">
        <button type="button" disabled>
          Send
        </button>
      </Tooltip>,
    );

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe('Disabled because no API key');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDefined();
  });

  it('reveals tooltip on hover via group-hover class', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Hover me">
        <button type="button">Send</button>
      </Tooltip>,
    );

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.className).toContain('opacity-0');
    expect(tooltip.className).toContain('group-hover:opacity-100');

    await user.hover(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('tooltip')).toBeDefined();
  });

  it('applies side="top" positioning classes', () => {
    render(
      <Tooltip label="Top tip" side="top">
        <button type="button">Send</button>
      </Tooltip>,
    );

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.className).toContain('bottom-full');
  });

  it('defaults to side="bottom" positioning classes', () => {
    render(
      <Tooltip label="Bottom tip">
        <button type="button">Send</button>
      </Tooltip>,
    );

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.className).toContain('top-full');
  });
});
