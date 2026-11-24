'use client';

import { Suspense, type ReactNode } from 'react';

// Keeps a stable layout slot so route changes don't flash a blank document.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}