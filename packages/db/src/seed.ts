import 'dotenv/config';
import { CommercialIngestionService } from './commercial-ingestion.js';
import { createDatabase } from './database.js';
import { memberships, organizations, user } from './schema.js';
import { permissionsForRole } from '@morubi/permissions';

const organizationId = '0ac00000-0000-4000-8000-000000000001';
const membershipId = '0ac00000-0000-4000-8000-000000000002';
const ownerMembershipId = '0ac00000-0000-4000-8000-000000000003';
const userId = 'dev-marina';
const ownerUserId = 'dev-acme-owner';
const adminUrl = process.env.DATABASE_ADMIN_URL;
const runtimeUrl = process.env.DATABASE_URL;

if (!adminUrl || !runtimeUrl) {
  throw new Error('DATABASE_ADMIN_URL and DATABASE_URL are required to seed ACME.');
}

const admin = createDatabase(adminUrl);
await admin.db
  .insert(user)
  .values([
    { id: userId, name: 'Marina Costa', email: 'marina@acme.example' },
    { id: ownerUserId, name: 'Owner ACME', email: 'owner@acme.example' }
  ])
  .onConflictDoNothing();
await admin.db
  .insert(organizations)
  .values({ id: organizationId, name: 'ACME', slug: 'acme-demo' })
  .onConflictDoUpdate({ target: organizations.id, set: { name: 'ACME' } });
await admin.db
  .insert(memberships)
  .values({ id: membershipId, organizationId, userId, role: 'SELLER' })
  .onConflictDoUpdate({ target: memberships.id, set: { role: 'SELLER' } });
await admin.db
  .insert(memberships)
  .values({ id: ownerMembershipId, organizationId, userId: ownerUserId, role: 'OWNER' })
  .onConflictDoUpdate({ target: memberships.id, set: { role: 'OWNER' } });
await admin.close();

const runtime = createDatabase(runtimeUrl);
const service = new CommercialIngestionService(runtime.db, {
  userId,
  organizationId,
  membershipId,
  role: 'SELLER',
  permissions: permissionsForRole('SELLER')
});

function source(externalId: string, updatedAt: string, payload: Record<string, unknown>) {
  return {
    provider: 'fixture-crm',
    externalWorkspaceId: 'acme-demo',
    externalId,
    idempotencyKey: `${externalId}:${updatedAt}`,
    providerUpdatedAt: new Date(updatedAt),
    observedAt: new Date(updatedAt),
    rawPayload: payload
  };
}

const carlos = await service.ingestContact(
  source('contact-carlos', '2026-09-29T13:00:00Z', { id: 'contact-carlos', version: 1 }),
  {
    name: 'Carlos Almeida',
    email: 'carlos@northwind.example',
    phone: '+55 11 90000-1010',
    companyName: 'Northwind Brasil',
    jobTitle: 'Diretor Comercial'
  }
);
const fernanda = await service.ingestContact(
  source('contact-fernanda', '2026-09-30T16:15:00Z', { id: 'contact-fernanda', version: 1 }),
  {
    name: 'Fernanda Lima',
    email: 'fernanda@contoso.example',
    companyName: 'Contoso',
    jobTitle: 'Head de Receita'
  }
);

const projectX = await service.ingestDeal(
  source('deal-project-x', '2026-10-01T11:20:00Z', { id: 'deal-project-x', stage: 'proposal' }),
  {
    title: 'Projeto X',
    amountMinor: 185_000_00n,
    currency: 'BRL',
    status: 'OPEN',
    providerStageId: 'proposal',
    providerStageLabel: 'Proposta enviada',
    ownerMembershipId: membershipId,
    contactIds: [carlos.id],
    openedAt: new Date('2026-09-18T14:00:00Z')
  }
);
const projectY = await service.ingestDeal(
  source('deal-project-y', '2026-10-02T10:00:00Z', { id: 'deal-project-y', stage: 'negotiation' }),
  {
    title: 'Projeto Y',
    amountMinor: 96_500_00n,
    currency: 'BRL',
    status: 'OPEN',
    providerStageId: 'negotiation',
    providerStageLabel: 'Negociação',
    ownerMembershipId: membershipId,
    contactIds: [fernanda.id],
    openedAt: new Date('2026-09-22T12:30:00Z')
  }
);

const conversationX = await service.ingestConversation(
  source('thread-project-x', '2026-10-03T14:30:00Z', {
    id: 'thread-project-x',
    channel: 'whatsapp'
  }),
  {
    subject: 'Projeto X · próximos passos',
    channel: 'WHATSAPP',
    primaryContactId: carlos.id,
    dealId: projectX.id,
    startedAt: new Date('2026-10-03T13:40:00Z'),
    participants: [
      { type: 'CONTACT', contactId: carlos.id, displayName: 'Carlos Almeida' },
      { type: 'MEMBERSHIP', membershipId, displayName: 'Marina Costa' }
    ]
  }
);
const conversationY = await service.ingestConversation(
  source('thread-project-y', '2026-10-03T17:45:00Z', { id: 'thread-project-y', channel: 'email' }),
  {
    subject: 'Projeto Y · revisão comercial',
    channel: 'EMAIL',
    primaryContactId: fernanda.id,
    dealId: projectY.id,
    startedAt: new Date('2026-10-03T16:50:00Z'),
    participants: [
      { type: 'CONTACT', contactId: fernanda.id, displayName: 'Fernanda Lima' },
      { type: 'MEMBERSHIP', membershipId, displayName: 'Marina Costa' }
    ]
  }
);

const messageFixtures = [
  {
    id: 'msg-x-1',
    conversationId: conversationX.id,
    senderType: 'LEAD' as const,
    sender: 'Carlos Almeida',
    text: 'Marina, conseguimos revisar a proposta hoje?',
    at: '2026-10-03T13:41:00Z'
  },
  {
    id: 'msg-x-2',
    conversationId: conversationX.id,
    senderType: 'SELLER' as const,
    sender: 'Marina Costa',
    text: 'Claro. Separei os cenários e envio antes das 16h.',
    at: '2026-10-03T13:44:00Z'
  },
  {
    id: 'msg-y-1',
    conversationId: conversationY.id,
    senderType: 'LEAD' as const,
    sender: 'Fernanda Lima',
    text: 'Podemos incluir o time financeiro na próxima conversa?',
    at: '2026-10-03T16:52:00Z'
  },
  {
    id: 'msg-y-2',
    conversationId: conversationY.id,
    senderType: 'SELLER' as const,
    sender: 'Marina Costa',
    text: 'Sim. Vou propor dois horários e incluir o resumo comercial.',
    at: '2026-10-03T17:02:00Z'
  }
];

for (const fixture of messageFixtures) {
  const message = await service.ingestMessage(
    source(fixture.id, fixture.at, { id: fixture.id, text: fixture.text }),
    {
      conversationId: fixture.conversationId,
      senderType: fixture.senderType,
      senderDisplayName: fixture.sender,
      contentType: 'TEXT',
      text: fixture.text,
      occurredAt: new Date(fixture.at)
    }
  );
  await service.ingestCommercialEvent(
    source(`event-${fixture.id}`, fixture.at, { messageId: fixture.id, kind: 'message' }),
    {
      conversationId: fixture.conversationId,
      messageId: message.id,
      actorType: fixture.senderType === 'SELLER' ? 'SELLER' : 'LEAD',
      source: fixture.conversationId === conversationX.id ? 'WHATSAPP' : 'EMAIL',
      type: 'MESSAGE',
      text: fixture.text,
      occurredAt: new Date(fixture.at)
    }
  );
}

await runtime.close();
console.log('Seed ACME concluído: Marina, Carlos, Fernanda, Projeto X e Projeto Y.');
