import React from 'react';
import { render, screen } from '@testing-library/react';
import Avatar from '../Avatar';

describe('Avatar Component - Smoke Tests', () => {
  it('renders without crashing with minimal props', () => {
    const { container } = render(<Avatar alt="Test User" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders with image when src is provided', () => {
    render(<Avatar src="/test-image.jpg" alt="Test User" />);
    const image = screen.getByAltText('Test User');
    expect(image).toBeInTheDocument();
  });

  it('renders fallback when src is not provided and fallback is given', () => {
    const { container } = render(<Avatar alt="Test User" fallback="TU" />);
    expect(container.textContent).toContain('TU');
  });

  it('defaults to md size when size prop is omitted', () => {
    const { container } = render(<Avatar alt="Test User" />);
    const avatarElement = container.firstChild as HTMLElement;
    expect(avatarElement).toHaveClass('w-10', 'h-10');
  });

  it('applies correct size classes for all size variants', () => {
    const sizes = [
      { size: 'xs' as const, classes: ['w-6', 'h-6'] },
      { size: 'sm' as const, classes: ['w-8', 'h-8'] },
      { size: 'md' as const, classes: ['w-10', 'h-10'] },
      { size: 'lg' as const, classes: ['w-12', 'h-12'] },
      { size: 'xl' as const, classes: ['w-16', 'h-16'] },
    ];

    sizes.forEach(({ size, classes }) => {
      const { container } = render(<Avatar alt="Test" size={size} />);
      const avatarElement = container.firstChild as HTMLElement;
      classes.forEach(className => {
        expect(avatarElement).toHaveClass(className);
      });
    });
  });

  it('shows verification badge when verified is true', () => {
    render(<Avatar alt="Test User" verified={true} />);
    const badge = screen.getByLabelText('Verified');
    expect(badge).toBeInTheDocument();
  });

  it('shows presence indicator when online is true and verified is false', () => {
    render(<Avatar alt="Test User" online={true} />);
    const indicator = screen.getByLabelText('Online');
    expect(indicator).toBeInTheDocument();
  });

  it('shows only verification badge when both verified and online are true', () => {
    render(<Avatar alt="Test User" verified={true} online={true} />);
    const verifiedBadge = screen.getByLabelText('Verified');
    expect(verifiedBadge).toBeInTheDocument();
    
    const onlineIndicator = screen.queryByLabelText('Online');
    expect(onlineIndicator).not.toBeInTheDocument();
  });

  it('applies base container styling classes', () => {
    const { container } = render(<Avatar alt="Test User" />);
    const avatarElement = container.firstChild as HTMLElement;
    expect(avatarElement).toHaveClass('rounded-full', 'overflow-hidden', 'border');
  });

  it('includes ARIA attributes for fallback display', () => {
    render(<Avatar alt="Test User" fallback="TU" />);
    const fallback = screen.getByRole('img', { name: 'Test User' });
    expect(fallback).toBeInTheDocument();
  });
});
