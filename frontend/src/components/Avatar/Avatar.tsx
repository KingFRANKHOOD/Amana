import React from 'react';
import Image from 'next/image';

// Size mappings
const sizeClasses = {
  xs: 'w-6 h-6',
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
  xl: 'w-16 h-16',
} as const;

// Badge sizes
const badgeSizeClasses = {
  xs: 'w-2.5 h-2.5',
  sm: 'w-3 h-3',
  md: 'w-3.5 h-3.5',
  lg: 'w-4 h-4',
  xl: 'w-5 h-5',
} as const;

// Text sizes for fallback
const textSizeClasses = {
  xs: 'text-[10px]',
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
  xl: 'text-lg',
} as const;

export interface AvatarProps {
  src?: string;
  alt: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  fallback?: string;
  verified?: boolean;
  online?: boolean;
}

const Avatar: React.FC<AvatarProps> = ({
  src,
  alt,
  size = 'md',
  fallback,
  verified = false,
  online = false,
}) => {
  const sizeClass = sizeClasses[size];
  const badgeSizeClass = badgeSizeClasses[size];
  const textSizeClass = textSizeClasses[size];

  return (
    <div
      className={`relative inline-flex shrink-0 rounded-full overflow-hidden border border-border-default ${sizeClass}`}
    >
      {/* Image */}
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 40px"
        />
      ) : (
        /* Fallback */
        <div
          className={`w-full h-full bg-elevated text-text-secondary flex items-center justify-center font-medium ${textSizeClass}`}
          role="img"
          aria-label={alt}
          title={alt}
        >
          {fallback ?? alt.slice(0, 2).toUpperCase()}
        </div>
      )}

      {/* Verified badge */}
      {verified && (
        <div
          className={`absolute bottom-0 right-0 translate-x-1/4 translate-y-1/4 rounded-full bg-bg-primary border border-bg-primary flex items-center justify-center ${badgeSizeClass}`}
          aria-label="Verified"
          title="Verified"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full p-[2px]"
          >
            <path
              d="M13.3334 4L6.00002 11.3333L2.66669 8"
              stroke="rgb(16 185 129)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}

      {/* Online indicator */}
      {online && (
        <div
          className={`absolute bottom-0 left-0 translate-x-[-25%] translate-y-[25%] rounded-full bg-emerald border-2 border-bg-primary ${badgeSizeClass}`}
          aria-label="Online"
          title="Online"
        />
      )}
    </div>
  );
};

export default Avatar;
