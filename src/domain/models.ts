export type PanelStyle = 'buttons' | 'select';
export type TicketMode = 'channels' | 'private-threads';
export type TicketStatus = 'creating' | 'open' | 'claimed' | 'closed' | 'failed';
export type ButtonStyleName = 'primary' | 'secondary' | 'success' | 'danger';

export interface TicketQuestion {
  id: string;
  label: string;
  style: 'short' | 'paragraph';
  placeholder?: string;
  required: boolean;
  minLength?: number;
  maxLength?: number;
}

export interface GuildSettings {
  guildId: string;
  logChannelId?: string;
  transcriptChannelId?: string;
  adminRoleIds: string[];
  accentColor: string;
  closeDelaySeconds: number;
}

export interface Panel {
  guildId: string;
  key: string;
  channelId: string;
  parentCategoryId: string;
  ticketMode: TicketMode;
  style: PanelStyle;
  title: string;
  description: string;
  color: string;
  bannerUrl?: string;
  thumbnailUrl?: string;
  footer?: string;
  messageId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TicketCategory {
  guildId: string;
  panelKey: string;
  key: string;
  name: string;
  description: string;
  emoji?: string;
  buttonStyle: ButtonStyleName;
  staffRoleIds: string[];
  allowedRoleIds: string[];
  channelNameTemplate: string;
  welcomeMessage: string;
  allowUserClose: boolean;
  allowClaim: boolean;
  maxOpenPerUser: number;
  questions: TicketQuestion[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  id: number;
  guildId: string;
  ticketNumber: number;
  panelKey: string;
  categoryKey: string;
  userId: string;
  username: string;
  channelId?: string;
  status: TicketStatus;
  claimedBy?: string;
  answers: Record<string, string>;
  closeReason?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface TicketStats {
  total: number;
  open: number;
  claimed: number;
  closed: number;
}

export const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}$/;

export function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31);
}

export function normalizeHexColor(value: string, fallback = '#5865F2'): string {
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
}
