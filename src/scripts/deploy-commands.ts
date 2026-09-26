import { REST, Routes } from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { env } from '../config/env';
import { configureLogger, logger } from '../core/logger';
import { TicketRepository } from '../database/TicketRepository';
import { loadCommands } from '../handlers/commandHandler';

async function main(): Promise<void> {
  configureLogger(env.logLevel);
  const repository = new TicketRepository(env.databasePath);
  const client = new TicketBotClient(repository);
  await loadCommands(client);
  const body = client.commands.map((command) => command.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(env.token);
  if (env.globalCommands) {
    await rest.put(Routes.applicationCommands(env.clientId), { body });
    logger.info('Comandos globais registrados', { count: body.length });
  } else {
    if (!env.guildId) throw new Error('Defina GUILD_ID para deploy de desenvolvimento ou GLOBAL_COMMANDS=true para produção.');
    await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body });
    logger.info('Comandos de desenvolvimento registrados', { count: body.length, guildId: env.guildId });
  }
  repository.close();
}

main().catch((error) => {
  logger.error('Falha ao registrar comandos', error);
  process.exitCode = 1;
});
