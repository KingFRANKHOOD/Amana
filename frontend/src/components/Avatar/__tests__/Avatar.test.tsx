import React from 'react';
import { render, screen } from '@testing-library/react';
import Avatar from '../Avatar';

// Mock next/image
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    /* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */
    <img {...props} />
  ),
}));

describe('Avatar Component', () => {
  const defaultProps = {
    alt: 'Test User',
  };

  it('renders without crashing with minimal props', () => {
    const { container } = render(<Avatar {...defaultProps} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders image when src is provided', () => {
    render(<Avatar {...defaultProps} src="/test-image.jpg" />);
    const image = screen.getByAltText('Test User');
    expect(image).toBeInTheDocument();
  });

  it('renders fallback when src is not provided', () => {
    render(<Avatar {...defaultProps} />);
    const fallback = screen.getByRole('img', { name: 'Test User' });
    expect(fallback).toBeInTheDocument();
  });

  it('displays fallback initials from alt text', () => {
    render(<Avatar {...defaultProps} alt="John Doe" />);
    const fallback = screen.getByRole('img', { name: 'John Doe' });
    expect(fallback).toHaveTextContent('JO');
  });

  it('displays custom fallback when provided', () => {
    render(<Avatar {...defaultProps} fallback="TU" />);
    const fallback = screen.getByRole('img', { name: 'Test User' });
    expect(fallback).toHaveTextContent('TU');
  });

  it('applies correct size classes for xs size', () => {
    const { container } = render(<Avatar {...defaultProps} size="xs" />);
    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('w-6', 'h-6');
  });

  it('applies correct size classes for sm size', () => {
    const { container } = render(<Avatar {...defaultProps} size="sm" />);
    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('w-8', 'h-8');
  });

  it('applies correct size classes for md size (default)', () => {
    const { container } = render(<Avatar {...defaultProps} />);
    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('w-10', 'h-10');
  });

  it('applies correct size classes for lg size', () => {
    const { container } = render(<Avatar {...defaultProps} size="lg" />);
    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('w-12', 'h-12');
  });

  it('applies correct size classes for xl size', () => {
    const { container } = render(<Avatar {...defaultProps} size="xl" />);
    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('w-16', 'h-16');
  });

  it('shows verified badge when verified is true', () => {
    render(<Avatar {...defaultProps} verified={true} />);
    const badge = screen.getByLabelText('Verified');
    expect(badge).toBeInTheDocument();
  });

  it('does not show verified badge when verified is false', () => {
    render(<Avatar {...defaultProps} verified={false} />);
    const badge = screen.queryByLabelText('Verified');
    expect(badge).not.toBeInTheDocument();
  });

  it('shows online indicator when online is true and verified is false', () => {
    render(<Avatar {...defaultProps} online={true} />);
    const indicator = screen.getByLabelText('Online');
    expect(indicator).toBeInTheDocument();
  });

  it('does not show online indicator when online is false', () => {
    render(<Avatar {...defaultProps} online={false} />);
    const indicator = screen.queryByLabelText('Online');
    expect(indicator).not.toBeInTheDocument();
  });

  it('shows only verified badge when both verified and online are true', () => {
    render(<Avatar {...defaultProps} verified={true} online={true} />);
    const verifiedBadge = screen.getByLabelText('Verified');
    expect(verifiedBadge).toBeInTheDocument();

    const onlineIndicator = screen.queryByLabelText('Online');
    expect(onlineIndicator).not.toBeInTheDocument();
  });

  it('applies base container styling classes', () => {
    const { container } = render(<Avatar {...defaultProps} />);
    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass(
      'relative',
      'inline-flex',
      'shrink-0',
      'rounded-full',
      'overflow-hidden',
      'border',
      'border-border-default'
    );
  });

  it('applies correct text size for xs size', () => {
    const { container } = render(<Avatar {...defaultProps} size="xs" />);
    const fallback = container.querySelector('.text-\\[10px\\]');
    expect(fallback).toBeInTheDocument();
  });

  it('applies correct text size for sm size', () => {
    const { container } = render(<Avatar {...defaultProps} size="sm" />);
    const fallback = container.querySelector('.text-xs');
    expect(fallback).toBeInTheDocument();
  });

  it('applies correct text size for md size', () => {
    const { container } = render(<Avatar {...defaultProps} size="md" />);
    const fallback = container.querySelector('.text-sm');
    expect(fallback).toBeInTheDocument();
  });

  it('applies correct text size for lg size', () => {
    const { container } = render(<Avatar {...defaultProps} size="lg" />);
    const fallback = container.querySelector('.text-base');
    expect(fallback).toBeInTheDocument();
  });

  it('applies correct text size for xl size', () => {
    const { container } = render(<Avatar {...defaultProps} size="xl" />);
    const fallback = container.querySelector('.text-lg');
    expect(fallback).toBeInTheDocument();
  });

  it('applies correct badge size for xs size', () => {
    const { container } = render(<Avatar {...defaultProps} size="xs" verified={true} />);
    const badge = container.querySelector('.w-2\\.5.h-2\\.5');
    expect(badge).toBeInTheDocument();
  });

  it('applies correct badge size for sm size', () => {
    const { container } = render(<Avatar {...defaultProps} size="sm" verified={true} />);
    const badge = container.querySelector('.w-3.h-3');
    expect(badge).toBeInTheDocument();
  });

  it('applies correct badge size for md size', () => {
    const { container } = render(<Avatar {...defaultProps} size="md" verified={true} />);
    const badge = container.querySelector('.w-3\\.5.h-3\\.5');
    expect(badge).toBeInTheDocument();
  });

  it('applies correct badge size for lg size', () => {
    const { container } = render(<Avatar {...defaultProps} size="lg" verified={true} />);
    const badge = container.querySelector('.w-4.h-4');
    expect(badge).toBeInTheDocument();
  });

  it('applies correct badge size for xl size', () => {
    const { container } = render(<Avatar {...defaultProps} size="xl" verified={true} />);
    const badge = container.querySelector('.w-5.h-5');
    expect(badge).toBeInTheDocument();
  });

  it('renders verified badge with checkmark icon', () => {
    const { container } = render(<Avatar {...defaultProps} verified={true} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders online indicator with emerald color', () => {
    const { container } = render(<Avatar {...defaultProps} online={true} />);
    const indicator = container.querySelector('.bg-emerald');
    expect(indicator).toBeInTheDocument();
  });

  it('handles different alt text values', () => {
    render(<Avatar alt="Jane Smith" />);
    const fallback = screen.getByRole('img', { name: 'Jane Smith' });
    expect(fallback).toHaveTextContent('JA');
  });

  it('handles single word alt text', () => {
    render(<Avatar alt="John" />);
    const fallback = screen.getByRole('img', { name: 'John' });
    expect(fallback).toHaveTextContent('JO');
  });

  it('handles empty alt text', () => {
    render(<Avatar alt="" />);
    const fallback = screen.getByRole('img', { name: '' });
    expect(fallback).toBeInTheDocument();
  });

  it('renders image with correct src', () => {
    render(<Avatar {...defaultProps} src="/avatar.png" />);
    const image = screen.getByAltText('Test User');
    expect(image).toHaveAttribute('src', '/avatar.png');
  });

  it('renders image with object-cover class', () => {
    render(<Avatar {...defaultProps} src="/avatar.png" />);
    const image = screen.getByAltText('Test User');
    expect(image).toHaveClass('object-cover');
  });

  it('renders fallback with correct background color', () => {
    const { container } = render(<Avatar {...defaultProps} />);
    const fallback = container.querySelector('.bg-elevated');
    expect(fallback).toBeInTheDocument();
  });

  it('renders fallback with correct text color', () => {
    const { container } = render(<Avatar {...defaultProps} />);
    const fallback = container.querySelector('.text-text-secondary');
    expect(fallback).toBeInTheDocument();
  });

  it('renders fallback with correct font weight', () => {
    const { container } = render(<Avatar {...defaultProps} />);
    const fallback = container.querySelector('.font-medium');
    expect(fallback).toBeInTheDocument();
  });

  it('renders fallback with correct alignment', () => {
    const { container } = render(<Avatar {...defaultProps} />);
    const fallback = container.querySelector('.flex.items-center.justify-center');
    expect(fallback).toBeInTheDocument();
  });

  it('renders verified badge with correct positioning', () => {
    const { container } = render(<Avatar {...defaultProps} verified={true} />);
    const badge = container.querySelector('.absolute.bottom-0.right-0');
    expect(badge).toBeInTheDocument();
  });

  it('renders online indicator with correct positioning', () => {
    const { container } = render(<Avatar {...defaultProps} online={true} />);
    const indicator = container.querySelector('.absolute.bottom-0.left-0');
    expect(indicator).toBeInTheDocument();
  });

  it('renders verified badge with border', () => {
    const { container } = render(<Avatar {...defaultProps} verified={true} />);
    const badge = container.querySelector('.border-2.border-bg-primary');
    expect(badge).toBeInTheDocument();
  });

  it('renders online indicator with border', () => {
    const { container } = render(<Avatar {...defaultProps} online={true} />);
    const indicator = container.querySelector('.border-2.border-bg-primary');
    expect(indicator).toBeInTheDocument();
  });
});
