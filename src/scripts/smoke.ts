import { TicketBotClient } from '../bot/TicketBotClient';
import { env } from '../config/env';
import { TicketRepository } from '../database/TicketRepository';
import { loadCommands } from '../handlers/commandHandler';

async function main(): Promise<void> {
  const repository = new TicketRepository(':memory:');
  const client = new TicketBotClient(repository);
  await loadCommands(client);
  await client.login(env.token);
  console.log(JSON.stringify({
    ok: true,
    bot: client.user?.tag,
    applicationId: client.application?.id,
    guilds: client.guilds.cache.map((guild) => ({ id: guild.id, name: guild.name, members: guild.memberCount })),
    commands: client.commands.size,
  }));
  client.destroy();
  repository.close();
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
