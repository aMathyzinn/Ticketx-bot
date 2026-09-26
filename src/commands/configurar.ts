import {
  ChannelType, ChatInputCommandInteraction, PermissionFlagsBits, PermissionsBitField, SlashCommandBuilder,
} from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { env } from '../config/env';
import { normalizeHexColor } from '../domain/models';
import { ephemeral, requireAdministrator, requireGuild } from './helpers';

export const data = new SlashCommandBuilder().setName('configurar').setDescription('Configura e diagnostica o bot neste servidor')
  .addSubcommand((sub) => sub.setName('canal').setDescription('Define um canal operacional')
    .addStringOption((option) => option.setName('tipo').setDescription('Finalidade').setRequired(true).addChoices({ name: 'Logs', value: 'logs' }, { name: 'Transcrições', value: 'transcripts' }))
    .addChannelOption((option) => option.setName('canal').setDescription('Canal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((sub) => sub.setName('limpar').setDescription('Remove uma configuração de canal')
    .addStringOption((option) => option.setName('tipo').setDescription('Finalidade').setRequired(true).addChoices({ name: 'Logs', value: 'logs' }, { name: 'Transcrições', value: 'transcripts' })))
  .addSubcommand((sub) => sub.setName('cargo').setDescription('Gerencia cargos administradores do bot')
    .addStringOption((option) => option.setName('acao').setDescription('Ação').setRequired(true).addChoices({ name: 'Adicionar', value: 'add' }, { name: 'Remover', value: 'remove' }))
    .addRoleOption((option) => option.setName('cargo').setDescription('Cargo').setRequired(true)))
  .addSubcommand((sub) => sub.setName('aparencia').setDescription('Define a cor padrão')
    .addStringOption((option) => option.setName('cor').setDescription('Hexadecimal, ex.: #5865F2').setRequired(true).setMaxLength(7)))
  .addSubcommand((sub) => sub.setName('diagnostico').setDescription('Verifica configuração e permissões'))
  .addSubcommand((sub) => sub.setName('convite').setDescription('Gera o link de instalação do bot'));

export async function execute(interaction: ChatInputCommandInteraction, client: TicketBotClient): Promise<void> {
  requireGuild(interaction);
  requireAdministrator(interaction, client);
  const sub = interaction.options.getSubcommand();
  const settings = client.repository.ensureGuild(interaction.guildId);

  if (sub === 'canal') {
    const channel = interaction.options.getChannel('canal', true);
    const type = interaction.options.getString('tipo', true);
    client.repository.updateGuildSettings(interaction.guildId, type === 'logs' ? { logChannelId: channel.id } : { transcriptChannelId: channel.id });
    await interaction.reply({ content: `✅ Canal de ${type === 'logs' ? 'logs' : 'transcrições'} definido como <#${channel.id}>.`, flags: ephemeral });
    return;
  }

  if (sub === 'limpar') {
    const type = interaction.options.getString('tipo', true);
    client.repository.updateGuildSettings(interaction.guildId, type === 'logs' ? { logChannelId: undefined } : { transcriptChannelId: undefined });
    await interaction.reply({ content: `✅ Canal de ${type === 'logs' ? 'logs' : 'transcrições'} removido.`, flags: ephemeral });
    return;
  }

  if (sub === 'cargo') {
    const role = interaction.options.getRole('cargo', true);
    const roles = new Set(settings.adminRoleIds);
    if (interaction.options.getString('acao', true) === 'add') roles.add(role.id); else roles.delete(role.id);
    client.repository.updateGuildSettings(interaction.guildId, { adminRoleIds: [...roles] });
    await interaction.reply({ content: `✅ Cargos administradores: ${[...roles].map((id) => `<@&${id}>`).join(', ') || 'nenhum (Manage Server continua autorizado)'}.`, allowedMentions: { parse: [] }, flags: ephemeral });
    return;
  }

  if (sub === 'aparencia') {
    const raw = interaction.options.getString('cor', true);
    const color = normalizeHexColor(raw, '');
    if (!color) throw new Error('Cor inválida. Use o formato `#RRGGBB`.');
    client.repository.updateGuildSettings(interaction.guildId, { accentColor: color });
    await interaction.reply({ content: `✅ Cor padrão definida como \`${color}\`.`, flags: ephemeral });
    return;
  }

  if (sub === 'convite') {
    const permissions = new PermissionsBitField([
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
    ]).bitfield.toString();
    const url = `https://discord.com/oauth2/authorize?client_id=${env.clientId}&permissions=${permissions}&scope=bot%20applications.commands`;
    await interaction.reply({ content: `**Link de instalação:**\n${url}\n\nDepois de instalar, execute \`/configurar diagnostico\`.`, flags: ephemeral });
    return;
  }

  const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
  const required = [
    ['Gerenciar canais', PermissionFlagsBits.ManageChannels], ['Ver canais', PermissionFlagsBits.ViewChannel],
    ['Enviar mensagens', PermissionFlagsBits.SendMessages], ['Gerenciar mensagens', PermissionFlagsBits.ManageMessages],
    ['Ler histórico', PermissionFlagsBits.ReadMessageHistory], ['Anexar arquivos', PermissionFlagsBits.AttachFiles],
  ] as const;
  const permissionLines = required.map(([name, permission]) => `${me.permissions.has(permission) ? '✅' : '❌'} ${name}`);
  const panels = client.repository.listPanels(interaction.guildId);
  const configLines = [
    `${settings.logChannelId ? '✅' : '⚠️'} Canal de logs ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'não definido'}`,
    `${settings.transcriptChannelId ? '✅' : '⚠️'} Canal de transcrições ${settings.transcriptChannelId ? `<#${settings.transcriptChannelId}>` : 'não definido'}`,
    `${panels.length ? '✅' : '⚠️'} ${panels.length} painel(is) configurado(s)`,
  ];
  await interaction.reply({ content: `**Diagnóstico de ${interaction.guild.name}**\n\n${permissionLines.join('\n')}\n\n${configLines.join('\n')}`, allowedMentions: { parse: [] }, flags: ephemeral });
}
