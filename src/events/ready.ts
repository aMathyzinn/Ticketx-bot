import { ActivityType, Events } from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { logger } from '../core/logger';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client: TicketBotClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) client.repository.ensureGuild(guild.id);
  client.user?.setPresence({ activities: [{ name: '/painel lista • Tickets V2', type: ActivityType.Watching }], status: 'online' });
  logger.info('Bot conectado', { user: client.user?.tag, guilds: client.guilds.cache.size, commands: client.commands.size });
}
