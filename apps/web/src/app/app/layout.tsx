import type { ReactNode } from 'react';
import { WebShell } from '../../components/web-shell';

export default function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <WebShell>{children}</WebShell>;
}
