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

  it('makes wrapper focusable (tabindex=0) only when the wrapped child is disabled', () => {
    render(
      <Tooltip label="Disabled because no API key">
        <button type="button" disabled>
          Send
        </button>
      </Tooltip>,
    );

    const tooltip = screen.getByRole('tooltip');
    const wrapper = tooltip.parentElement as HTMLElement;
    expect(wrapper.getAttribute('tabindex')).toBe('0');
  });

  it('omits tabindex on the wrapper when the wrapped child is enabled', () => {
    render(
      <Tooltip label="Hint">
        <button type="button">Send</button>
      </Tooltip>,
    );

    const tooltip = screen.getByRole('tooltip');
    const wrapper = tooltip.parentElement as HTMLElement;
    expect(wrapper.getAttribute('tabindex')).toBeNull();
  });

  it('tab lands on inner button when enabled, on wrapper when disabled', async () => {
    const user = userEvent.setup();

    const enabled = render(
      <>
        <button type="button">Before</button>
        <Tooltip label="Hint">
          <button type="button">Send</button>
        </Tooltip>
      </>,
    );
    enabled.getByRole('button', { name: 'Before' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(enabled.getByRole('button', { name: 'Send' }));
    enabled.unmount();

    const disabled = render(
      <>
        <button type="button">Before</button>
        <Tooltip label="Disabled because no API key">
          <button type="button" disabled>
            Send
          </button>
        </Tooltip>
      </>,
    );
    const tooltip = disabled.getByRole('tooltip');
    const wrapper = tooltip.parentElement as HTMLElement;
    disabled.getByRole('button', { name: 'Before' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(wrapper);
  });

  it('wires aria-describedby on the wrapper to the tooltip text id', () => {
    render(
      <Tooltip label="Reason">
        <button type="button" disabled>
          Send
        </button>
      </Tooltip>,
    );

    const tooltip = screen.getByRole('tooltip');
    const wrapper = tooltip.parentElement as HTMLElement;
    const describedBy = wrapper.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(tooltip.id).toBe(describedBy);
  });

  it('reveals tooltip when wrapper receives focus and hides on blur', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before</button>
        <Tooltip label="Focus me">
          <button type="button" disabled>
            Send
          </button>
        </Tooltip>
        <button type="button">After</button>
      </>,
    );

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.className).toContain('group-focus-within:opacity-100');
    expect(tooltip.className).toContain('group-focus:opacity-100');

    screen.getByRole('button', { name: 'Before' }).focus();
    await user.tab();
    const wrapper = tooltip.parentElement as HTMLElement;
    expect(document.activeElement).toBe(wrapper);

    await user.tab();
    expect(document.activeElement).not.toBe(wrapper);
  });
});
