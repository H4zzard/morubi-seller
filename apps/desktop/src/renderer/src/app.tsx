import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ContactRound,
  CircleHelp,
  Headphones,
  Home,
  LogOut,
  MessageSquareText,
  PhoneCall,
  Settings,
  Sparkles,
  Target
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { NavigationItemKey } from '@morubi/permissions';
import { desktopNavigationForRole } from '@morubi/permissions';
import type { SessionDto } from '@morubi/contracts';
import { Button, MorubiMark, PagePlaceholder } from '@morubi/ui';
import { ContactsView, ConversationsView, DealsView } from './commercial-views';
import { LiveCallsView } from './live-calls-view';
import { HelpCenter } from './help-center';
import { Onboarding } from './onboarding';

type WorkspaceView = NavigationItemKey | 'help';

function onboardingStorageKey(userId: string): string {
  return `morubi:onboarding:v1:${userId}`;
}

const navigation = {
  home: { label: 'Home', icon: Home },
  agenda: { label: 'Agenda', icon: CalendarDays },
  conversations: { label: 'Conversas', icon: MessageSquareText },
  opportunities: { label: 'Oportunidades', icon: Target },
  contacts: { label: 'Contatos', icon: ContactRound },
  calls: { label: 'Calls', icon: PhoneCall },
  coach: { label: 'Coach', icon: Headphones },
  analytics: { label: 'Análises', icon: BarChart3 },
  playbook: { label: 'Playbook', icon: BookOpen },
  settings: { label: 'Configurações', icon: Settings }
} satisfies Record<NavigationItemKey, { label: string; icon: typeof Home }>;

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

function Login({ onAuthenticated }: { onAuthenticated: (session: SessionDto) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const session = await window.morubi.auth.signIn({
        email: formString(data, 'email'),
        password: formString(data, 'password')
      });
      onAuthenticated(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível entrar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="desktop-login">
      <section className="desktop-login__story">
        <MorubiMark />
        <div>
          <span className="morubi-eyebrow">Seller workspace</span>
          <h1>Seu contexto comercial, sempre por perto.</h1>
          <p>Aplicativo desktop seguro, preparado para acompanhar o fluxo real de venda.</p>
        </div>
        <small>Desktop foundation · nenhuma captura ativa</small>
      </section>
      <section className="desktop-login__panel">
        <form className="desktop-login__card" onSubmit={(event) => void submit(event)}>
          <Sparkles color="var(--primary)" size={22} />
          <h2>Entrar no Morubi</h2>
          <p>A sessão é protegida pelo armazenamento seguro do sistema operacional.</p>
          <label className="desktop-field">
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label className="desktop-field">
            Senha
            <input
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="current-password"
            />
          </label>
          {error ? <div className="desktop-error">{error}</div> : null}
          <Button disabled={pending}>{pending ? 'Conectando…' : 'Entrar'}</Button>
        </form>
      </section>
    </main>
  );
}

function Workspace({
  initialSession,
  onLogout,
  onSessionChange,
  onRerunOnboarding
}: {
  initialSession: SessionDto;
  onLogout: () => void;
  onSessionChange: (session: SessionDto) => void;
  onRerunOnboarding: () => void;
}) {
  const [session, setSession] = useState(initialSession);
  const [active, setActive] = useState<WorkspaceView>('home');
  const items = useMemo(
    () => (session.tenant ? desktopNavigationForRole(session.tenant.role) : []),
    [session.tenant]
  );

  if (!session.tenant) {
    return (
      <main className="tenant-picker">
        <MorubiMark />
        <h1>Escolha uma organização</h1>
        <p>Seu acesso foi autenticado, mas o workspace precisa de um contexto autorizado.</p>
        <div className="tenant-picker__list">
          {session.organizations?.map((choice) => (
            <Button
              key={choice.organization.id}
              variant="secondary"
              onClick={() =>
                void window.morubi.auth.setOrganization(choice.organization.id).then((updated) => {
                  setSession(updated);
                  onSessionChange(updated);
                })
              }
            >
              {choice.organization.name} · {choice.membership.role}
            </Button>
          ))}
        </div>
        {session.organizations?.length === 0 ? (
          <p>Peça um convite ou conclua o onboarding na aplicação web.</p>
        ) : null}
      </main>
    );
  }

  const current = active === 'help' ? null : navigation[active];
  const content =
    active === 'help' ? (
      <HelpCenter onRerunOnboarding={onRerunOnboarding} />
    ) : active === 'conversations' ? (
      <ConversationsView />
    ) : active === 'opportunities' ? (
      <DealsView />
    ) : active === 'contacts' ? (
      <ContactsView />
    ) : active === 'calls' ? (
      <LiveCallsView />
    ) : (
      <PagePlaceholder
        eyebrow="Desktop-first"
        title={current?.label ?? ''}
        description={`O shell de ${current?.label ?? ''} está pronto para receber seu próximo vertical slice sem levar regras de negócio para o Electron.`}
      />
    );
  return (
    <div className="desktop-shell">
      <aside className="desktop-sidebar">
        <div className="desktop-sidebar__brand">
          <MorubiMark />
          <span>SELLER DESKTOP</span>
        </div>
        <nav>
          {items.map((key) => {
            const item = navigation[key];
            const Icon = item.icon;
            const section = key === 'analytics' ? 'GESTÃO' : key === 'playbook' ? 'SISTEMA' : null;
            return (
              <div key={key}>
                {section ? <div className="desktop-sidebar__section">{section}</div> : null}
                <button className={active === key ? 'active' : ''} onClick={() => setActive(key)}>
                  <Icon size={17} />
                  {item.label}
                </button>
              </div>
            );
          })}
        </nav>
        <div className="desktop-sidebar__user">
          <div>
            <strong>{session.user.name}</strong>
            <span>{session.tenant.role}</span>
          </div>
          <button aria-label="Sair" onClick={onLogout}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="desktop-main">
        <header>
          <span>Workspace do vendedor</span>
          <div className="desktop-header__actions">
            <button className={active === 'help' ? 'active' : ''} onClick={() => setActive('help')}>
              <CircleHelp size={15} /> Ajuda
            </button>
            <span className="desktop-online">
              <i /> API conectada
            </span>
          </div>
        </header>
        <div className="desktop-content">{content}</div>
      </main>
    </div>
  );
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionDto | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  function acceptSession(nextSession: SessionDto | null): void {
    setSession(nextSession);
    setShowOnboarding(
      Boolean(
        nextSession?.tenant && !localStorage.getItem(onboardingStorageKey(nextSession.user.id))
      )
    );
  }

  useEffect(() => {
    void window.morubi.auth
      .getSession()
      .then(acceptSession)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void window.morubi.liveCalls.setBackgroundObservation(Boolean(session));
  }, [session]);

  if (loading)
    return (
      <div className="desktop-loading">
        <MorubiMark />
        <span>Preparando workspace…</span>
      </div>
    );
  if (!session) return <Login onAuthenticated={acceptSession} />;
  if (session.tenant && showOnboarding)
    return (
      <Onboarding
        userName={session.user.name}
        onFinish={(ready) => {
          localStorage.setItem(
            onboardingStorageKey(session.user.id),
            JSON.stringify({ completedAt: new Date().toISOString(), ready })
          );
          setShowOnboarding(false);
        }}
      />
    );
  return (
    <Workspace
      initialSession={session}
      onSessionChange={acceptSession}
      onRerunOnboarding={() => setShowOnboarding(true)}
      onLogout={() => void window.morubi.auth.signOut().then(() => acceptSession(null))}
    />
  );
}
