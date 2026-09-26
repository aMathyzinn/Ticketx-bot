import {
  ActionRowBuilder,
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { ForbiddenError } from '../core/errors';
import { normalizeHexColor, normalizeKey, Panel, TicketCategory, TicketQuestion } from '../domain/models';
import { AdminConsoleSession, AdminConsoleScreen, adminConsoleSessions } from './AdminConsoleStore';
import {
  buildAdminAppearance,
  buildAdminCategories,
  buildAdminCategory,
  buildAdminForms,
  buildAdminHome,
  buildAdminLauncher,
  buildAdminPanel,
  buildAdminPanels,
  buildAdminQuestion,
  buildAdminRoute,
  buildAdminSettings,
  buildCategoryBehaviour,
  buildChannelPicker,
  buildDeleteConfirmation,
  buildDiagnostics,
  buildModePicker,
  buildPanelCreateChannelPicker,
  buildRolePicker,
  buildSettingsChannelPicker,
} from '../ui/adminConsole';
import { V2Message } from '../ui/components';

type ConsoleInteraction = ButtonInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction;

function modalInput(id: string, label: string, style: TextInputStyle, value?: string, required = true, maxLength = 4000): ActionRowBuilder<TextInputBuilder> {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);
  if (value) input.setValue(value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function modal(id: string, title: string, rows: Array<ActionRowBuilder<TextInputBuilder>>): ModalBuilder {
  return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(rows);
}

function nextButtonStyle(style: TicketCategory['buttonStyle']): TicketCategory['buttonStyle'] {
  const styles: Record<TicketCategory['buttonStyle'], TicketCategory['buttonStyle']> = {
    primary: 'secondary', secondary: 'success', success: 'danger', danger: 'primary',
  };
  return styles[style];
}

function updatePanel(client: TicketBotClient, panel: Panel, updates: Partial<Panel>): Panel {
  return client.repository.upsertPanel({ ...panel, ...updates });
}

function updateCategory(client: TicketBotClient, category: TicketCategory, updates: Partial<TicketCategory>): TicketCategory {
  return client.repository.upsertCategory({ ...category, ...updates });
}

async function memberFor(interaction: ConsoleInteraction | ModalSubmitInteraction | ChatInputCommandInteraction): Promise<GuildMember> {
  if (!interaction.inCachedGuild()) throw new ForbiddenError('A central administrativa só funciona dentro de um servidor.');
  return interaction.member instanceof GuildMember ? interaction.member : interaction.guild.members.fetch(interaction.user.id);
}

async function requireConsoleAdmin(interaction: ConsoleInteraction | ModalSubmitInteraction | ChatInputCommandInteraction, client: TicketBotClient): Promise<GuildMember> {
  const member = await memberFor(interaction);
  if (!client.authorization.isAdministrator(member)) {
    throw new ForbiddenError('Somente administradores autorizados podem usar a central.');
  }
  return member;
}

function sessionFor(interaction: ConsoleInteraction | ModalSubmitInteraction, client: TicketBotClient, id: string): AdminConsoleSession {
  const session = adminConsoleSessions.get(id);
  if (!session || session.guildId !== interaction.guildId || session.userId !== interaction.user.id) {
    throw new Error('Esta central expirou. Execute `/admin` novamente.');
  }
  return session;
}

function counts(client: TicketBotClient, guildId: string, panels: Panel[]): Map<string, number> {
  return new Map(panels.map((panel) => [panel.key, client.repository.listCategories(guildId, panel.key).length]));
}

function selectedPanel(client: TicketBotClient, session: AdminConsoleSession): Panel {
  if (!session.panelKey) throw new Error('Selecione um painel primeiro.');
  return client.repository.getPanel(session.guildId, session.panelKey);
}

function selectedCategory(client: TicketBotClient, session: AdminConsoleSession): TicketCategory {
  const panel = selectedPanel(client, session);
  if (!session.categoryKey) throw new Error('Selecione uma categoria primeiro.');
  return client.repository.getCategory(session.guildId, panel.key, session.categoryKey);
}

export async function renderAdminConsole(session: AdminConsoleSession, client: TicketBotClient): Promise<V2Message> {
  const settings = client.repository.ensureGuild(session.guildId);
  const panels = client.repository.listPanels(session.guildId);
  switch (session.screen) {
    case 'home': return buildAdminHome(session, settings, panels);
    case 'panels': return buildAdminPanels(session, settings, panels, counts(client, session.guildId, panels));
    case 'panel-create-channel': return buildPanelCreateChannelPicker(session, settings);
    case 'panel': {
      const panel = selectedPanel(client, session);
      return buildAdminPanel(session, settings, panel, client.repository.listCategories(session.guildId, panel.key));
    }
    case 'appearance': return buildAdminAppearance(session, settings, selectedPanel(client, session));
    case 'route': return buildAdminRoute(session, settings, selectedPanel(client, session));
    case 'route-channel': return buildChannelPicker(session, settings, selectedPanel(client, session), 'panel');
    case 'route-category': return buildChannelPicker(session, settings, selectedPanel(client, session), 'category');
    case 'route-mode': return buildModePicker(session, settings, selectedPanel(client, session));
    case 'categories': {
      const panel = selectedPanel(client, session);
      return buildAdminCategories(session, settings, panel, client.repository.listCategories(session.guildId, panel.key));
    }
    case 'category': return buildAdminCategory(session, settings, selectedPanel(client, session), selectedCategory(client, session));
    case 'category-access': {
      const category = selectedCategory(client, session);
      return buildRolePicker(session, settings, `Acesso — ${category.name}`, category.allowedRoleIds, 'select:category-access', 'Sem cargos selecionados, qualquer membro pode abrir esta categoria.');
    }
    case 'category-team': {
      const category = selectedCategory(client, session);
      return buildRolePicker(session, settings, `Equipe — ${category.name}`, category.staffRoleIds, 'select:category-team', 'Selecione os cargos que devem atender esta categoria.');
    }
    case 'category-behaviour': return buildCategoryBehaviour(session, settings, selectedCategory(client, session));
    case 'forms': return buildAdminForms(session, settings, selectedCategory(client, session));
    case 'question': {
      const category = selectedCategory(client, session);
      const question = category.questions.find((item) => item.id === session.questionId);
      if (!question) throw new Error('A pergunta não existe mais.');
      return buildAdminQuestion(session, settings, question);
    }
    case 'settings': return buildAdminSettings(session, settings);
    case 'settings-logs': return buildSettingsChannelPicker(session, settings, 'logs');
    case 'settings-transcripts': return buildSettingsChannelPicker(session, settings, 'transcripts');
    case 'settings-admins': return buildRolePicker(session, settings, 'Administradores adicionais', settings.adminRoleIds, 'select:settings-admins', 'Membros com Gerenciar Servidor continuam autorizados mesmo sem um cargo listado.');
    case 'diagnostics': {
      const guild = client.guilds.cache.get(session.guildId);
      const me = guild?.members.me ?? await guild?.members.fetchMe();
      const checks: Array<[string, boolean]> = [
        ['Gerenciar canais', Boolean(me?.permissions.has(PermissionFlagsBits.ManageChannels))],
        ['Enviar mensagens', Boolean(me?.permissions.has(PermissionFlagsBits.SendMessages))],
        ['Gerenciar mensagens', Boolean(me?.permissions.has(PermissionFlagsBits.ManageMessages))],
        ['Ler histórico', Boolean(me?.permissions.has(PermissionFlagsBits.ReadMessageHistory))],
        ['Canal de logs definido', Boolean(settings.logChannelId)],
        ['Canal de transcrições definido', Boolean(settings.transcriptChannelId)],
      ];
      return buildDiagnostics(session, settings, panels, checks);
    }
    case 'confirm-delete-panel': return buildDeleteConfirmation(session, settings, 'panel', selectedPanel(client, session).title);
    case 'confirm-delete-category': return buildDeleteConfirmation(session, settings, 'category', selectedCategory(client, session).name);
    case 'confirm-delete-question': {
      const category = selectedCategory(client, session);
      const question = category.questions.find((item) => item.id === session.questionId);
      if (!question) throw new Error('A pergunta não existe mais.');
      return buildDeleteConfirmation(session, settings, 'question', question.label);
    }
  }
}

export async function openAdminConsole(interaction: ChatInputCommandInteraction, client: TicketBotClient): Promise<void> {
  // The acknowledgement comes before authorization and rendering. Fetching a
  // member or a cold database must not make the command miss Discord's 3s
  // interaction deadline.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await requireConsoleAdmin(interaction, client);
  if (!interaction.guildId) throw new ForbiddenError();
  const session = adminConsoleSessions.create({ guildId: interaction.guildId, userId: interaction.user.id, screen: 'home', page: 0 });
  await interaction.editReply(await renderAdminConsole(session, client));
}

export async function installAdminLauncher(interaction: ChatInputCommandInteraction, client: TicketBotClient): Promise<void> {
  await requireConsoleAdmin(interaction, client);
  if (!interaction.guildId || !interaction.inCachedGuild()) throw new ForbiddenError();
  const channel = interaction.options.getChannel('canal', true);
  if (channel.type !== ChannelType.GuildText) throw new Error('Selecione um canal de texto.');
  const settings = client.repository.ensureGuild(interaction.guildId);
  await channel.send(buildAdminLauncher(settings));
  await interaction.reply({ content: `✅ Central administrativa publicada em <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
}

export async function launchAdminConsole(interaction: ButtonInteraction, client: TicketBotClient): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await requireConsoleAdmin(interaction, client);
  if (!interaction.guildId) throw new ForbiddenError();
  const session = adminConsoleSessions.create({ guildId: interaction.guildId, userId: interaction.user.id, screen: 'home', page: 0 });
  await interaction.editReply(await renderAdminConsole(session, client));
}

async function updateConsole(interaction: ConsoleInteraction, session: AdminConsoleSession, client: TicketBotClient): Promise<void> {
  await interaction.update(await renderAdminConsole(session, client));
}

function changeScreen(session: AdminConsoleSession, screen: AdminConsoleScreen): AdminConsoleSession {
  const updated = adminConsoleSessions.update(session.id, { screen });
  if (!updated) throw new Error('Esta central expirou.');
  return updated;
}

function panelTextModal(session: AdminConsoleSession, panel: Panel): ModalBuilder {
  return modal(`acm:${session.id}:panel-text`, 'Texto do painel', [
    modalInput('title', 'Título', TextInputStyle.Short, panel.title, true, 200),
    modalInput('description', 'Descrição / markdown', TextInputStyle.Paragraph, panel.description, true, 3000),
    modalInput('footer', 'Rodapé (opcional)', TextInputStyle.Short, panel.footer, false, 500),
  ]);
}

function panelMediaModal(session: AdminConsoleSession, panel: Panel): ModalBuilder {
  return modal(`acm:${session.id}:panel-media`, 'Visual do painel', [
    modalInput('color', 'Cor hexadecimal', TextInputStyle.Short, panel.color, true, 7),
    modalInput('banner', 'URL do banner (opcional)', TextInputStyle.Short, panel.bannerUrl, false, 500),
    modalInput('thumbnail', 'URL da miniatura (opcional)', TextInputStyle.Short, panel.thumbnailUrl, false, 500),
  ]);
}

function createPanelModal(session: AdminConsoleSession): ModalBuilder {
  return modal(`acm:${session.id}:panel-create`, 'Criar painel', [
    modalInput('id', 'ID do painel', TextInputStyle.Short, undefined, true, 31),
    modalInput('title', 'Título', TextInputStyle.Short, undefined, true, 200),
    modalInput('description', 'Descrição / markdown', TextInputStyle.Paragraph, 'Selecione abaixo o assunto do seu atendimento.', true, 3000),
  ]);
}

function categoryModal(session: AdminConsoleSession, kind: 'create' | 'edit', category?: TicketCategory): ModalBuilder {
  return modal(`acm:${session.id}:category-${kind}`, kind === 'create' ? 'Criar categoria' : 'Editar categoria', [
    modalInput('name', 'Nome', TextInputStyle.Short, category?.name, true, 100),
    modalInput('description', 'Descrição', TextInputStyle.Paragraph, category?.description, true, 100),
    modalInput('emoji', 'Emoji (opcional)', TextInputStyle.Short, category?.emoji, false, 100),
    modalInput('template', 'Nome do ticket', TextInputStyle.Short, category?.channelNameTemplate ?? 'ticket-{number}-{username}', true, 100),
    modalInput('welcome', 'Mensagem inicial', TextInputStyle.Paragraph, category?.welcomeMessage ?? 'Olá {mention}, explique como podemos ajudar.', true, 3000),
  ]);
}

function numberModal(session: AdminConsoleSession, kind: 'category-limit' | 'question-limits', current: TicketCategory | TicketQuestion): ModalBuilder {
  if (kind === 'category-limit') {
    return modal(`acm:${session.id}:${kind}`, 'Limite de tickets', [modalInput('limit', 'Tickets abertos por usuário (1–10)', TextInputStyle.Short, String((current as TicketCategory).maxOpenPerUser), true, 2)]);
  }
  const question = current as TicketQuestion;
  return modal(`acm:${session.id}:${kind}`, 'Limites da pergunta', [
    modalInput('min', 'Mínimo de caracteres (opcional)', TextInputStyle.Short, question.minLength ? String(question.minLength) : undefined, false, 4),
    modalInput('max', 'Máximo de caracteres (opcional)', TextInputStyle.Short, question.maxLength ? String(question.maxLength) : undefined, false, 4),
  ]);
}

function questionModal(session: AdminConsoleSession, kind: 'create' | 'edit', question?: TicketQuestion): ModalBuilder {
  return modal(`acm:${session.id}:question-${kind}`, kind === 'create' ? 'Adicionar pergunta' : 'Editar pergunta', [
    modalInput('id', 'ID interno', TextInputStyle.Short, question?.id, true, 31),
    modalInput('label', 'Pergunta', TextInputStyle.Short, question?.label, true, 45),
    modalInput('placeholder', 'Texto de exemplo (opcional)', TextInputStyle.Short, question?.placeholder, false, 100),
  ]);
}

function colorModal(session: AdminConsoleSession, value: string): ModalBuilder {
  return modal(`acm:${session.id}:settings-color`, 'Cor padrão', [modalInput('color', 'Cor hexadecimal', TextInputStyle.Short, value, true, 7)]);
}

export async function handleAdminConsoleButton(interaction: ButtonInteraction, client: TicketBotClient): Promise<boolean> {
  if (interaction.customId === 'admin-console:launch') {
    await launchAdminConsole(interaction, client);
    return true;
  }
  if (!interaction.customId.startsWith('ac:')) return false;
  await requireConsoleAdmin(interaction, client);
  const [, sessionId, ...parts] = interaction.customId.split(':');
  const action = parts.join(':');
  const session = sessionFor(interaction, client, sessionId ?? '');

  if (action.startsWith('go:')) {
    const screen = action.slice(3) as AdminConsoleScreen;
    await updateConsole(interaction, changeScreen(session, screen), client);
    return true;
  }
  if (action === 'back:category') {
    await updateConsole(interaction, changeScreen(session, 'category'), client);
    return true;
  }
  if (action === 'refresh') {
    await updateConsole(interaction, session, client);
    return true;
  }
  if (action === 'page:previous' || action === 'page:next') {
    const next = Math.max(0, session.page + (action.endsWith('next') ? 1 : -1));
    await updateConsole(interaction, adminConsoleSessions.update(session.id, { page: next })!, client);
    return true;
  }
  if (action === 'panel:create') {
    await updateConsole(interaction, changeScreen(session, 'panel-create-channel'), client);
    return true;
  }

  const panel = session.panelKey ? selectedPanel(client, session) : undefined;
  const category = session.categoryKey && panel ? selectedCategory(client, session) : undefined;
  if (action === 'panel:publish' && panel) {
    await interaction.deferUpdate();
    await client.panels.publish(interaction.guild!, panel.key);
    await interaction.editReply(await renderAdminConsole(session, client));
    return true;
  }
  if (action === 'panel:duplicate' && panel) {
    const cloned = client.panels.clone(session.guildId, panel.key);
    const next = adminConsoleSessions.update(session.id, { panelKey: cloned.key, categoryKey: undefined, screen: 'panel' })!;
    await updateConsole(interaction, next, client);
    return true;
  }
  if (action === 'panel:toggle' && panel) {
    updatePanel(client, panel, { enabled: !panel.enabled });
    await updateConsole(interaction, session, client);
    return true;
  }
  if (action === 'panel:delete:confirm' && panel) {
    await updateConsole(interaction, changeScreen(session, 'confirm-delete-panel'), client);
    return true;
  }
  if (action === 'delete:panel' && panel) {
    client.panels.delete(session.guildId, panel.key);
    const next = adminConsoleSessions.update(session.id, { panelKey: undefined, categoryKey: undefined, screen: 'panels' })!;
    await updateConsole(interaction, next, client);
    return true;
  }
  if (action === 'modal:panel-text' && panel) {
    await interaction.showModal(panelTextModal(session, panel));
    return true;
  }
  if (action === 'modal:panel-media' && panel) {
    await interaction.showModal(panelMediaModal(session, panel));
    return true;
  }
  if (action === 'route:style' && panel) {
    updatePanel(client, panel, { style: panel.style === 'select' ? 'buttons' : 'select' });
    await updateConsole(interaction, session, client);
    return true;
  }
  if (action === 'route:mode:threads' && panel) {
    updatePanel(client, panel, { ticketMode: 'private-threads', parentCategoryId: panel.channelId });
    await updateConsole(interaction, changeScreen(session, 'route'), client);
    return true;
  }
  if (action === 'route:mode:channels' && panel) {
    updatePanel(client, panel, { ticketMode: 'channels' });
    await updateConsole(interaction, changeScreen(session, 'route'), client);
    return true;
  }
  if (action === 'modal:category-create' && panel) {
    await interaction.showModal(categoryModal(session, 'create'));
    return true;
  }
  if (action === 'modal:category-edit' && category) {
    await interaction.showModal(categoryModal(session, 'edit', category));
    return true;
  }
  if (action === 'category:toggle' && category) {
    updateCategory(client, category, { enabled: !category.enabled });
    await updateConsole(interaction, session, client);
    return true;
  }
  if (action === 'category:delete:confirm' && category) {
    await updateConsole(interaction, changeScreen(session, 'confirm-delete-category'), client);
    return true;
  }
  if (action === 'delete:category' && category) {
    client.repository.deleteCategory(session.guildId, panel!.key, category.key);
    const next = adminConsoleSessions.update(session.id, { categoryKey: undefined, questionId: undefined, screen: 'categories' })!;
    await updateConsole(interaction, next, client);
    return true;
  }
  if (action === 'category:style' && category) {
    updateCategory(client, category, { buttonStyle: nextButtonStyle(category.buttonStyle) });
    await updateConsole(interaction, session, client);
    return true;
  }
  if (action === 'category:close' && category) {
    updateCategory(client, category, { allowUserClose: !category.allowUserClose });
    await updateConsole(interaction, session, client);
    return true;
  }
  if (action === 'category:claim' && category) {
    updateCategory(client, category, { allowClaim: !category.allowClaim });
    await updateConsole(interaction, session, client);
    return true;
  }
  if (action === 'modal:category-limit' && category) {
    await interaction.showModal(numberModal(session, 'category-limit', category));
    return true;
  }
  if (action === 'modal:question-create' && category) {
    await interaction.showModal(questionModal(session, 'create'));
    return true;
  }
  if (action === 'modal:question-edit' && category && session.questionId) {
    const question = category.questions.find((item) => item.id === session.questionId);
    if (!question) throw new Error('Pergunta não encontrada.');
    await interaction.showModal(questionModal(session, 'edit', question));
    return true;
  }
  if (action === 'question:style' && category && session.questionId) {
    const questions = category.questions.map((question) => question.id === session.questionId ? { ...question, style: question.style === 'short' ? 'paragraph' as const : 'short' as const } : question);
    updateCategory(client, category, { questions });
    await updateConsole(interaction, session, client);
    return true;
  }
  if (action === 'question:required' && category && session.questionId) {
    updateCategory(client, category, { questions: category.questions.map((question) => question.id === session.questionId ? { ...question, required: !question.required } : question) });
    await updateConsole(interaction, session, client);
    return true;
  }
  if (action === 'modal:question-limits' && category && session.questionId) {
    const question = category.questions.find((item) => item.id === session.questionId);
    if (!question) throw new Error('Pergunta não encontrada.');
    await interaction.showModal(numberModal(session, 'question-limits', question));
    return true;
  }
  if (action === 'question:delete' && category && session.questionId) {
    await updateConsole(interaction, changeScreen(session, 'confirm-delete-question'), client);
    return true;
  }
  if (action === 'delete:question' && category && session.questionId) {
    updateCategory(client, category, { questions: category.questions.filter((question) => question.id !== session.questionId) });
    const next = adminConsoleSessions.update(session.id, { questionId: undefined, screen: 'forms' })!;
    await updateConsole(interaction, next, client);
    return true;
  }
  if (action === 'modal:settings-color') {
    await interaction.showModal(colorModal(session, client.repository.ensureGuild(session.guildId).accentColor));
    return true;
  }
  if (action === 'settings:logs:clear' || action === 'settings:transcripts:clear') {
    client.repository.updateGuildSettings(session.guildId, action.includes('logs') ? { logChannelId: undefined } : { transcriptChannelId: undefined });
    await updateConsole(interaction, session, client);
    return true;
  }
  throw new Error('Ação administrativa desconhecida. Abra a central novamente.');
}

export async function handleAdminConsoleSelect(interaction: StringSelectMenuInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction, client: TicketBotClient): Promise<boolean> {
  if (!interaction.customId.startsWith('ac:')) return false;
  await requireConsoleAdmin(interaction, client);
  const [, sessionId, ...parts] = interaction.customId.split(':');
  const action = parts.join(':');
  const session = sessionFor(interaction, client, sessionId ?? '');
  const value = interaction.values[0];

  if (action === 'select:panel' && value) {
    const next = adminConsoleSessions.update(session.id, { panelKey: value, categoryKey: undefined, questionId: undefined, screen: 'panel' })!;
    await updateConsole(interaction, next, client);
    return true;
  }
  if (action === 'select:category' && value) {
    const next = adminConsoleSessions.update(session.id, { categoryKey: value, questionId: undefined, screen: 'category' })!;
    await updateConsole(interaction, next, client);
    return true;
  }
  if (action === 'select:question' && value) {
    const next = adminConsoleSessions.update(session.id, { questionId: value, screen: 'question' })!;
    await updateConsole(interaction, next, client);
    return true;
  }
  if (action === 'select:create-channel' && value) {
    adminConsoleSessions.update(session.id, { draftChannelId: value });
    await interaction.showModal(createPanelModal(session));
    return true;
  }
  if (action === 'select:route-channel' && value) {
    const panel = selectedPanel(client, session);
    updatePanel(client, panel, { channelId: value, parentCategoryId: panel.ticketMode === 'private-threads' ? value : panel.parentCategoryId });
    await updateConsole(interaction, changeScreen(session, 'route'), client);
    return true;
  }
  if (action === 'select:route-category' && value) {
    updatePanel(client, selectedPanel(client, session), { parentCategoryId: value });
    await updateConsole(interaction, changeScreen(session, 'route'), client);
    return true;
  }
  if (action === 'select:settings-logs' && value) {
    client.repository.updateGuildSettings(session.guildId, { logChannelId: value });
    await updateConsole(interaction, changeScreen(session, 'settings'), client);
    return true;
  }
  if (action === 'select:settings-transcripts' && value) {
    client.repository.updateGuildSettings(session.guildId, { transcriptChannelId: value });
    await updateConsole(interaction, changeScreen(session, 'settings'), client);
    return true;
  }
  if (action === 'select:settings-admins') {
    client.repository.updateGuildSettings(session.guildId, { adminRoleIds: interaction.values });
    await updateConsole(interaction, changeScreen(session, 'settings'), client);
    return true;
  }
  if (action === 'select:category-access') {
    updateCategory(client, selectedCategory(client, session), { allowedRoleIds: interaction.values });
    await updateConsole(interaction, changeScreen(session, 'category'), client);
    return true;
  }
  if (action === 'select:category-team') {
    updateCategory(client, selectedCategory(client, session), { staffRoleIds: interaction.values });
    await updateConsole(interaction, changeScreen(session, 'category'), client);
    return true;
  }
  throw new Error('Seleção administrativa desconhecida. Abra a central novamente.');
}

export async function handleAdminConsoleModal(interaction: ModalSubmitInteraction, client: TicketBotClient): Promise<boolean> {
  if (!interaction.customId.startsWith('acm:')) return false;
  await requireConsoleAdmin(interaction, client);
  const [, sessionId, kind] = interaction.customId.split(':');
  const session = sessionFor(interaction, client, sessionId ?? '');
  const read = (id: string) => interaction.fields.getTextInputValue(id).trim();

  if (kind === 'panel-create') {
    const channelId = session.draftChannelId;
    const key = normalizeKey(read('id'));
    if (!channelId || key.length < 2) throw new Error('Escolha um canal e informe um ID válido para o painel.');
    if (client.repository.listPanels(session.guildId).some((panel) => panel.key === key)) throw new Error(`O painel \`${key}\` já existe.`);
    const settings = client.repository.ensureGuild(session.guildId);
    client.repository.upsertPanel({
      guildId: session.guildId, key, channelId, parentCategoryId: channelId, ticketMode: 'private-threads', style: 'select',
      title: read('title'), description: read('description'), color: settings.accentColor, enabled: true,
    });
    const next = adminConsoleSessions.update(session.id, { panelKey: key, draftChannelId: undefined, screen: 'panel' })!;
    await interaction.reply({ ...await renderAdminConsole(next, client), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return true;
  }

  const panel = session.panelKey ? selectedPanel(client, session) : undefined;
  const category = session.categoryKey && panel ? selectedCategory(client, session) : undefined;
  if (kind === 'panel-text' && panel) {
    updatePanel(client, panel, { title: read('title'), description: read('description'), footer: read('footer') || undefined });
    const next = changeScreen(session, 'appearance');
    await interaction.reply({ ...await renderAdminConsole(next, client), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return true;
  }
  if (kind === 'panel-media' && panel) {
    const color = normalizeHexColor(read('color'), '');
    if (!color) throw new Error('Cor inválida. Use o formato `#RRGGBB`.');
    updatePanel(client, panel, { color, bannerUrl: read('banner') || undefined, thumbnailUrl: read('thumbnail') || undefined });
    const next = changeScreen(session, 'appearance');
    await interaction.reply({ ...await renderAdminConsole(next, client), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return true;
  }
  if ((kind === 'category-create' || kind === 'category-edit') && panel) {
    const name = read('name');
    const key = kind === 'category-create' ? normalizeKey(name) : category!.key;
    if (key.length < 2) throw new Error('Informe um nome de categoria válido.');
    if (kind === 'category-create' && client.repository.listCategories(session.guildId, panel.key).some((item) => item.key === key)) throw new Error('Já existe uma categoria com este nome.');
    if (kind === 'category-create' && client.repository.listCategories(session.guildId, panel.key).length >= 25) throw new Error('Este painel já atingiu o limite de 25 categorias do Discord.');
    const previous = category;
    client.repository.upsertCategory({
      guildId: session.guildId, panelKey: panel.key, key, name, description: read('description'), emoji: read('emoji') || undefined,
      buttonStyle: previous?.buttonStyle ?? 'primary', staffRoleIds: previous?.staffRoleIds ?? [], allowedRoleIds: previous?.allowedRoleIds ?? [],
      channelNameTemplate: read('template'), welcomeMessage: read('welcome'), allowUserClose: previous?.allowUserClose ?? true,
      allowClaim: previous?.allowClaim ?? true, maxOpenPerUser: previous?.maxOpenPerUser ?? 1, questions: previous?.questions ?? [], enabled: previous?.enabled ?? true,
    });
    const next = adminConsoleSessions.update(session.id, { categoryKey: key, screen: 'category' })!;
    await interaction.reply({ ...await renderAdminConsole(next, client), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return true;
  }
  if (kind === 'category-limit' && category) {
    const limit = Number(read('limit'));
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('O limite deve ser um número inteiro entre 1 e 10.');
    updateCategory(client, category, { maxOpenPerUser: limit });
    const next = changeScreen(session, 'category-behaviour');
    await interaction.reply({ ...await renderAdminConsole(next, client), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return true;
  }
  if ((kind === 'question-create' || kind === 'question-edit') && category) {
    const id = normalizeKey(read('id'));
    const label = read('label');
    if (id.length < 2 || !label) throw new Error('Informe um ID e uma pergunta válidos.');
    const existing = category.questions.find((question) => question.id === session.questionId);
    if (kind === 'question-create' && (category.questions.length >= 5 || category.questions.some((question) => question.id === id))) throw new Error('O ID já existe ou o formulário já atingiu cinco perguntas.');
    if (kind === 'question-edit' && id !== session.questionId && category.questions.some((question) => question.id === id)) throw new Error('Já existe outra pergunta com esse ID.');
    const question: TicketQuestion = {
      id, label, placeholder: read('placeholder') || undefined,
      style: existing?.style ?? 'short', required: existing?.required ?? true,
      minLength: existing?.minLength, maxLength: existing?.maxLength,
    };
    const questions = kind === 'question-create'
      ? [...category.questions, question]
      : category.questions.map((item) => item.id === session.questionId ? question : item);
    updateCategory(client, category, { questions });
    const next = adminConsoleSessions.update(session.id, { questionId: id, screen: 'question' })!;
    await interaction.reply({ ...await renderAdminConsole(next, client), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return true;
  }
  if (kind === 'question-limits' && category && session.questionId) {
    const minText = read('min');
    const maxText = read('max');
    const minLength = minText ? Number(minText) : undefined;
    const maxLength = maxText ? Number(maxText) : undefined;
    if ((minLength !== undefined && (!Number.isInteger(minLength) || minLength < 0 || minLength > 4000))
      || (maxLength !== undefined && (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 4000))
      || (minLength !== undefined && maxLength !== undefined && minLength > maxLength)) throw new Error('Limites de caracteres inválidos.');
    updateCategory(client, category, { questions: category.questions.map((question) => question.id === session.questionId ? { ...question, minLength, maxLength } : question) });
    const next = changeScreen(session, 'question');
    await interaction.reply({ ...await renderAdminConsole(next, client), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return true;
  }
  if (kind === 'settings-color') {
    const value = normalizeHexColor(read('color'), '');
    if (!value) throw new Error('Cor inválida. Use o formato `#RRGGBB`.');
    client.repository.updateGuildSettings(session.guildId, { accentColor: value });
    const next = changeScreen(session, 'settings');
    await interaction.reply({ ...await renderAdminConsole(next, client), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return true;
  }
  throw new Error('Formulário administrativo desconhecido ou expirado.');
}
