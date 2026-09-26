import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { openAdminConsole } from '../services/AdminConsoleController';

export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Abre a central visual de administração do bot');

export async function execute(interaction: ChatInputCommandInteraction, client: TicketBotClient): Promise<void> {
  await openAdminConsole(interaction, client);
}
