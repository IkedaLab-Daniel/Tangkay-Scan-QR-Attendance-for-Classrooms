import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TangkayScan',
  description: 'QR Attendance for Classrooms',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
