import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ActiveTicketExistsError, NotFoundError } from '../core/errors';
import {
  GuildSettings,
  Panel,
  Ticket,
  TicketCategory,
  TicketQuestion,
  TicketStats,
} from '../domain/models';

type Row = Record<string, unknown>;

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export class TicketRepository {
  private readonly db: Database.Database;

  public constructor(databasePath: string) {
    if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    if (databasePath !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        log_channel_id TEXT,
        transcript_channel_id TEXT,
        admin_role_ids TEXT NOT NULL DEFAULT '[]',
        accent_color TEXT NOT NULL DEFAULT '#5865F2',
        close_delay_seconds INTEGER NOT NULL DEFAULT 10 CHECK(close_delay_seconds BETWEEN 0 AND 300),
        next_ticket_number INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS panels (
        guild_id TEXT NOT NULL,
        panel_key TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        parent_category_id TEXT NOT NULL,
        ticket_mode TEXT NOT NULL DEFAULT 'channels' CHECK(ticket_mode IN ('channels', 'private-threads')),
        style TEXT NOT NULL CHECK(style IN ('buttons', 'select')),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        color TEXT NOT NULL,
        banner_url TEXT,
        thumbnail_url TEXT,
        footer TEXT,
        message_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (guild_id, panel_key),
        FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ticket_categories (
        guild_id TEXT NOT NULL,
        panel_key TEXT NOT NULL,
        category_key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        emoji TEXT,
        button_style TEXT NOT NULL DEFAULT 'primary',
        staff_role_ids TEXT NOT NULL DEFAULT '[]',
        allowed_role_ids TEXT NOT NULL DEFAULT '[]',
        channel_name_template TEXT NOT NULL DEFAULT 'ticket-{number}-{username}',
        welcome_message TEXT NOT NULL,
        allow_user_close INTEGER NOT NULL DEFAULT 1,
        allow_claim INTEGER NOT NULL DEFAULT 1,
        max_open_per_user INTEGER NOT NULL DEFAULT 1 CHECK(max_open_per_user BETWEEN 1 AND 10),
        questions TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (guild_id, panel_key, category_key),
        FOREIGN KEY (guild_id, panel_key) REFERENCES panels(guild_id, panel_key) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        ticket_number INTEGER NOT NULL,
        panel_key TEXT NOT NULL,
        category_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        channel_id TEXT UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('creating','open','claimed','closed','failed')),
        claimed_by TEXT,
        answers TEXT NOT NULL DEFAULT '{}',
        close_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        UNIQUE (guild_id, ticket_number),
        FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
      );

      DROP INDEX IF EXISTS uq_active_ticket;
      CREATE TRIGGER IF NOT EXISTS limit_active_ticket_insert
      BEFORE INSERT ON tickets
      WHEN NEW.status IN ('creating', 'open', 'claimed') AND (
        SELECT COUNT(*) FROM tickets
        WHERE guild_id = NEW.guild_id AND user_id = NEW.user_id
          AND panel_key = NEW.panel_key AND category_key = NEW.category_key
          AND status IN ('creating', 'open', 'claimed')
      ) >= COALESCE((
        SELECT max_open_per_user FROM ticket_categories
        WHERE guild_id = NEW.guild_id AND panel_key = NEW.panel_key AND category_key = NEW.category_key
      ), 1)
      BEGIN
        SELECT RAISE(ABORT, 'ACTIVE_TICKET_LIMIT');
      END;

      CREATE TRIGGER IF NOT EXISTS limit_active_ticket_reopen
      BEFORE UPDATE OF status ON tickets
      WHEN NEW.status IN ('creating', 'open', 'claimed') AND OLD.status NOT IN ('creating', 'open', 'claimed') AND (
        SELECT COUNT(*) FROM tickets
        WHERE guild_id = NEW.guild_id AND user_id = NEW.user_id
          AND panel_key = NEW.panel_key AND category_key = NEW.category_key
          AND status IN ('creating', 'open', 'claimed') AND id != NEW.id
      ) >= COALESCE((
        SELECT max_open_per_user FROM ticket_categories
        WHERE guild_id = NEW.guild_id AND panel_key = NEW.panel_key AND category_key = NEW.category_key
      ), 1)
      BEGIN
        SELECT RAISE(ABORT, 'ACTIVE_TICKET_LIMIT');
      END;
      CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(guild_id, channel_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(guild_id, status);

      CREATE TABLE IF NOT EXISTS ticket_participants (
        ticket_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        added_at TEXT NOT NULL,
        PRIMARY KEY (ticket_id, user_id),
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      );
    `);

    const categoryColumns = this.db.prepare('PRAGMA table_info(ticket_categories)').all() as Array<{ name: string }>;
    if (!categoryColumns.some((column) => column.name === 'allowed_role_ids')) {
      this.db.exec("ALTER TABLE ticket_categories ADD COLUMN allowed_role_ids TEXT NOT NULL DEFAULT '[]'");
    }
    const panelColumns = this.db.prepare('PRAGMA table_info(panels)').all() as Array<{ name: string }>;
    if (!panelColumns.some((column) => column.name === 'ticket_mode')) {
      this.db.exec("ALTER TABLE panels ADD COLUMN ticket_mode TEXT NOT NULL DEFAULT 'channels'");
    }
  }

  public close(): void {
    this.db.close();
  }

  public ensureGuild(guildId: string): GuildSettings {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO guild_settings (guild_id, created_at, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO NOTHING
    `).run(guildId, now, now);
    return this.getGuildSettings(guildId);
  }

  public getGuildSettings(guildId: string): GuildSettings {
    const row = this.db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId) as Row | undefined;
    if (!row) throw new NotFoundError('Configuração do servidor');
    return {
      guildId: String(row.guild_id),
      logChannelId: optionalString(row.log_channel_id),
      transcriptChannelId: optionalString(row.transcript_channel_id),
      adminRoleIds: json<string[]>(row.admin_role_ids, []),
      accentColor: String(row.accent_color),
      closeDelaySeconds: Number(row.close_delay_seconds),
    };
  }

  public updateGuildSettings(guildId: string, updates: Partial<Omit<GuildSettings, 'guildId'>>): GuildSettings {
    const current = this.ensureGuild(guildId);
    const next = { ...current, ...updates };
    this.db.prepare(`
      UPDATE guild_settings SET log_channel_id = ?, transcript_channel_id = ?, admin_role_ids = ?,
        accent_color = ?, close_delay_seconds = ?, updated_at = ? WHERE guild_id = ?
    `).run(
      next.logChannelId ?? null,
      next.transcriptChannelId ?? null,
      JSON.stringify(next.adminRoleIds),
      next.accentColor,
      next.closeDelaySeconds,
      new Date().toISOString(),
      guildId,
    );
    return this.getGuildSettings(guildId);
  }

  public upsertPanel(panel: Omit<Panel, 'createdAt' | 'updatedAt'>): Panel {
    this.ensureGuild(panel.guildId);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO panels (guild_id, panel_key, channel_id, parent_category_id, ticket_mode, style, title, description,
        color, banner_url, thumbnail_url, footer, message_id, enabled, created_at, updated_at)
      VALUES (@guildId, @key, @channelId, @parentCategoryId, @ticketMode, @style, @title, @description,
        @color, @bannerUrl, @thumbnailUrl, @footer, @messageId, @enabled, @createdAt, @updatedAt)
      ON CONFLICT(guild_id, panel_key) DO UPDATE SET
        channel_id=excluded.channel_id, parent_category_id=excluded.parent_category_id, ticket_mode=excluded.ticket_mode, style=excluded.style,
        title=excluded.title, description=excluded.description, color=excluded.color,
        banner_url=excluded.banner_url, thumbnail_url=excluded.thumbnail_url, footer=excluded.footer,
        message_id=COALESCE(excluded.message_id, panels.message_id), enabled=excluded.enabled,
        updated_at=excluded.updated_at
    `).run({
      ...panel,
      ticketMode: panel.ticketMode,
      bannerUrl: panel.bannerUrl ?? null,
      thumbnailUrl: panel.thumbnailUrl ?? null,
      footer: panel.footer ?? null,
      messageId: panel.messageId ?? null,
      enabled: panel.enabled ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    return this.getPanel(panel.guildId, panel.key);
  }

  public getPanel(guildId: string, key: string): Panel {
    const row = this.db.prepare('SELECT * FROM panels WHERE guild_id = ? AND panel_key = ?').get(guildId, key) as Row | undefined;
    if (!row) throw new NotFoundError('Painel');
    return this.mapPanel(row);
  }

  public listPanels(guildId: string): Panel[] {
    return (this.db.prepare('SELECT * FROM panels WHERE guild_id = ? ORDER BY panel_key').all(guildId) as Row[]).map((row) => this.mapPanel(row));
  }

  public setPanelMessage(guildId: string, key: string, messageId: string, channelId: string): void {
    this.db.prepare('UPDATE panels SET message_id = ?, channel_id = ?, updated_at = ? WHERE guild_id = ? AND panel_key = ?')
      .run(messageId, channelId, new Date().toISOString(), guildId, key);
  }

  public deletePanel(guildId: string, key: string): boolean {
    const active = this.db.prepare(`SELECT COUNT(*) AS count FROM tickets WHERE guild_id = ? AND panel_key = ? AND status IN ('creating','open','claimed')`).get(guildId, key) as { count: number };
    if (active.count > 0) throw new Error('Não é possível excluir um painel com tickets ativos.');
    return this.db.prepare('DELETE FROM panels WHERE guild_id = ? AND panel_key = ?').run(guildId, key).changes > 0;
  }

  public upsertCategory(category: Omit<TicketCategory, 'createdAt' | 'updatedAt'>): TicketCategory {
    this.getPanel(category.guildId, category.panelKey);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO ticket_categories (guild_id, panel_key, category_key, name, description, emoji,
        button_style, staff_role_ids, allowed_role_ids, channel_name_template, welcome_message, allow_user_close,
        allow_claim, max_open_per_user, questions, enabled, created_at, updated_at)
      VALUES (@guildId, @panelKey, @key, @name, @description, @emoji, @buttonStyle, @staffRoleIds,
        @allowedRoleIds, @channelNameTemplate, @welcomeMessage, @allowUserClose, @allowClaim, @maxOpenPerUser,
        @questions, @enabled, @createdAt, @updatedAt)
      ON CONFLICT(guild_id, panel_key, category_key) DO UPDATE SET
        name=excluded.name, description=excluded.description, emoji=excluded.emoji,
        button_style=excluded.button_style, staff_role_ids=excluded.staff_role_ids,
        allowed_role_ids=excluded.allowed_role_ids,
        channel_name_template=excluded.channel_name_template, welcome_message=excluded.welcome_message,
        allow_user_close=excluded.allow_user_close, allow_claim=excluded.allow_claim,
        max_open_per_user=excluded.max_open_per_user, questions=excluded.questions,
        enabled=excluded.enabled, updated_at=excluded.updated_at
    `).run({
      ...category,
      emoji: category.emoji ?? null,
      staffRoleIds: JSON.stringify(category.staffRoleIds),
      allowedRoleIds: JSON.stringify(category.allowedRoleIds),
      questions: JSON.stringify(category.questions),
      allowUserClose: category.allowUserClose ? 1 : 0,
      allowClaim: category.allowClaim ? 1 : 0,
      enabled: category.enabled ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    return this.getCategory(category.guildId, category.panelKey, category.key);
  }

  public getCategory(guildId: string, panelKey: string, key: string): TicketCategory {
    const row = this.db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? AND panel_key = ? AND category_key = ?')
      .get(guildId, panelKey, key) as Row | undefined;
    if (!row) throw new NotFoundError('Categoria');
    return this.mapCategory(row);
  }

  public listCategories(guildId: string, panelKey: string, enabledOnly = false): TicketCategory[] {
    const sql = `SELECT * FROM ticket_categories WHERE guild_id = ? AND panel_key = ?${enabledOnly ? ' AND enabled = 1' : ''} ORDER BY category_key`;
    return (this.db.prepare(sql).all(guildId, panelKey) as Row[]).map((row) => this.mapCategory(row));
  }

  public deleteCategory(guildId: string, panelKey: string, key: string): boolean {
    const active = this.db.prepare(`SELECT COUNT(*) AS count FROM tickets WHERE guild_id = ? AND panel_key = ? AND category_key = ? AND status IN ('creating','open','claimed')`)
      .get(guildId, panelKey, key) as { count: number };
    if (active.count > 0) throw new Error('Não é possível excluir uma categoria com tickets ativos.');
    return this.db.prepare('DELETE FROM ticket_categories WHERE guild_id = ? AND panel_key = ? AND category_key = ?').run(guildId, panelKey, key).changes > 0;
  }

  public setQuestions(guildId: string, panelKey: string, categoryKey: string, questions: TicketQuestion[]): TicketCategory {
    this.db.prepare('UPDATE ticket_categories SET questions = ?, updated_at = ? WHERE guild_id = ? AND panel_key = ? AND category_key = ?')
      .run(JSON.stringify(questions.slice(0, 5)), new Date().toISOString(), guildId, panelKey, categoryKey);
    return this.getCategory(guildId, panelKey, categoryKey);
  }

  public reserveTicket(input: Pick<Ticket, 'guildId' | 'panelKey' | 'categoryKey' | 'userId' | 'username' | 'answers'>): Ticket {
    const reserve = this.db.transaction(() => {
      this.ensureGuild(input.guildId);
      const row = this.db.prepare('SELECT next_ticket_number FROM guild_settings WHERE guild_id = ?').get(input.guildId) as { next_ticket_number: number };
      const number = row.next_ticket_number;
      const now = new Date().toISOString();
      try {
        const result = this.db.prepare(`
          INSERT INTO tickets (guild_id, ticket_number, panel_key, category_key, user_id, username,
            status, answers, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?)
        `).run(input.guildId, number, input.panelKey, input.categoryKey, input.userId, input.username, JSON.stringify(input.answers), now, now);
        this.db.prepare('UPDATE guild_settings SET next_ticket_number = next_ticket_number + 1, updated_at = ? WHERE guild_id = ?').run(now, input.guildId);
        return Number(result.lastInsertRowid);
      } catch (error) {
        if (error instanceof Error && error.message.includes('ACTIVE_TICKET_LIMIT')) throw new ActiveTicketExistsError();
        throw error;
      }
    });
    return this.getTicketById(reserve());
  }

  public activateTicket(id: number, channelId: string): Ticket {
    this.db.prepare(`UPDATE tickets SET channel_id = ?, status = 'open', updated_at = ? WHERE id = ? AND status = 'creating'`)
      .run(channelId, new Date().toISOString(), id);
    return this.getTicketById(id);
  }

  public failTicket(id: number): void {
    this.db.prepare(`UPDATE tickets SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'creating'`).run(new Date().toISOString(), id);
  }

  public getTicketById(id: number): Ticket {
    const row = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new NotFoundError('Ticket');
    return this.mapTicket(row);
  }

  public getTicketByChannel(guildId: string, channelId: string): Ticket {
    const row = this.db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId) as Row | undefined;
    if (!row) throw new NotFoundError('Ticket');
    return this.mapTicket(row);
  }

  public claimTicket(id: number, userId: string): Ticket {
    this.db.prepare(`UPDATE tickets SET status = 'claimed', claimed_by = ?, updated_at = ? WHERE id = ? AND status = 'open'`)
      .run(userId, new Date().toISOString(), id);
    return this.getTicketById(id);
  }

  public unclaimTicket(id: number): Ticket {
    this.db.prepare(`UPDATE tickets SET status = 'open', claimed_by = NULL, updated_at = ? WHERE id = ? AND status = 'claimed'`)
      .run(new Date().toISOString(), id);
    return this.getTicketById(id);
  }

  public closeTicket(id: number, reason?: string): Ticket {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE tickets SET status = 'closed', close_reason = ?, closed_at = ?, updated_at = ? WHERE id = ? AND status IN ('open','claimed')`)
      .run(reason ?? null, now, now, id);
    return this.getTicketById(id);
  }

  public reopenTicket(id: number): Ticket {
    try {
      this.db.prepare(`UPDATE tickets SET status = 'open', claimed_by = NULL, closed_at = NULL, updated_at = ? WHERE id = ? AND status = 'closed'`)
        .run(new Date().toISOString(), id);
    } catch (error) {
      if (error instanceof Error && error.message.includes('ACTIVE_TICKET_LIMIT')) throw new ActiveTicketExistsError();
      throw error;
    }
    return this.getTicketById(id);
  }

  public addParticipant(ticketId: number, userId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO ticket_participants (ticket_id, user_id, added_at) VALUES (?, ?, ?)')
      .run(ticketId, userId, new Date().toISOString());
  }

  public removeParticipant(ticketId: number, userId: string): void {
    this.db.prepare('DELETE FROM ticket_participants WHERE ticket_id = ? AND user_id = ?').run(ticketId, userId);
  }

  public getStats(guildId: string): TicketStats {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS count FROM tickets WHERE guild_id = ? GROUP BY status').all(guildId) as Array<{ status: string; count: number }>;
    const counts = Object.fromEntries(rows.map((row) => [row.status, row.count]));
    return {
      total: rows.reduce((sum, row) => sum + row.count, 0),
      open: Number(counts.open ?? 0),
      claimed: Number(counts.claimed ?? 0),
      closed: Number(counts.closed ?? 0),
    };
  }

  private mapPanel(row: Row): Panel {
    return {
      guildId: String(row.guild_id), key: String(row.panel_key), channelId: String(row.channel_id),
      parentCategoryId: String(row.parent_category_id), ticketMode: row.ticket_mode as Panel['ticketMode'], style: row.style as Panel['style'],
      title: String(row.title), description: String(row.description), color: String(row.color),
      bannerUrl: optionalString(row.banner_url), thumbnailUrl: optionalString(row.thumbnail_url),
      footer: optionalString(row.footer), messageId: optionalString(row.message_id), enabled: Boolean(row.enabled),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  private mapCategory(row: Row): TicketCategory {
    return {
      guildId: String(row.guild_id), panelKey: String(row.panel_key), key: String(row.category_key),
      name: String(row.name), description: String(row.description), emoji: optionalString(row.emoji),
      buttonStyle: row.button_style as TicketCategory['buttonStyle'], staffRoleIds: json<string[]>(row.staff_role_ids, []),
      allowedRoleIds: json<string[]>(row.allowed_role_ids, []),
      channelNameTemplate: String(row.channel_name_template), welcomeMessage: String(row.welcome_message),
      allowUserClose: Boolean(row.allow_user_close), allowClaim: Boolean(row.allow_claim),
      maxOpenPerUser: Number(row.max_open_per_user), questions: json<TicketQuestion[]>(row.questions, []),
      enabled: Boolean(row.enabled), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  private mapTicket(row: Row): Ticket {
    return {
      id: Number(row.id), guildId: String(row.guild_id), ticketNumber: Number(row.ticket_number),
      panelKey: String(row.panel_key), categoryKey: String(row.category_key), userId: String(row.user_id),
      username: String(row.username), channelId: optionalString(row.channel_id), status: row.status as Ticket['status'],
      claimedBy: optionalString(row.claimed_by), answers: json<Record<string, string>>(row.answers, {}),
      closeReason: optionalString(row.close_reason), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      closedAt: optionalString(row.closed_at),
    };
  }
}
