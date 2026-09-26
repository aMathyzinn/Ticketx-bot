import { randomUUID } from 'node:crypto';

export type AdminConsoleScreen =
  | 'home'
  | 'panels'
  | 'panel'
  | 'appearance'
  | 'route'
  | 'route-channel'
  | 'route-category'
  | 'route-mode'
  | 'categories'
  | 'category'
  | 'category-access'
  | 'category-team'
  | 'category-behaviour'
  | 'forms'
  | 'question'
  | 'settings'
  | 'settings-logs'
  | 'settings-transcripts'
  | 'settings-admins'
  | 'panel-create-channel'
  | 'diagnostics'
  | 'confirm-delete-panel'
  | 'confirm-delete-category'
  | 'confirm-delete-question';

export interface AdminConsoleSession {
  id: string;
  guildId: string;
  userId: string;
  screen: AdminConsoleScreen;
  page: number;
  panelKey?: string;
  categoryKey?: string;
  questionId?: string;
  draftChannelId?: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 10 * 60_000;

/**
 * Keeps navigation state out of Discord custom IDs. Sessions are intentionally
 * process-local: a restart safely expires the console instead of accepting a
 * stale administrative action.
 */
export class AdminConsoleStore {
  private readonly sessions = new Map<string, AdminConsoleSession>();

  public create(input: Omit<AdminConsoleSession, 'id' | 'expiresAt'>): AdminConsoleSession {
    this.cleanup();
    const session: AdminConsoleSession = {
      ...input,
      id: randomUUID().replaceAll('-', '').slice(0, 12),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  public get(id: string): AdminConsoleSession | undefined {
    const session = this.sessions.get(id);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return undefined;
    }
    return session;
  }

  public update(id: string, patch: Partial<Omit<AdminConsoleSession, 'id' | 'guildId' | 'userId' | 'expiresAt'>>): AdminConsoleSession | undefined {
    const session = this.get(id);
    if (!session) return undefined;
    Object.assign(session, patch);
    return session;
  }

  public remove(id: string): void {
    this.sessions.delete(id);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }
}

export const adminConsoleSessions = new AdminConsoleStore();
