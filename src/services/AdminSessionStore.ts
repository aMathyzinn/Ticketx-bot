import { randomUUID } from 'node:crypto';

interface Session<T> {
  value: T;
  expiresAt: number;
}

export class AdminSessionStore {
  private readonly sessions = new Map<string, Session<unknown>>();

  public create<T>(value: T): string {
    this.cleanup();
    const id = randomUUID().slice(0, 8);
    this.sessions.set(id, { value, expiresAt: Date.now() + 10 * 60_000 });
    return id;
  }

  public consume<T>(id: string): T | undefined {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    if (!session || session.expiresAt < Date.now()) return undefined;
    return session.value as T;
  }

  private cleanup(): void {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt < Date.now()) this.sessions.delete(id);
    }
  }
}

export const adminSessions = new AdminSessionStore();
