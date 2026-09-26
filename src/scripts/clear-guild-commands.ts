import { REST, Routes } from 'discord.js';
import { env } from '../config/env';

async function main(): Promise<void> {
  if (!env.guildId) throw new Error('GUILD_ID é obrigatório para limpar comandos locais.');
  const rest = new REST({ version: '10' }).setToken(env.token);
  await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body: [] });
  console.log(JSON.stringify({ ok: true, clearedGuildId: env.guildId }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
