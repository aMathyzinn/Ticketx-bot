import {
  ActionRowBuilder, ChatInputCommandInteraction, MessageFlags, ModalBuilder,
  Role, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { ButtonStyleName, normalizeKey } from '../domain/models';
import { adminSessions } from '../services/AdminSessionStore';
import { completePanelOrCategory, ephemeral, requireAdministrator, requireGuild } from './helpers';

export interface CategoryModalSession {
  kind: 'category-create' | 'category-edit';
  guildId: string;
  panelKey: string;
  key: string;
  buttonStyle: ButtonStyleName;
  staffRoleIds: string[];
  allowUserClose: boolean;
  allowClaim: boolean;
  maxOpenPerUser: number;
}

const panelOption = (option: any) => option.setName('painel').setDescription('Painel').setRequired(true).setAutocomplete(true);
const categoryOption = (option: any) => option.setName('categoria').setDescription('Categoria de ticket').setRequired(true).setAutocomplete(true);

export const data = new SlashCommandBuilder()
  .setName('categoria').setDescription('Administra categorias de atendimento')
  .addSubcommand((sub) => sub.setName('criar').setDescription('Adiciona uma categoria a um painel')
    .addStringOption(panelOption)
    .addStringOption((option) => option.setName('id').setDescription('Identificador, ex.: financeiro').setRequired(true).setMinLength(2).setMaxLength(31))
    .addRoleOption((option) => option.setName('equipe').setDescription('Cargo que atenderá os tickets').setRequired(true))
    .addStringOption((option) => option.setName('estilo').setDescription('Cor do botão').setRequired(true).addChoices(
      { name: 'Azul', value: 'primary' }, { name: 'Cinza', value: 'secondary' },
      { name: 'Verde', value: 'success' }, { name: 'Vermelho', value: 'danger' },
    ))
    .addIntegerOption((option) => option.setName('limite').setDescription('Tickets simultâneos por usuário').setMinValue(1).setMaxValue(10))
    .addBooleanOption((option) => option.setName('usuario_fecha').setDescription('O autor pode fechar o próprio ticket?'))
    .addBooleanOption((option) => option.setName('reivindicacao').setDescription('Ativar claim?')))
  .addSubcommand((sub) => sub.setName('editar').setDescription('Edita textos de uma categoria')
    .addStringOption(panelOption).addStringOption(categoryOption))
  .addSubcommand((sub) => sub.setName('equipe').setDescription('Adiciona ou remove um cargo de atendimento')
    .addStringOption(panelOption).addStringOption(categoryOption)
    .addStringOption((option) => option.setName('acao').setDescription('Ação').setRequired(true).addChoices({ name: 'Adicionar', value: 'add' }, { name: 'Remover', value: 'remove' }))
    .addRoleOption((option) => option.setName('cargo').setDescription('Cargo').setRequired(true)))
  .addSubcommand((sub) => sub.setName('acesso').setDescription('Controla quais cargos podem abrir tickets')
    .addStringOption(panelOption).addStringOption(categoryOption)
    .addStringOption((option) => option.setName('acao').setDescription('Ação').setRequired(true).addChoices({ name: 'Adicionar', value: 'add' }, { name: 'Remover', value: 'remove' }))
    .addRoleOption((option) => option.setName('cargo').setDescription('Cargo autorizado').setRequired(true)))
  .addSubcommand((sub) => sub.setName('opcoes').setDescription('Altera comportamento e disponibilidade')
    .addStringOption(panelOption).addStringOption(categoryOption)
    .addStringOption((option) => option.setName('estilo').setDescription('Cor do botão').addChoices(
      { name: 'Azul', value: 'primary' }, { name: 'Cinza', value: 'secondary' },
      { name: 'Verde', value: 'success' }, { name: 'Vermelho', value: 'danger' },
    ))
    .addIntegerOption((option) => option.setName('limite').setDescription('Tickets simultâneos').setMinValue(1).setMaxValue(10))
    .addBooleanOption((option) => option.setName('usuario_fecha').setDescription('O autor pode fechar?'))
    .addBooleanOption((option) => option.setName('reivindicacao').setDescription('Ativar claim?'))
    .addBooleanOption((option) => option.setName('ativo').setDescription('Categoria disponível?')))
  .addSubcommand((sub) => sub.setName('lista').setDescription('Lista categorias de um painel').addStringOption(panelOption))
  .addSubcommand((sub) => sub.setName('excluir').setDescription('Exclui uma categoria').addStringOption(panelOption).addStringOption(categoryOption));

function categoryModal(sessionId: string, defaults?: { name: string; description: string; emoji?: string; welcomeMessage: string; channelNameTemplate: string }): ModalBuilder {
  return new ModalBuilder().setCustomId(`admin:category:${sessionId}`).setTitle(defaults ? 'Editar categoria' : 'Criar categoria').addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Nome').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(defaults?.name ?? 'Suporte Geral')),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Descrição').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(defaults?.description ?? 'Dúvidas e suporte geral')),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(defaults?.emoji ?? '🎫')),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('welcome').setLabel('Mensagem de boas-vindas').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3000).setValue(defaults?.welcomeMessage ?? 'Olá {mention}! Descreva seu problema e nossa equipe responderá em breve.')),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('template').setLabel('Nome do canal').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(90).setValue(defaults?.channelNameTemplate ?? 'ticket-{number}-{username}')),
  );
}

export async function execute(interaction: ChatInputCommandInteraction, client: TicketBotClient): Promise<void> {
  requireGuild(interaction);
  requireAdministrator(interaction, client);
  const sub = interaction.options.getSubcommand();
  const panelKey = interaction.options.getString('painel', true);

  if (sub === 'criar') {
    client.repository.getPanel(interaction.guildId, panelKey);
    const key = normalizeKey(interaction.options.getString('id', true));
    if (client.repository.listCategories(interaction.guildId, panelKey).some((category) => category.key === key)) throw new Error(`A categoria \`${key}\` já existe.`);
    const role = interaction.options.getRole('equipe', true) as Role;
    const session: CategoryModalSession = {
      kind: 'category-create', guildId: interaction.guildId, panelKey, key,
      buttonStyle: interaction.options.getString('estilo', true) as ButtonStyleName,
      staffRoleIds: [role.id], allowUserClose: interaction.options.getBoolean('usuario_fecha') ?? true,
      allowClaim: interaction.options.getBoolean('reivindicacao') ?? true,
      maxOpenPerUser: interaction.options.getInteger('limite') ?? 1,
    };
    await interaction.showModal(categoryModal(adminSessions.create(session)));
    return;
  }

  const categoryKey = interaction.options.getString('categoria');
  if (sub === 'editar' && categoryKey) {
    const category = client.repository.getCategory(interaction.guildId, panelKey, categoryKey);
    const session: CategoryModalSession = {
      kind: 'category-edit', guildId: interaction.guildId, panelKey, key: category.key,
      buttonStyle: category.buttonStyle, staffRoleIds: category.staffRoleIds,
      allowUserClose: category.allowUserClose, allowClaim: category.allowClaim,
      maxOpenPerUser: category.maxOpenPerUser,
    };
    await interaction.showModal(categoryModal(adminSessions.create(session), category));
    return;
  }

  if (sub === 'equipe' && categoryKey) {
    const category = client.repository.getCategory(interaction.guildId, panelKey, categoryKey);
    const role = interaction.options.getRole('cargo', true);
    const roles = new Set(category.staffRoleIds);
    if (interaction.options.getString('acao', true) === 'add') roles.add(role.id); else roles.delete(role.id);
    client.repository.upsertCategory({ ...category, staffRoleIds: [...roles] });
    await interaction.reply({ content: `✅ Equipe de \`${categoryKey}\` atualizada: ${[...roles].map((id) => `<@&${id}>`).join(', ') || 'nenhum cargo'}.`, allowedMentions: { parse: [] }, flags: ephemeral });
    return;
  }

  if (sub === 'acesso' && categoryKey) {
    const category = client.repository.getCategory(interaction.guildId, panelKey, categoryKey);
    const role = interaction.options.getRole('cargo', true);
    const roles = new Set(category.allowedRoleIds);
    if (interaction.options.getString('acao', true) === 'add') roles.add(role.id); else roles.delete(role.id);
    client.repository.upsertCategory({ ...category, allowedRoleIds: [...roles] });
    await interaction.reply({ content: `✅ Acesso de \`${categoryKey}\` atualizado: ${[...roles].map((id) => `<@&${id}>`).join(', ') || 'todos os membros'}.`, allowedMentions: { parse: [] }, flags: ephemeral });
    return;
  }

  if (sub === 'opcoes' && categoryKey) {
    const category = client.repository.getCategory(interaction.guildId, panelKey, categoryKey);
    const updated = client.repository.upsertCategory({
      ...category,
      buttonStyle: (interaction.options.getString('estilo') as ButtonStyleName | null) ?? category.buttonStyle,
      maxOpenPerUser: interaction.options.getInteger('limite') ?? category.maxOpenPerUser,
      allowUserClose: interaction.options.getBoolean('usuario_fecha') ?? category.allowUserClose,
      allowClaim: interaction.options.getBoolean('reivindicacao') ?? category.allowClaim,
      enabled: interaction.options.getBoolean('ativo') ?? category.enabled,
    });
    await interaction.reply({ content: `✅ Opções de \`${updated.key}\` atualizadas. Publique o painel novamente.`, flags: ephemeral });
    return;
  }

  if (sub === 'lista') {
    const categories = client.repository.listCategories(interaction.guildId, panelKey);
    const lines = categories.map((category) => `• **${category.name}** — \`${category.key}\` • ${category.questions.length} pergunta(s) • limite ${category.maxOpenPerUser}\n  Equipe: ${category.staffRoleIds.map((id) => `<@&${id}>`).join(', ') || 'administradores'}\n  Acesso: ${category.allowedRoleIds.map((id) => `<@&${id}>`).join(', ') || 'todos os membros'}`);
    await interaction.reply({ content: `**Categorias de \`${panelKey}\`:**\n\n${lines.join('\n') || 'Nenhuma categoria configurada.'}`, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === 'excluir' && categoryKey) {
    const deleted = client.repository.deleteCategory(interaction.guildId, panelKey, categoryKey);
    await interaction.reply({ content: deleted ? `✅ Categoria \`${categoryKey}\` excluída.` : '❌ Categoria não encontrada.', flags: ephemeral });
  }
}

export const autocomplete = completePanelOrCategory;
