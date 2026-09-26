import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { TicketBotClient } from '../bot/TicketBotClient';
import { BotCommand } from '../types/command';
import { logger } from '../core/logger';

export async function loadCommands(client: TicketBotClient): Promise<void> {
  const requireModule = createRequire(__filename);
  const directory = path.join(__dirname, '..', 'commands');
  const extension = __filename.endsWith('.ts') ? '.ts' : '.js';
  const files = fs.readdirSync(directory).filter((file) => file.endsWith(extension) && !file.endsWith('.d.ts') && file !== `helpers${extension}`);
  for (const file of files) {
    const module = requireModule(path.join(directory, file)) as Partial<BotCommand>;
    if (module.data && module.execute) {
      client.commands.set(module.data.name, module as BotCommand);
      logger.debug('Comando carregado', { command: module.data.name });
    }
  }
}
