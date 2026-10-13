'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookmarkCheck } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { isBrowserAuthenticated } from '@/lib/job-history';
import { cn } from '@/lib/utils';

export interface PrimaryAuthCtaProps {
  initialIsAuthenticated?: boolean;
  defaultLabel?: string;
  authenticatedLabel?: string;
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

export function PrimaryAuthCta({
  initialIsAuthenticated = false,
  defaultLabel = 'Explore WearMe',
  authenticatedLabel,
  size = 'lg',
  className,
}: PrimaryAuthCtaProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(initialIsAuthenticated);

  useEffect(() => {
    setIsAuthenticated(initialIsAuthenticated || isBrowserAuthenticated());
  }, [initialIsAuthenticated]);

  const targetHref = isAuthenticated ? '/my-wardrobe' : '/login';
  const displayLabel = isAuthenticated && authenticatedLabel ? authenticatedLabel : defaultLabel;

  return (
    <Link
      href={targetHref}
      data-auth-state={isAuthenticated ? 'authenticated' : 'anonymous'}
      className={cn(buttonVariants({ variant: 'default', size }), className)}
    >
      {isAuthenticated && authenticatedLabel ? (
        <BookmarkCheck className="h-4 w-4" />
      ) : null}
      <span>{displayLabel}</span>
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}
