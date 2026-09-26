import { AutocompleteInteraction, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';

export interface BotCommand {
  data: SlashCommandBuilder;
  execute(interaction: ChatInputCommandInteraction, client: TicketBotClient): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, client: TicketBotClient): Promise<void>;
}
