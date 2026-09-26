import { AutocompleteInteraction, ChatInputCommandInteraction, GuildMember, MessageFlags } from 'discord.js';
import { ForbiddenError } from '../core/errors';
import { TicketBotClient } from '../bot/TicketBotClient';

export function requireGuild(interaction: ChatInputCommandInteraction): asserts interaction is ChatInputCommandInteraction<'cached'> {
  if (!interaction.inCachedGuild() || !(interaction.member instanceof GuildMember)) {
    throw new ForbiddenError('Este comando só pode ser usado dentro de um servidor.');
  }
}

export function requireAdministrator(interaction: ChatInputCommandInteraction<'cached'>, client: TicketBotClient): void {
  if (!(interaction.member instanceof GuildMember) || !client.authorization.isAdministrator(interaction.member)) {
    throw new ForbiddenError('Somente administradores do bot ou membros com Gerenciar Servidor podem usar este comando.');
  }
}

export async function completePanelKeys(interaction: AutocompleteInteraction, client: TicketBotClient): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = client.repository.listPanels(interaction.guildId)
    .filter((panel) => panel.key.includes(focused) || panel.title.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((panel) => ({ name: `${panel.title} (${panel.key})`.slice(0, 100), value: panel.key }));
  await interaction.respond(choices);
}

export async function completePanelOrCategory(interaction: AutocompleteInteraction, client: TicketBotClient): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'painel') return completePanelKeys(interaction, client);
  const panelKey = interaction.options.getString('painel');
  if (!panelKey) return interaction.respond([]);
  const value = String(focused.value).toLowerCase();
  const choices = client.repository.listCategories(interaction.guildId, panelKey)
    .filter((category) => category.key.includes(value) || category.name.toLowerCase().includes(value))
    .slice(0, 25)
    .map((category) => ({ name: `${category.name} (${category.key})`.slice(0, 100), value: category.key }));
  await interaction.respond(choices);
}

export const ephemeral = MessageFlags.Ephemeral;
