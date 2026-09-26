import { ChannelType } from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { env } from '../config/env';
import { TicketRepository } from '../database/TicketRepository';

async function main(): Promise<void> {
  if (!env.guildId) throw new Error('GUILD_ID é obrigatório.');
  const repository = new TicketRepository(':memory:');
  const client = new TicketBotClient(repository);
  try {
    await client.login(env.token);
    const guild = await client.guilds.fetch(env.guildId).then((entry) => entry.fetch());
    const channels = await guild.channels.fetch();
    const roles = await guild.roles.fetch();
    const typeNames: Partial<Record<ChannelType, string>> = {
      [ChannelType.GuildCategory]: 'category', [ChannelType.GuildText]: 'text',
      [ChannelType.GuildAnnouncement]: 'announcement', [ChannelType.GuildForum]: 'forum',
      [ChannelType.GuildVoice]: 'voice', [ChannelType.GuildStageVoice]: 'stage',
    };
    console.log(JSON.stringify({
      guild: { id: guild.id, name: guild.name },
      roles: roles.filter((role) => !role.managed).sort((a, b) => b.position - a.position).map((role) => ({ id: role.id, name: role.name, color: role.hexColor, position: role.position })),
      channels: channels.filter(Boolean).sort((a, b) => (a?.rawPosition ?? 0) - (b?.rawPosition ?? 0)).map((channel) => ({
        id: channel!.id, name: channel!.name, type: typeNames[channel!.type] ?? String(channel!.type),
        parentId: 'parentId' in channel! ? channel!.parentId : null,
      })),
    }, null, 2));
  } finally {
    client.destroy();
    repository.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
