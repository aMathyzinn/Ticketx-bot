import { TicketBotClient } from './bot/TicketBotClient';
import { env } from './config/env';
import { configureLogger, logger } from './core/logger';
import { TicketRepository } from './database/TicketRepository';
import { loadCommands } from './handlers/commandHandler';
import { loadEvents } from './handlers/eventHandler';

configureLogger(env.logLevel);
const repository = new TicketRepository(env.databasePath);
const client = new TicketBotClient(repository);

async function shutdown(signal: string): Promise<void> {
  logger.info('Encerrando bot', { signal });
  client.destroy();
  repository.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => logger.error('Promise rejeitada sem tratamento', error));
process.on('uncaughtException', (error) => logger.error('Exceção não tratada', error));

async function main(): Promise<void> {
  await loadCommands(client);
  await loadEvents(client);
  await client.login(env.token);
}

main().catch(async (error) => {
  logger.error('Falha fatal ao iniciar', error);
  await shutdown('startup-error');
  process.exitCode = 1;
});
