import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Lumen Dashboard',
  description: 'Manage your dynamic cost-aware Lumen AI gateway workspaces, keys, and credentials.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body className="font-sans min-h-screen text-slate-100">
        {children}
      </body>
    </html>
  );
}
