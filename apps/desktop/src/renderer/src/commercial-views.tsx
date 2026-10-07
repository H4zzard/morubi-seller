import { Check, Copy, Search, Sparkles, ThumbsDown, ThumbsUp, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
  ContactDetailDto,
  ContactSummaryDto,
  ConversationContextDto,
  ConversationMessagesDto,
  ConversationSummaryDto,
  DealDetailDto,
  DealSummaryDto,
  MessageDto
} from '@morubi/contracts';

function AudioMessage({ message }: { message: MessageDto }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source]
  );
  async function load() {
    try {
      const result = await window.morubi.commercial.getMessageAudio(message.id);
      const raw = atob(result.dataBase64);
      const bytes = Uint8Array.from(raw, (value) => value.charCodeAt(0));
      setSource(URL.createObjectURL(new Blob([bytes], { type: result.mimeType })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Audio indisponivel.');
    }
  }
  if (message.deletedAt) return <p>Mensagem removida na fonte</p>;
  if (message.audio?.transcriptStatus === 'FAILED')
    return <p>Não foi possível transcrever este áudio.</p>;
  const seconds = Math.round((message.audio?.durationMs ?? 0) / 1000);
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="audio-message">
      {source ? (
        <audio controls preload="metadata" src={source} />
      ) : (
        <button onClick={() => void load()}>Reproduzir audio</button>
      )}
      <span>
        {duration} / {message.audio?.transcriptStatus ?? 'PENDING'}
      </span>
      {message.audio?.transcript ? (
        <details>
          <summary>Ver transcricao</summary>
          <p>{message.audio.transcript}</p>
        </details>
      ) : null}
      {error ? <em>{error}</em> : null}
    </div>
  );
}

function dateLabel(value: string | null): string {
  if (!value) return 'Sem sincronização';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value)
  );
}

function money(value: string | null, currency: string | null): string {
  if (!value || !currency) return 'Valor não informado';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(
    Number(value) / 100
  );
}

function LoadingState() {
  return <div className="commercial-state">Carregando dados comerciais…</div>;
}

function ErrorState({ message }: { message: string }) {
  return <div className="commercial-state commercial-state--error">{message}</div>;
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="commercial-search">
      <Search size={15} />
      <input
        aria-label="Buscar"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Buscar…"
      />
    </label>
  );
}

export function ContactsView() {
  const [items, setItems] = useState<ContactSummaryDto[]>([]);
  const [selected, setSelected] = useState<ContactDetailDto | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setLoading(true);
      void window.morubi.commercial
        .listContacts(search || undefined)
        .then((page) => {
          setItems(page.items);
        })
        .catch((caught: unknown) =>
          setError(caught instanceof Error ? caught.message : 'Falha ao carregar contatos.')
        )
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (!selected && items[0]) {
      void window.morubi.commercial.getContact(items[0].id).then(setSelected);
    }
  }, [items, selected]);

  return (
    <section className="commercial-page">
      <div className="commercial-heading">
        <div>
          <span className="morubi-eyebrow">Contexto comercial</span>
          <h1>Contatos</h1>
        </div>
        <SearchBox value={search} onChange={setSearch} />
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : loading ? (
        <LoadingState />
      ) : (
        <div className="contact-layout">
          <div className="contact-grid">
            {items.map((contact) => (
              <button
                key={contact.id}
                className={`contact-card ${selected?.id === contact.id ? 'active' : ''}`}
                onClick={() =>
                  void window.morubi.commercial.getContact(contact.id).then(setSelected)
                }
              >
                <span className="avatar">
                  <UserRound size={18} />
                </span>
                <strong>{contact.name}</strong>
                <span>
                  {contact.jobTitle ?? 'Cargo não informado'}
                  {contact.companyName ? ` · ${contact.companyName}` : ''}
                </span>
                <small>{contact.email ?? contact.phone ?? 'Contato sem email ou telefone'}</small>
                <div>
                  <i className={`sync-dot sync-dot--${contact.syncStatus.toLowerCase()}`} />
                  {contact.primaryProvider ?? 'manual'} · {dateLabel(contact.lastSyncedAt)}
                </div>
              </button>
            ))}
          </div>
          <aside className="commercial-detail">
            {selected ? (
              <>
                <span className="morubi-eyebrow">Perfil canônico</span>
                <h2>{selected.name}</h2>
                <dl>
                  <dt>Email</dt>
                  <dd>{selected.email ?? 'Não informado'}</dd>
                  <dt>Telefone</dt>
                  <dd>{selected.phone ?? 'Não informado'}</dd>
                  <dt>Empresa</dt>
                  <dd>{selected.companyName ?? 'Não informada'}</dd>
                </dl>
                <h3>Oportunidades relacionadas</h3>
                {selected.deals.map((deal) => (
                  <div className="detail-row" key={deal.id}>
                    <strong>{deal.title}</strong>
                    <span>{deal.status}</span>
                  </div>
                ))}
                <h3>Origem</h3>
                {selected.externalIdentities.map((identity) => (
                  <div className="detail-row" key={`${identity.provider}-${identity.externalId}`}>
                    <strong>{identity.provider}</strong>
                    <span>{identity.externalId}</span>
                  </div>
                ))}
              </>
            ) : (
              <span>Selecione um contato.</span>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

export function DealsView() {
  const [items, setItems] = useState<DealSummaryDto[]>([]);
  const [selected, setSelected] = useState<DealDetailDto | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void window.morubi.commercial
        .listDeals(search || undefined)
        .then((page) => {
          setItems(page.items);
        })
        .catch((caught: unknown) =>
          setError(caught instanceof Error ? caught.message : 'Falha ao carregar oportunidades.')
        );
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (!selected && items[0]) {
      void window.morubi.commercial.getDeal(items[0].id).then(setSelected);
    }
  }, [items, selected]);

  return (
    <section className="commercial-page">
      <div className="commercial-heading">
        <div>
          <span className="morubi-eyebrow">Pipeline projetado</span>
          <h1>Oportunidades</h1>
        </div>
        <SearchBox value={search} onChange={setSearch} />
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : (
        <div className="deal-layout">
          <div className="deal-table">
            <div className="deal-table__head">
              <span>Oportunidade</span>
              <span>Etapa da fonte</span>
              <span>Valor</span>
              <span>Status</span>
            </div>
            {items.map((deal) => (
              <button
                key={deal.id}
                className={selected?.id === deal.id ? 'active' : ''}
                onClick={() => void window.morubi.commercial.getDeal(deal.id).then(setSelected)}
              >
                <span>
                  <strong>{deal.title}</strong>
                  <small>{deal.contactNames.join(', ') || 'Sem contato relacionado'}</small>
                </span>
                <span>{deal.providerStageLabel ?? 'Não mapeada'}</span>
                <span>{money(deal.amountMinor, deal.currency)}</span>
                <span className={`status-pill status-pill--${deal.status.toLowerCase()}`}>
                  {deal.status}
                </span>
              </button>
            ))}
          </div>
          <aside className="commercial-detail">
            {selected ? (
              <>
                <span className="morubi-eyebrow">Oportunidade</span>
                <h2>{selected.title}</h2>
                <strong className="deal-value">
                  {money(selected.amountMinor, selected.currency)}
                </strong>
                <dl>
                  <dt>Status canônico</dt>
                  <dd>{selected.status}</dd>
                  <dt>Etapa da fonte</dt>
                  <dd>{selected.providerStageLabel ?? 'Não informada'}</dd>
                  <dt>Responsável</dt>
                  <dd>{selected.ownerName ?? 'Não atribuído'}</dd>
                  <dt>Atualização</dt>
                  <dd>{dateLabel(selected.lastSyncedAt)}</dd>
                </dl>
                <h3>Contatos</h3>
                {selected.contacts.map((contact) => (
                  <div className="detail-row" key={contact.id}>
                    <strong>{contact.name}</strong>
                    <span>{contact.companyName}</span>
                  </div>
                ))}
              </>
            ) : (
              <span>Selecione uma oportunidade.</span>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

export function ConversationsView() {
  const [items, setItems] = useState<ConversationSummaryDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationMessagesDto | null>(null);
  const [context, setContext] = useState<ConversationContextDto | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadConversation = useCallback(async (conversationId: string) => {
    try {
      const [messages, nextContext] = await Promise.all([
        window.morubi.commercial.listMessages(conversationId),
        window.morubi.commercial.getConversationContext(conversationId)
      ]);
      setDetail(messages);
      await window.morubi.commercial.markConversationRead(conversationId);
      setItems((current) =>
        current.map((item) => (item.id === conversationId ? { ...item, unreadCount: 0 } : item))
      );
      if (nextContext.copilot.current?.status === 'DELIVERED') {
        nextContext.copilot.current = await window.morubi.interventions.viewed(
          nextContext.copilot.current.deliveryId
        );
      }
      setContext(nextContext);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar a conversa.');
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void window.morubi.commercial
        .listConversations(search || undefined)
        .then((page) => {
          setItems(page.items);
          const firstId = page.items[0]?.id ?? null;
          setSelectedId(firstId);
          if (firstId) void loadConversation(firstId);
        })
        .catch((caught: unknown) =>
          setError(caught instanceof Error ? caught.message : 'Falha ao carregar conversas.')
        );
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [loadConversation, search]);

  useEffect(
    () =>
      window.morubi.realtime.subscribe((event) => {
        if (event.conversationId === selectedId && selectedId) void loadConversation(selectedId);
        if (event.type === 'intervention.created') {
          setItems((current) =>
            current.map((item) =>
              item.id === event.conversationId ? { ...item, needsAttention: true } : item
            )
          );
        }
      }),
    [loadConversation, selectedId]
  );

  const currentCardExpiresAt = context?.copilot.current?.expiresAt;
  useEffect(() => {
    if (!currentCardExpiresAt || !selectedId) return;
    const delay = Math.max(0, new Date(currentCardExpiresAt).getTime() - Date.now()) + 50;
    const timeout = window.setTimeout(() => void loadConversation(selectedId), delay);
    return () => window.clearTimeout(timeout);
  }, [currentCardExpiresAt, loadConversation, selectedId]);

  async function updateCurrent(action: 'dismiss' | 'applied') {
    const card = context?.copilot.current;
    if (!card) return;
    const updated = await window.morubi.interventions[action](card.deliveryId);
    setContext((current) =>
      current
        ? {
            ...current,
            copilot: {
              ...current.copilot,
              state: 'IDLE',
              current: null,
              history: [updated, ...current.copilot.history]
            }
          }
        : current
    );
  }

  return (
    <section className="commercial-page commercial-page--conversation">
      <div className="commercial-heading">
        <div>
          <span className="morubi-eyebrow">Timeline canônica</span>
          <h1>Conversas</h1>
        </div>
        <SearchBox value={search} onChange={setSearch} />
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : (
        <div className="conversation-layout">
          <div className="conversation-list">
            {items.map((conversation) => (
              <button
                key={conversation.id}
                className={selectedId === conversation.id ? 'active' : ''}
                onClick={() => {
                  setSelectedId(conversation.id);
                  void loadConversation(conversation.id);
                }}
              >
                <div>
                  <strong>
                    {conversation.primaryContactName ?? conversation.subject ?? 'Conversa'}
                  </strong>
                  <span>{dateLabel(conversation.lastMessageAt)}</span>
                </div>
                <small>
                  {conversation.companyName ?? 'Empresa não informada'} ·{' '}
                  {conversation.dealTitle ?? 'Sem oportunidade'}
                </small>
                <p>{conversation.lastMessagePreview ?? 'Sem mensagem de texto'}</p>
                <div className="conversation-list__signals">
                  <span>{conversation.dealStatus ?? conversation.channel}</span>
                  {conversation.unreadCount > 0 ? <b>{conversation.unreadCount}</b> : null}
                  {conversation.needsAttention ? <em>Atenção</em> : null}
                </div>
              </button>
            ))}
          </div>
          <div className="message-panel">
            {detail ? (
              <>
                <header>
                  <div>
                    <strong>
                      {detail.conversation.subject ??
                        detail.conversation.primaryContactName ??
                        'Conversa'}
                    </strong>
                    <span>
                      {detail.conversation.channel} · {detail.conversation.primaryProvider}
                    </span>
                  </div>
                </header>
                <div className="message-stream">
                  {detail.messages.items.map((message) => (
                    <div
                      key={message.id}
                      className={`message-bubble message-bubble--${message.senderType === 'SELLER' ? 'seller' : 'lead'}`}
                    >
                      <strong>{message.senderDisplayName ?? message.senderType}</strong>
                      {message.contentType === 'AUDIO' ? (
                        <AudioMessage message={message} />
                      ) : (
                        <p>
                          {message.deletedAt
                            ? 'Mensagem removida na fonte'
                            : (message.text ?? `[${message.contentType}]`)}
                        </p>
                      )}
                      <time>
                        {dateLabel(message.occurredAt)} · {message.provider}
                      </time>
                    </div>
                  ))}
                  {detail.messages.nextCursor ? (
                    <button
                      className="load-more"
                      onClick={() => {
                        void window.morubi.commercial
                          .listMessages(
                            detail.conversation.id,
                            detail.messages.nextCursor ?? undefined
                          )
                          .then((next) =>
                            setDetail({
                              conversation: detail.conversation,
                              messages: {
                                items: [...detail.messages.items, ...next.messages.items],
                                nextCursor: next.messages.nextCursor
                              }
                            })
                          );
                      }}
                    >
                      Carregar mais
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <LoadingState />
            )}
          </div>
          <aside className="conversation-context">
            {detail && context ? (
              <>
                <span className="morubi-eyebrow">Contexto</span>
                <h2>{context.conversation.contactName ?? 'Participantes'}</h2>
                <p className="context-summary">{context.summary}</p>
                <dl>
                  <dt>Oportunidade</dt>
                  <dd>{context.conversation.dealTitle}</dd>
                  <dt>Estado</dt>
                  <dd>{context.conversation.dealStatus}</dd>
                  <dt>Etapa</dt>
                  <dd>{context.conversation.providerStageLabel ?? 'Não informada'}</dd>
                </dl>
                <ContextList title="Dores" values={context.pains} />
                <ContextList title="Objeções" values={context.objections} />
                <ContextList title="Decisores" values={context.decisionMakers} />
                <h3>Próximo passo</h3>
                <p className="context-summary">{context.nextStep ?? 'Ainda não identificado.'}</p>
                <h3>Memória</h3>
                {context.memory.slice(0, 4).map((fact) => (
                  <div className="detail-row" key={fact.id}>
                    <strong>{fact.factType}</strong>
                    <span>{fact.value}</span>
                  </div>
                ))}
                <MorubiCopilotPanel
                  context={context}
                  onDismiss={() => void updateCurrent('dismiss')}
                  onApplied={() => void updateCurrent('applied')}
                />
              </>
            ) : null}
          </aside>
        </div>
      )}
    </section>
  );
}

function ContextList({ title, values }: { title: string; values: string[] }) {
  return (
    <>
      <h3>{title}</h3>
      {values.length > 0 ? (
        values.slice(0, 4).map((value) => (
          <p className="context-chip" key={value}>
            {value}
          </p>
        ))
      ) : (
        <p className="context-empty">Nenhum sinal confirmado.</p>
      )}
    </>
  );
}

function MorubiCopilotPanel({
  context,
  onDismiss,
  onApplied
}: {
  context: ConversationContextDto;
  onDismiss: () => void;
  onApplied: () => void;
}) {
  const card = context.copilot.current;
  const [feedback, setFeedback] = useState<'HELPFUL' | 'NOT_HELPFUL' | null>(null);
  const visibleState = context.copilot.state === 'SUPPRESSED' ? 'IDLE' : context.copilot.state;
  const stateLabel = {
    IDLE: 'Observando',
    ANALYZING: 'Analisando',
    INSIGHT_READY: 'Contexto atualizado',
    INTERVENTION_READY: 'Insight pronto',
    ERROR: 'Temporariamente indisponível'
  }[visibleState];
  return (
    <section className="copilot-panel" aria-live="polite">
      <div className="copilot-panel__title">
        <Sparkles size={14} />
        <strong>Morubi Copilot</strong>
        <span>{stateLabel}</span>
      </div>
      {!card ? (
        <p className="copilot-idle">
          {visibleState === 'ERROR'
            ? 'O contexto continua disponível; o Copilot tentará novamente sem interromper a conversa.'
            : visibleState === 'ANALYZING'
              ? 'Analisando o novo trecho da conversa…'
              : 'Acompanhando a conversa. Um card só aparece quando houver algo acionável.'}
        </p>
      ) : (
        <article className={`copilot-card copilot-card--${card.category.toLowerCase()}`}>
          <div className="copilot-card__meta">
            <span>{card.category.replaceAll('_', ' ')}</span>
            <button aria-label="Dispensar intervenção" onClick={onDismiss}>
              <X size={13} />
            </button>
          </div>
          <h4>{card.title}</h4>
          <p>{card.guidance}</p>
          {card.suggestedQuestion ? <blockquote>{card.suggestedQuestion}</blockquote> : null}
          <div className="copilot-card__actions">
            {card.suggestedQuestion ? (
              <button
                onClick={() => void navigator.clipboard.writeText(card.suggestedQuestion ?? '')}
              >
                <Copy size={12} /> Copiar
              </button>
            ) : null}
            <button onClick={onApplied}>
              <Check size={12} /> Usei
            </button>
          </div>
          {context.copilot.feedbackEnabled ? (
            <div className="copilot-feedback">
              <span>Foi útil?</span>
              <button
                className={feedback === 'HELPFUL' ? 'active' : ''}
                aria-label="Útil"
                onClick={() => {
                  setFeedback('HELPFUL');
                  void window.morubi.interventions.feedback(card.deliveryId, {
                    rating: 'HELPFUL'
                  });
                }}
              >
                <ThumbsUp size={12} />
              </button>
              <button
                className={feedback === 'NOT_HELPFUL' ? 'active' : ''}
                aria-label="Não útil"
                onClick={() => {
                  setFeedback('NOT_HELPFUL');
                  void window.morubi.interventions.feedback(card.deliveryId, {
                    rating: 'NOT_HELPFUL'
                  });
                }}
              >
                <ThumbsDown size={12} />
              </button>
            </div>
          ) : null}
        </article>
      )}
    </section>
  );
}
