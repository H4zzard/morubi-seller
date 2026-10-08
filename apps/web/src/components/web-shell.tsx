'use client';

import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  ContactRound,
  LogOut,
  Menu,
  Settings,
  UsersRound,
  Video
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OrganizationChoiceDto, Role, SessionDto } from '@morubi/contracts';
import { MorubiMark } from '@morubi/ui';
import { authClient } from '../lib/auth-client';
import {
  apiClient,
  clearActiveOrganizationId,
  getActiveOrganizationId,
  setActiveOrganizationId
} from '../lib/api';
import { webEnv } from '../lib/env';

interface WebNavigationItem {
  href: string;
  label: string;
  icon: typeof BarChart3;
  roles: readonly Role[];
}

const items: readonly WebNavigationItem[] = [
  {
    href: '/app',
    label: 'Visão geral',
    icon: BriefcaseBusiness,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'SELLER']
  },
  {
    href: '/app/analytics',
    label: 'Análises',
    icon: BarChart3,
    roles: ['OWNER', 'ADMIN', 'MANAGER']
  },
  { href: '/app/calls', label: 'Calls', icon: Video, roles: ['OWNER', 'ADMIN', 'MANAGER'] },
  {
    href: '/app/opportunities',
    label: 'Oportunidades',
    icon: BriefcaseBusiness,
    roles: ['OWNER', 'ADMIN', 'MANAGER']
  },
  {
    href: '/app/contacts',
    label: 'Contatos',
    icon: ContactRound,
    roles: ['OWNER', 'ADMIN', 'MANAGER']
  },
  { href: '/app/playbook', label: 'Playbook', icon: BookOpen, roles: ['OWNER', 'ADMIN'] },
  { href: '/app/members', label: 'Membros', icon: UsersRound, roles: ['OWNER', 'ADMIN'] },
  ...(webEnv.NEXT_PUBLIC_INTELLIGENCE_DEV_UI
    ? [
        {
          href: '/app/dev/intelligence',
          label: 'Intelligence (dev)',
          icon: BarChart3,
          roles: ['OWNER', 'ADMIN'] as const
        },
        {
          href: '/app/dev/conversations',
          label: 'Copilot lab (dev)',
          icon: BarChart3,
          roles: ['OWNER', 'ADMIN'] as const
        }
      ]
    : []),
  { href: '/app/settings', label: 'Configurações', icon: Settings, roles: ['OWNER', 'ADMIN'] }
] as const;

export function WebShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: authSession, isPending } = authClient.useSession();
  const [choices, setChoices] = useState<OrganizationChoiceDto[]>([]);
  const [session, setSession] = useState<SessionDto | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isPending) return;
    if (!authSession) {
      router.replace('/login');
      return;
    }
    void (async () => {
      const available = await apiClient.request<OrganizationChoiceDto[]>('/v1/organizations');
      if (available.length === 0) {
        router.replace('/onboarding');
        return;
      }
      let active = getActiveOrganizationId();
      if (!active || !available.some((choice) => choice.organization.id === active)) {
        active = available[0]?.organization.id ?? null;
        if (active) setActiveOrganizationId(active);
      }
      setChoices(available);
      const current = await apiClient.request<SessionDto>('/v1/me');
      await apiClient.request<void>('/v1/auth/session/audit', { method: 'POST' });
      if (
        pathname.startsWith('/app/dev/') &&
        (!webEnv.NEXT_PUBLIC_INTELLIGENCE_DEV_UI ||
          !current.tenant ||
          !['OWNER', 'ADMIN'].includes(current.tenant.role))
      ) {
        router.replace('/app');
        return;
      }
      setSession(current);
    })().catch(() => router.replace('/login'));
  }, [authSession, isPending, pathname, router]);

  const visibleItems = useMemo(
    () => items.filter((item) => session?.tenant && item.roles.includes(session.tenant.role)),
    [session]
  );

  if (isPending || !session?.tenant)
    return <div className="shell-loading">Carregando workspace…</div>;

  return (
    <div className="web-shell">
      <aside className={`sidebar ${open ? 'sidebar--open' : ''}`}>
        <div className="sidebar__head">
          <MorubiMark />
          <select
            aria-label="Organização ativa"
            className="org-switcher"
            value={session.tenant.organizationId}
            onChange={(event) => {
              setActiveOrganizationId(event.target.value);
              window.location.reload();
            }}
          >
            {choices.map((choice) => (
              <option key={choice.organization.id} value={choice.organization.id}>
                {choice.organization.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sidebar__label">Workspace</div>
        <nav className="sidebar__nav">
          {visibleItems.map(({ href, label, icon: Icon }) => {
            const active = href === '/app' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                className={`sidebar__item ${active ? 'sidebar__item--active' : ''}`}
                href={href}
                key={href}
                onClick={() => setOpen(false)}
              >
                <Icon size={17} aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar__footer">
          <strong style={{ color: 'var(--text)' }}>{session.user.name}</strong>
          <div>{session.user.email}</div>
          <button
            type="button"
            aria-label="Sair"
            onClick={() => {
              void (async () => {
                await authClient.signOut();
                clearActiveOrganizationId();
                window.location.replace('/login');
              })();
            }}
          >
            <LogOut size={16} aria-hidden />
            Sair
          </button>
        </div>
      </aside>
      <div className="shell-main">
        <header className="shell-topbar">
          <button
            className="mobile-menu"
            onClick={() => setOpen((value) => !value)}
            aria-label="Abrir menu"
          >
            <Menu size={18} />
          </button>
          <strong>Inteligência comercial</strong>
          <span className="role-pill">{session.tenant.role}</span>
        </header>
        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
