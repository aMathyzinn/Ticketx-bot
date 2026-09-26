import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ChatInputCommandInteraction,
  MessageFlags, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { normalizeKey, TicketMode } from '../domain/models';
import { adminSessions } from '../services/AdminSessionStore';
import { buildPanelList } from '../ui/components';
import { completePanelKeys, ephemeral, requireAdministrator, requireGuild } from './helpers';

export interface PanelModalSession {
  kind: 'panel-create' | 'panel-edit';
  guildId: string;
  key: string;
  channelId: string;
  parentCategoryId: string;
  ticketMode: TicketMode;
  style: 'buttons' | 'select';
}

export const data = new SlashCommandBuilder()
  .setName('painel').setDescription('Cria e administra painéis de tickets')
  .addSubcommand((sub) => sub.setName('criar').setDescription('Cria um painel personalizável')
    .addStringOption((option) => option.setName('id').setDescription('Identificador, ex.: suporte').setRequired(true).setMinLength(2).setMaxLength(31))
    .addChannelOption((option) => option.setName('canal').setDescription('Canal onde o painel será publicado').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addStringOption((option) => option.setName('tipo').setDescription('Componente de escolha').setRequired(true)
      .addChoices({ name: 'Botões', value: 'buttons' }, { name: 'Menu de seleção', value: 'select' }))
    .addChannelOption((option) => option.setName('categoria').setDescription('Categoria onde os tickets serão criados (obrigatório para canais)').setRequired(false).addChannelTypes(ChannelType.GuildCategory))
    .addStringOption((option) => option.setName('modo').setDescription('Formato de atendimento').setRequired(false)
      .addChoices(
        { name: 'Threads privadas (dentro do canal do painel)', value: 'private-threads' },
        { name: 'Canais de texto em categoria', value: 'channels' },
      )))
  .addSubcommand((sub) => sub.setName('editar').setDescription('Edita a aparência de um painel')
    .addStringOption((option) => option.setName('painel').setDescription('Painel').setRequired(true).setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName('rota').setDescription('Altera canais, tipo e modo de um painel')
    .addStringOption((option) => option.setName('painel').setDescription('Painel').setRequired(true).setAutocomplete(true))
    .addChannelOption((option) => option.setName('canal').setDescription('Canal de publicação').setRequired(false).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('categoria').setDescription('Categoria dos tickets').setRequired(false).addChannelTypes(ChannelType.GuildCategory))
    .addStringOption((option) => option.setName('modo').setDescription('Formato de atendimento').setRequired(false)
      .addChoices(
        { name: 'Threads privadas (dentro do canal do painel)', value: 'private-threads' },
        { name: 'Canais de texto em categoria', value: 'channels' },
      ))
    .addStringOption((option) => option.setName('tipo').setDescription('Componente').setRequired(false)
      .addChoices({ name: 'Botões', value: 'buttons' }, { name: 'Menu', value: 'select' })))
  .addSubcommand((sub) => sub.setName('publicar').setDescription('Publica ou atualiza um painel')
    .addStringOption((option) => option.setName('painel').setDescription('Painel').setRequired(true).setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName('imagem').setDescription('Altera banner e miniatura')
    .addStringOption((option) => option.setName('painel').setDescription('Painel').setRequired(true).setAutocomplete(true))
    .addStringOption((option) => option.setName('banner').setDescription('URL do banner').setMaxLength(500))
    .addStringOption((option) => option.setName('miniatura').setDescription('URL da miniatura').setMaxLength(500))
    .addBooleanOption((option) => option.setName('limpar').setDescription('Remove as imagens atuais')))
  .addSubcommand((sub) => sub.setName('estado').setDescription('Ativa ou desativa um painel')
    .addStringOption((option) => option.setName('painel').setDescription('Painel').setRequired(true).setAutocomplete(true))
    .addBooleanOption((option) => option.setName('ativo').setDescription('Estado desejado').setRequired(true)))
  .addSubcommand((sub) => sub.setName('lista').setDescription('Lista os painéis ativos do servidor'))
  .addSubcommand((sub) => sub.setName('excluir').setDescription('Exclui a configuração de um painel')
    .addStringOption((option) => option.setName('painel').setDescription('Painel').setRequired(true).setAutocomplete(true)));

function panelModal(sessionId: string, defaults?: { title: string; description: string; color: string; bannerUrl?: string; footer?: string }): ModalBuilder {
  return new ModalBuilder().setCustomId(`admin:panel:${sessionId}`).setTitle(defaults ? 'Editar painel' : 'Criar painel').addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Título').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setValue(defaults?.title ?? 'Central de Atendimento')),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Descrição').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3000).setValue(defaults?.description ?? 'Selecione abaixo o assunto do seu atendimento.')),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Cor hexadecimal').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setValue(defaults?.color ?? '#5865F2')),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('banner').setLabel('URL do banner (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500).setValue(defaults?.bannerUrl ?? '')),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('footer').setLabel('Rodapé (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500).setValue(defaults?.footer ?? '')),
  );
}

export async function execute(interaction: ChatInputCommandInteraction, client: TicketBotClient): Promise<void> {
  requireGuild(interaction);
  requireAdministrator(interaction, client);
  const sub = interaction.options.getSubcommand();
  client.repository.ensureGuild(interaction.guildId);

  if (sub === 'criar') {
    const key = normalizeKey(interaction.options.getString('id', true));
    if (client.repository.listPanels(interaction.guildId).some((panel) => panel.key === key)) throw new Error(`O painel \`${key}\` já existe.`);
    const ticketMode = (interaction.options.getString('modo') as TicketMode | null) ?? 'channels';
    const channel = interaction.options.getChannel('canal', true);
    const category = interaction.options.getChannel('categoria');
    if (ticketMode === 'channels' && !category) {
      throw new Error('A categoria é obrigatória quando o modo for "Canais de texto em categoria".');
    }
    const parentCategoryId = category ? category.id : channel.id;
    const session: PanelModalSession = {
      kind: 'panel-create', guildId: interaction.guildId, key,
      channelId: channel.id,
      parentCategoryId,
      ticketMode,
      style: interaction.options.getString('tipo', true) as 'buttons' | 'select',
    };
    await interaction.showModal(panelModal(adminSessions.create(session)));
    return;
  }

  if (sub === 'editar') {
    const panel = client.repository.getPanel(interaction.guildId, interaction.options.getString('painel', true));
    const session: PanelModalSession = {
      kind: 'panel-edit', guildId: interaction.guildId, key: panel.key,
      channelId: panel.channelId, parentCategoryId: panel.parentCategoryId,
      ticketMode: panel.ticketMode, style: panel.style,
    };
    await interaction.showModal(panelModal(adminSessions.create(session), panel));
    return;
  }

  if (sub === 'rota') {
    const key = interaction.options.getString('painel', true);
    const panel = client.repository.getPanel(interaction.guildId, key);
    const channel = interaction.options.getChannel('canal');
    const category = interaction.options.getChannel('categoria');
    const mode = interaction.options.getString('modo') as TicketMode | null;
    const style = interaction.options.getString('tipo') as 'buttons' | 'select' | null;
    const nextMode = mode ?? panel.ticketMode;
    const nextChannelId = channel?.id ?? panel.channelId;
    const nextCategoryId = category?.id ?? (nextMode === 'private-threads' ? nextChannelId : panel.parentCategoryId);
    client.repository.upsertPanel({
      ...panel,
      channelId: nextChannelId,
      parentCategoryId: nextCategoryId,
      ticketMode: nextMode,
      style: style ?? panel.style,
    });
    await interaction.reply({ content: `✅ Rota do painel \`${key}\` atualizada. Publique novamente para aplicar.`, flags: ephemeral });
    return;
  }

  if (sub === 'lista') {
    const panels = client.repository.listPanels(interaction.guildId);
    const counts = new Map(panels.map((panel) => [panel.key, client.repository.listCategories(interaction.guildId, panel.key).length]));
    const message = buildPanelList(panels, counts, client.repository.ensureGuild(interaction.guildId));
    await interaction.reply({ ...message, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return;
  }

  const key = interaction.options.getString('painel', true);
  if (sub === 'imagem') {
    const panel = client.repository.getPanel(interaction.guildId, key);
    const clear = interaction.options.getBoolean('limpar') ?? false;
    const banner = interaction.options.getString('banner');
    const thumbnail = interaction.options.getString('miniatura');
    if (!clear && !banner && !thumbnail) throw new Error('Informe ao menos uma imagem ou use `limpar:true`.');
    client.repository.upsertPanel({
      ...panel,
      bannerUrl: clear ? undefined : (banner ?? panel.bannerUrl),
      thumbnailUrl: clear ? undefined : (thumbnail ?? panel.thumbnailUrl),
    });
    await interaction.reply({ content: `✅ Imagens do painel \`${key}\` atualizadas.`, flags: ephemeral });
    return;
  }

  if (sub === 'estado') {
    const panel = client.repository.getPanel(interaction.guildId, key);
    const enabled = interaction.options.getBoolean('ativo', true);
    client.repository.upsertPanel({ ...panel, enabled });
    await interaction.reply({ content: `✅ Painel \`${key}\` ${enabled ? 'ativado' : 'desativado'}.`, flags: ephemeral });
    return;
  }

  if (sub === 'publicar') {
    await interaction.deferReply({ flags: ephemeral });
    const panel = await client.panels.publish(interaction.guild, key);
    await interaction.editReply(`✅ Painel \`${key}\` publicado em <#${panel.channelId}>.`);
    return;
  }

  if (sub === 'excluir') {
    const sessionId = adminSessions.create({ kind: 'panel-delete' as const, guildId: interaction.guildId, key });
    await interaction.reply({
      content: `⚠️ Confirma a exclusão do painel \`${key}\` e de suas categorias? A mensagem publicada não será apagada automaticamente.`,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`admin:panel-delete:${sessionId}`).setLabel('Excluir configuração').setStyle(ButtonStyle.Danger))],
      flags: ephemeral,
    });
  }
}

export const autocomplete = completePanelKeys;
