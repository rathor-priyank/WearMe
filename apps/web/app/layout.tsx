import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'WearMe — See yourself in any outfit',
  description:
    'AI-powered virtual try-on. Upload your photo and see how any outfit looks on you before buying.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen bg-neutral-950 text-neutral-50 antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

