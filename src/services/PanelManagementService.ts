import { ChannelType, Guild } from 'discord.js';
import { TicketRepository } from '../database/TicketRepository';
import { Panel } from '../domain/models';
import { buildPanel } from '../ui/components';

export class PanelManagementService {
  public constructor(private readonly repository: TicketRepository) {}

  public async publish(guild: Guild, panelKey: string): Promise<Panel> {
    const panel = this.repository.getPanel(guild.id, panelKey);
    const categories = this.repository.listCategories(guild.id, panelKey, true);
    if (categories.length === 0) throw new Error('Crie ao menos uma categoria ativa antes de publicar o painel.');

    const target = await guild.channels.fetch(panel.channelId);
    if (!target || target.type !== ChannelType.GuildText) throw new Error('O canal de publicação não existe ou não é um canal de texto.');

    if (panel.ticketMode === 'channels') {
      const parent = await guild.channels.fetch(panel.parentCategoryId);
      if (!parent || parent.type !== ChannelType.GuildCategory) {
        throw new Error('Selecione uma categoria válida para tickets em canais antes de publicar.');
      }
    }

    const payload = buildPanel(panel, categories);
    let message = panel.messageId
      ? await target.messages.fetch(panel.messageId).then((existing) => existing.edit(payload)).catch(() => undefined)
      : undefined;
    message ??= await target.send(payload);
    this.repository.setPanelMessage(guild.id, panelKey, message.id, target.id);
    return this.repository.getPanel(guild.id, panelKey);
  }

  public clone(guildId: string, sourceKey: string): Panel {
    const source = this.repository.getPanel(guildId, sourceKey);
    const baseKey = `${source.key}-copia`.slice(0, 31);
    let key = baseKey;
    let suffix = 2;
    while (this.repository.listPanels(guildId).some((panel) => panel.key === key)) {
      key = `${baseKey.slice(0, 31 - String(suffix).length - 1)}-${suffix}`;
      suffix += 1;
    }

    const clone = this.repository.upsertPanel({
      ...source,
      key,
      title: `${source.title} (cópia)`.slice(0, 200),
      messageId: undefined,
    });
    for (const category of this.repository.listCategories(guildId, sourceKey)) {
      this.repository.upsertCategory({ ...category, panelKey: key });
    }
    return clone;
  }

  public delete(guildId: string, panelKey: string): void {
    this.repository.deletePanel(guildId, panelKey);
  }
}
