import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { toMinor } from '@fpc/shared';
import { ConfidenceBadge, Money, StatusBadge } from './ui';

/**
 * These render the figures a finance user acts on. A wrong amount or a
 * mislabelled status here is a decision made on bad information, so the
 * assertions are about meaning rather than markup.
 */
describe('Money', () => {
  it('renders paise as grouped rupees', () => {
    render(<Money minor={toMinor(3_540_000)} />);
    expect(screen.getByText(/35,40,000/)).toBeInTheDocument();
  });

  it('renders an em dash for a missing amount, never zero', () => {
    // Showing ₹0.00 for "not known" would read as a real figure.
    const { container } = render(<Money minor={null} />);
    expect(container.textContent).toBe('—');
    expect(container.textContent).not.toContain('0.00');
  });

  it('keeps the exact amount available when displaying a compact figure', () => {
    render(<Money minor={toMinor(6_20_00_000)} compact />);
    const element = screen.getByText(/Cr/);
    expect(element).toHaveTextContent('₹6.20 Cr');
    // The rounded display must not be the only source of truth on screen.
    expect(element).toHaveAttribute('title', expect.stringContaining('6,20,00,000'));
  });
});

describe('StatusBadge', () => {
  it('turns a stored status into a readable label', () => {
    render(<StatusBadge status="PAYMENT_PROCESSING" />);
    expect(screen.getByText('Payment Processing')).toBeInTheDocument();
  });

  it('distinguishes settled, blocked and in-flight states by tone', () => {
    // Asserted on the tone rather than on a colour class: the meaning is the
    // contract, the palette expressing it is a styling detail a restyle may
    // change.
    const tone = (status: string) => {
      const { container } = render(<StatusBadge status={status} />);
      return container.querySelector('span')!.getAttribute('data-tone');
    };

    expect(tone('PAID')).toBe('positive');
    expect(tone('REJECTED')).toBe('negative');
    expect(tone('PENDING_APPROVAL')).toBe('attention');
  });

  it('renders the pill as a single element, so its tone is unambiguous', () => {
    // The tone lives on the outermost span; nesting another one inside would
    // silently change what a reader — or a test — picks up first.
    const { container } = render(<StatusBadge status="PAID" />);
    expect(container.querySelectorAll('span')).toHaveLength(1);
  });

  it('renders an em dash for an absent status, consistent with Money', () => {
    const { container } = render(<StatusBadge status={undefined} />);
    expect(container.textContent).toBe('—');
  });
});

describe('ConfidenceBadge', () => {
  it('accepts both a 0-1 fraction and a 0-100 score', () => {
    // Extraction reports fractions; the match engine reports whole numbers.
    render(<ConfidenceBadge value={0.94} />);
    expect(screen.getByText('94%')).toBeInTheDocument();

    render(<ConfidenceBadge value={94} />);
    expect(screen.getAllByText('94%')).toHaveLength(2);
  });

  it('tones a weak match differently from a strong one', () => {
    const tone = (value: number) => {
      const { container } = render(<ConfidenceBadge value={value} />);
      return container.querySelector('span')!.getAttribute('data-tone');
    };

    expect(tone(0.95)).toBe('positive');
    expect(tone(0.8)).toBe('attention');
    expect(tone(0.4)).toBe('negative');
  });
});
