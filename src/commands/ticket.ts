import { ChannelType, ChatInputCommandInteraction, GuildMember, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { ForbiddenError } from '../core/errors';
import { buildStats, buildTicketStatus } from '../ui/components';
import { ephemeral, requireGuild } from './helpers';

export const data = new SlashCommandBuilder().setName('ticket').setDescription('Gerencia o ticket do canal atual')
  .addSubcommand((sub) => sub.setName('info').setDescription('Exibe informações do ticket'))
  .addSubcommand((sub) => sub.setName('estatisticas').setDescription('Exibe estatísticas do servidor'))
  .addSubcommand((sub) => sub.setName('fechar').setDescription('Fecha o ticket')
    .addStringOption((option) => option.setName('motivo').setDescription('Motivo do fechamento').setMaxLength(500)))
  .addSubcommand((sub) => sub.setName('reabrir').setDescription('Reabre um ticket fechado'))
  .addSubcommand((sub) => sub.setName('reivindicar').setDescription('Assume o atendimento'))
  .addSubcommand((sub) => sub.setName('liberar').setDescription('Libera o atendimento para a equipe'))
  .addSubcommand((sub) => sub.setName('adicionar').setDescription('Adiciona um participante')
    .addUserOption((option) => option.setName('usuario').setDescription('Usuário').setRequired(true)))
  .addSubcommand((sub) => sub.setName('remover').setDescription('Remove um participante')
    .addUserOption((option) => option.setName('usuario').setDescription('Usuário').setRequired(true)))
  .addSubcommand((sub) => sub.setName('renomear').setDescription('Renomeia o canal')
    .addStringOption((option) => option.setName('nome').setDescription('Novo nome').setRequired(true).setMinLength(2).setMaxLength(90)))
  .addSubcommand((sub) => sub.setName('transcript').setDescription('Gera uma transcrição HTML'));

export async function execute(interaction: ChatInputCommandInteraction, client: TicketBotClient): Promise<void> {
  requireGuild(interaction);
  const sub = interaction.options.getSubcommand();
  const settings = client.repository.ensureGuild(interaction.guildId);

  if (sub === 'estatisticas') {
    if (!client.authorization.isAdministrator(interaction.member as GuildMember)) throw new ForbiddenError('Somente administradores podem consultar estatísticas globais.');
    const payload = buildStats(client.repository.getStats(interaction.guildId), settings);
    await interaction.reply({ ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return;
  }

  const ticket = client.repository.getTicketByChannel(interaction.guildId, interaction.channelId);
  const category = client.repository.getCategory(interaction.guildId, ticket.panelKey, ticket.categoryKey);
  const member = interaction.member as GuildMember;

  if (sub === 'info') {
    const payload = buildTicketStatus(ticket, category, settings);
    await interaction.reply({ ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return;
  }

  if (sub === 'transcript') {
    await interaction.deferReply({ flags: ephemeral });
    const attachment = await client.tickets.transcript(member, ticket.id);
    await interaction.editReply({ content: `📄 Transcrição do ticket #${ticket.ticketNumber}.`, files: [attachment] });
    return;
  }

  await interaction.deferReply({ flags: ephemeral });
  if (sub === 'fechar') {
    await client.tickets.close(member, ticket.id, interaction.options.getString('motivo') ?? undefined);
    await interaction.editReply('✅ Ticket fechado. A transcrição foi arquivada quando configurada.');
  } else if (sub === 'reabrir') {
    await client.tickets.reopen(member, ticket.id);
    await interaction.editReply('✅ Ticket reaberto.');
  } else if (sub === 'reivindicar') {
    await client.tickets.claim(member, ticket.id);
    await interaction.editReply('✅ Atendimento reivindicado.');
  } else if (sub === 'liberar') {
    await client.tickets.unclaim(member, ticket.id);
    await interaction.editReply('✅ Atendimento liberado.');
  } else if (sub === 'adicionar') {
    const user = interaction.options.getUser('usuario', true);
    await client.tickets.addParticipantToTicket(member, ticket.id, user);
    await interaction.editReply(`✅ <@${user.id}> adicionado ao ticket.`);
  } else if (sub === 'remover') {
    const user = interaction.options.getUser('usuario', true);
    await client.tickets.removeParticipantFromTicket(member, ticket.id, user);
    await interaction.editReply(`✅ <@${user.id}> removido do ticket.`);
  } else if (sub === 'renomear') {
    if (!client.authorization.isStaff(member, category)) throw new ForbiddenError('Somente a equipe pode renomear tickets.');
    if (interaction.channel?.type !== ChannelType.GuildText && interaction.channel?.type !== ChannelType.PrivateThread) throw new Error('Canal inválido.');
    const name = interaction.options.getString('nome', true).toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');
    await interaction.channel.setName(name, `Renomeado por ${interaction.user.tag}`);
    await interaction.editReply(`✅ Canal renomeado para \`${name}\`.`);
  }
}
