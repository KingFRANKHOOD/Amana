'use client';

import { generateBreadcrumbs } from '../lib/breadcrumbs';
import Link from 'next/link';
import { ChevronRight, Bell, User } from 'lucide-react';
import { usePathname } from 'next/navigation';

interface TopAppBarProps {
  title: string;
  networkStatus?: 'mainnet' | 'testnet';
}

export function TopNav({ title, networkStatus }: TopAppBarProps) {
  const pathname = usePathname();
  const breadcrumbs = generateBreadcrumbs(pathname);
  return (
    <header className="sticky top-0 z-40 h-14 sm:h-16 w-full max-w-7xl mx-auto bg-card/80 backdrop-blur-md border-b border-border-default flex items-center px-3 sm:px-6 gap-2 sm:gap-4">
      <div className="flex-shrink-0">
        <Link
          href="/"
          className="flex items-center focus:outline-none px-1 sm:px-2 py-1"
          aria-label="Amana home page"
        >
          <span className="font-manrope font-bold text-base sm:text-lg md:text-[24px] leading-[28px] sm:leading-[32px] md:leading-[32px] tracking-[-0.5px] sm:tracking-[-1px] md:tracking-[-1.2px] text-[#F2C36B]">
            {title}
          </span>
        </Link>
      </div>
      <div className="hidden md:flex items-center flex-1">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center space-x-1 lg:space-x-2">
              {breadcrumbs.map((crumb, index) => (
                <li key={index} className="flex items-center">
                  {index > 0 && <ChevronRight className="w-3 h-3 lg:w-4 lg:h-4 text-gray-500 mx-1 lg:mx-2" />}
                  {crumb.path ? (
                    <Link href={crumb.path} className="text-xs lg:text-sm hover:text-foreground">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-xs lg:text-sm text-muted-foreground text-[#F2C36B]">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2 sm:gap-3 lg:gap-4">
        <button className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-full transition-colors">
          <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-foreground hover:text-[#F2C36B]" />
        </button>
        <div className="hidden sm:block">
          {networkStatus && (
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
              networkStatus === 'mainnet' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
            }`}>
              {networkStatus}
            </span>
          )}
        </div>
        <button className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-full transition-colors">
          <User className="w-4 h-4 sm:w-5 sm:h-5 text-foreground hover:text-[#F2C36B]" />
        </button>
      </div>
    </header>
  );
}