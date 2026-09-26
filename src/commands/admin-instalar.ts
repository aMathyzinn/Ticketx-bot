import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { installAdminLauncher } from '../services/AdminConsoleController';

export const data = new SlashCommandBuilder()
  .setName('admin-instalar')
  .setDescription('Publica o botão da central administrativa')
  .addChannelOption((option) => option.setName('canal').setDescription('Canal administrativo').setRequired(true).addChannelTypes(ChannelType.GuildText));

export async function execute(interaction: ChatInputCommandInteraction, client: TicketBotClient): Promise<void> {
  await installAdminLauncher(interaction, client);
}
