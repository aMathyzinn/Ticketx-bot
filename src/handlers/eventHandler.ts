import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { TicketBotClient } from '../bot/TicketBotClient';
import { logger } from '../core/logger';

interface EventModule {
  name: string;
  once?: boolean;
  execute: (...args: any[]) => Promise<void> | void;
}

export async function loadEvents(client: TicketBotClient): Promise<void> {
  const requireModule = createRequire(__filename);
  const directory = path.join(__dirname, '..', 'events');
  const extension = __filename.endsWith('.ts') ? '.ts' : '.js';
  const files = fs.readdirSync(directory).filter((file) => file.endsWith(extension) && !file.endsWith('.d.ts'));
  for (const file of files) {
    const event = requireModule(path.join(directory, file)) as EventModule;
    const listener = (...args: any[]) => event.execute(...args, client);
    if (event.once) client.once(event.name, listener); else client.on(event.name, listener);
    logger.debug('Evento carregado', { event: event.name });
  }
}
