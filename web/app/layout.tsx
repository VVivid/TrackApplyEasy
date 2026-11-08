import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'TrackApplyEasy',
  description: 'Your applications, exact CV versions, and response history.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
