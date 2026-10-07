export interface FixtureContactDTO {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  title?: string | null;
  updatedAt: string;
  archived?: boolean;
}

export interface FixtureDealDTO {
  id: string;
  title: string;
  valueMinor?: string | null;
  currency?: string | null;
  status: 'open' | 'won' | 'lost';
  stageId?: string | null;
  stageLabel?: string | null;
  contactIds?: string[];
  updatedAt: string;
  openedAt?: string | null;
  closedAt?: string | null;
  archived?: boolean;
  owner?: { id: string; name?: string | null; email?: string | null } | null;
}
