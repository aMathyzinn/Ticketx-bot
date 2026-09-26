import {
  ActionRowBuilder, AutocompleteInteraction, ButtonInteraction, Events, GuildMember, Interaction, MessageFlags, ModalBuilder,
  ModalSubmitInteraction, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { CategoryModalSession } from '../commands/categoria';
import { PanelModalSession } from '../commands/painel';
import { QuestionModalSession } from '../commands/formulario';
import { DomainError, ForbiddenError } from '../core/errors';
import { logger } from '../core/logger';
import { normalizeHexColor } from '../domain/models';
import { adminSessions } from '../services/AdminSessionStore';
import { handleAdminConsoleButton, handleAdminConsoleModal, handleAdminConsoleSelect } from '../services/AdminConsoleController';

interface TicketOpenSession {
  guildId: string;
  userId: string;
  panelKey: string;
  categoryKey: string;
}

interface TicketActionSession {
  guildId: string;
  userId: string;
  ticketId: number;
}

export const name = Events.InteractionCreate;
export const once = false;

export async function execute(interaction: Interaction, client: TicketBotClient): Promise<void> {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction, client);
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        // A command can be registered with Discord before every running
        // instance has received the release that implements it. Never leave
        // that interaction unanswered: Discord invalidates it after 3s.
        logger.warn('Comando recebido sem handler carregado', {
          interactionId: interaction.id,
          guildId: interaction.guildId,
          command: interaction.commandName,
        });
        await interaction.reply({
          content: '⚠️ Este comando ainda não está disponível na instância ativa do bot. Reinicie ou republice o bot e tente novamente.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await command.execute(interaction, client);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (await handleAdminConsoleSelect(interaction, client)) return;
    }

    if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
      if (await handleAdminConsoleSelect(interaction, client)) return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('panel:open:')) {
      const [, , panelKey] = interaction.customId.split(':');
      await beginTicketOpen(interaction, client, panelKey ?? '', interaction.values[0] ?? '');
      return;
    }

    if (interaction.isButton()) {
      if (await handleAdminConsoleButton(interaction, client)) return;
      if (interaction.customId.startsWith('panel:open:')) {
        const [, , panelKey, categoryKey] = interaction.customId.split(':');
        await beginTicketOpen(interaction, client, panelKey ?? '', categoryKey ?? '');
        return;
      }
      if (interaction.customId.startsWith('ticket:')) {
        await handleTicketButton(interaction, client);
        return;
      }
      if (interaction.customId.startsWith('admin:panel-delete:')) {
        const sessionId = interaction.customId.split(':')[2] ?? '';
        const session = adminSessions.consume<{ kind: 'panel-delete'; guildId: string; key: string }>(sessionId);
        if (!session || interaction.guildId !== session.guildId) throw new Error('Confirmação expirada. Execute o comando novamente.');
        client.panels.delete(session.guildId, session.key);
        await interaction.update({ content: `✅ Painel \`${session.key}\` excluído.`, components: [] });
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (await handleAdminConsoleModal(interaction, client)) return;
      if (interaction.customId.startsWith('admin:panel:')) await handlePanelModal(interaction, client);
      else if (interaction.customId.startsWith('admin:category:')) await handleCategoryModal(interaction, client);
      else if (interaction.customId.startsWith('admin:question:')) await handleQuestionModal(interaction, client);
      else if (interaction.customId.startsWith('ticket:form:')) await handleTicketForm(interaction, client);
      else if (interaction.customId.startsWith('ticket:close-form:')) await handleCloseForm(interaction, client);
    }
  } catch (error) {
    await reportError(interaction, error);
    if (!(error instanceof DomainError)) {
      logger.error('Erro ao processar interação', error, {
        interactionId: interaction.id,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        type: interaction.type,
      });
    }
  }
}

/**
 * Autocomplete callbacks have a very short Discord deadline and cannot use a
 * normal ephemeral reply. Always acknowledge them, including on an internal
 * lookup failure, so the client never stays in the generic loading-error state.
 */
async function handleAutocomplete(interaction: AutocompleteInteraction, client: TicketBotClient): Promise<void> {
  try {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) await command.autocomplete(interaction, client);
    if (!interaction.responded) await interaction.respond([]);
  } catch (error) {
    logger.error('Falha no autocomplete', error, {
      interactionId: interaction.id,
      guildId: interaction.guildId,
      command: interaction.commandName,
    });
    if (!interaction.responded) {
      await interaction.respond([]).catch((responseError) => {
        logger.error('Falha ao responder autocomplete vazio', responseError, {
          interactionId: interaction.id,
          command: interaction.commandName,
        });
      });
    }
  }
}

async function beginTicketOpen(interaction: ButtonInteraction | any, client: TicketBotClient, panelKey: string, categoryKey: string): Promise<void> {
  if (!interaction.inCachedGuild()) throw new ForbiddenError('Tickets só podem ser abertos em servidores.');
  const category = client.repository.getCategory(interaction.guildId, panelKey, categoryKey);
  if (category.allowedRoleIds.length > 0) {
    const member = interaction.member instanceof GuildMember
      ? interaction.member
      : await interaction.guild.members.fetch(interaction.user.id);
    const isAllowed = category.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
    if (!isAllowed && !client.authorization.isStaff(member, category)) {
      throw new ForbiddenError('Você não possui um dos cargos necessários para abrir tickets nesta categoria. Consulte a equipe do servidor.');
    }
  }
  if (category.questions.length === 0) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ticket = await client.tickets.open(interaction.guild, interaction.user, panelKey, categoryKey, {});
    await interaction.editReply(`✅ Ticket criado em <#${ticket.channelId}>.`);
    return;
  }
  const sessionId = adminSessions.create<TicketOpenSession>({ guildId: interaction.guildId, userId: interaction.user.id, panelKey, categoryKey });
  const modal = new ModalBuilder().setCustomId(`ticket:form:${sessionId}`).setTitle(`Abrir ticket — ${category.name}`);
  for (const question of category.questions.slice(0, 5)) {
    const input = new TextInputBuilder().setCustomId(question.id).setLabel(question.label).setRequired(question.required)
      .setStyle(question.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short);
    if (question.placeholder) input.setPlaceholder(question.placeholder);
    if (question.minLength) input.setMinLength(question.minLength);
    if (question.maxLength) input.setMaxLength(question.maxLength);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  await interaction.showModal(modal);
}

async function handleTicketForm(interaction: ModalSubmitInteraction, client: TicketBotClient): Promise<void> {
  const sessionId = interaction.customId.split(':')[2] ?? '';
  const session = adminSessions.consume<TicketOpenSession>(sessionId);
  if (!session || interaction.guildId !== session.guildId || interaction.user.id !== session.userId || !interaction.inCachedGuild()) {
    throw new Error('Formulário expirado. Abra o painel novamente.');
  }
  const category = client.repository.getCategory(session.guildId, session.panelKey, session.categoryKey);
  const answers: Record<string, string> = {};
  for (const question of category.questions) {
    const value = interaction.fields.getTextInputValue(question.id).trim();
    if (value) answers[question.label] = value;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ticket = await client.tickets.open(interaction.guild, interaction.user, session.panelKey, session.categoryKey, answers);
  await interaction.editReply(`✅ Ticket criado em <#${ticket.channelId}>.`);
}

async function handleTicketButton(interaction: ButtonInteraction, client: TicketBotClient): Promise<void> {
  if (!interaction.inCachedGuild() || !(interaction.member instanceof GuildMember)) throw new ForbiddenError();
  const [, action, id] = interaction.customId.split(':');
  const ticketId = Number(id);
  if (!Number.isSafeInteger(ticketId)) throw new Error('Ticket inválido.');

  if (action === 'close') {
    const sessionId = adminSessions.create<TicketActionSession>({ guildId: interaction.guildId, userId: interaction.user.id, ticketId });
    const modal = new ModalBuilder().setCustomId(`ticket:close-form:${sessionId}`).setTitle('Confirmar fechamento').addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('reason').setLabel('Motivo (opcional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (action === 'claim') {
    await client.tickets.claim(interaction.member, ticketId);
    await interaction.editReply('✅ Você assumiu este atendimento.');
  } else if (action === 'unclaim') {
    await client.tickets.unclaim(interaction.member, ticketId);
    await interaction.editReply('✅ Atendimento liberado.');
  } else if (action === 'reopen') {
    await client.tickets.reopen(interaction.member, ticketId);
    await interaction.editReply('✅ Ticket reaberto.');
  } else if (action === 'delete') {
    await interaction.editReply('🗑️ Excluindo canal…');
    await client.tickets.deleteChannel(interaction.member, ticketId);
  }
}

async function handleCloseForm(interaction: ModalSubmitInteraction, client: TicketBotClient): Promise<void> {
  const sessionId = interaction.customId.split(':')[2] ?? '';
  const session = adminSessions.consume<TicketActionSession>(sessionId);
  if (!session || !interaction.inCachedGuild() || !(interaction.member instanceof GuildMember)
    || interaction.guildId !== session.guildId || interaction.user.id !== session.userId) throw new Error('Confirmação expirada.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reason = interaction.fields.getTextInputValue('reason');
  await client.tickets.close(interaction.member, session.ticketId, reason || undefined);
  await interaction.editReply('✅ Ticket fechado.');
}

async function handlePanelModal(interaction: ModalSubmitInteraction, client: TicketBotClient): Promise<void> {
  const session = adminSessions.consume<PanelModalSession>(interaction.customId.split(':')[2] ?? '');
  if (!session || interaction.guildId !== session.guildId) throw new Error('Formulário expirado.');
  const existing = session.kind === 'panel-edit' ? client.repository.getPanel(session.guildId, session.key) : undefined;
  client.repository.upsertPanel({
    guildId: session.guildId, key: session.key, channelId: session.channelId, parentCategoryId: session.parentCategoryId,
    ticketMode: session.ticketMode ?? existing?.ticketMode ?? 'channels', style: session.style, title: interaction.fields.getTextInputValue('title').trim(),
    description: interaction.fields.getTextInputValue('description').trim(),
    color: normalizeHexColor(interaction.fields.getTextInputValue('color')),
    bannerUrl: interaction.fields.getTextInputValue('banner').trim() || undefined,
    thumbnailUrl: existing?.thumbnailUrl, footer: interaction.fields.getTextInputValue('footer').trim() || undefined,
    messageId: existing?.messageId, enabled: true,
  });
  await interaction.reply({ content: `✅ Painel \`${session.key}\` salvo. Agora crie categorias com \`/categoria criar\`.`, flags: MessageFlags.Ephemeral });
}

async function handleCategoryModal(interaction: ModalSubmitInteraction, client: TicketBotClient): Promise<void> {
  const session = adminSessions.consume<CategoryModalSession>(interaction.customId.split(':')[2] ?? '');
  if (!session || interaction.guildId !== session.guildId) throw new Error('Formulário expirado.');
  const existing = session.kind === 'category-edit' ? client.repository.getCategory(session.guildId, session.panelKey, session.key) : undefined;
  client.repository.upsertCategory({
    guildId: session.guildId, panelKey: session.panelKey, key: session.key,
    name: interaction.fields.getTextInputValue('name').trim(),
    description: interaction.fields.getTextInputValue('description').trim(),
    emoji: interaction.fields.getTextInputValue('emoji').trim() || undefined,
    buttonStyle: session.buttonStyle, staffRoleIds: session.staffRoleIds,
    allowedRoleIds: existing?.allowedRoleIds ?? [],
    channelNameTemplate: interaction.fields.getTextInputValue('template').trim(),
    welcomeMessage: interaction.fields.getTextInputValue('welcome').trim(),
    allowUserClose: session.allowUserClose, allowClaim: session.allowClaim,
    maxOpenPerUser: session.maxOpenPerUser, questions: existing?.questions ?? [], enabled: true,
  });
  await interaction.reply({ content: `✅ Categoria \`${session.key}\` salva. Use \`/formulario adicionar\` para incluir perguntas.`, flags: MessageFlags.Ephemeral });
}

async function handleQuestionModal(interaction: ModalSubmitInteraction, client: TicketBotClient): Promise<void> {
  const session = adminSessions.consume<QuestionModalSession>(interaction.customId.split(':')[2] ?? '');
  if (!session || interaction.guildId !== session.guildId) throw new Error('Formulário expirado.');
  const category = client.repository.getCategory(session.guildId, session.panelKey, session.categoryKey);
  const minRaw = interaction.fields.getTextInputValue('min').trim();
  const maxRaw = interaction.fields.getTextInputValue('max').trim();
  const minLength = minRaw ? Number(minRaw) : undefined;
  const maxLength = maxRaw ? Number(maxRaw) : undefined;
  if ((minLength !== undefined && (!Number.isInteger(minLength) || minLength < 0))
    || (maxLength !== undefined && (!Number.isInteger(maxLength) || maxLength > 4000))
    || (minLength !== undefined && maxLength !== undefined && minLength > maxLength)) throw new Error('Limites de caracteres inválidos.');
  client.repository.setQuestions(session.guildId, session.panelKey, session.categoryKey, [...category.questions, {
    id: session.id, label: interaction.fields.getTextInputValue('label').trim(), style: session.style,
    placeholder: interaction.fields.getTextInputValue('placeholder').trim() || undefined,
    required: session.required, minLength, maxLength,
  }]);
  await interaction.reply({ content: `✅ Pergunta \`${session.id}\` adicionada.`, flags: MessageFlags.Ephemeral });
}

async function reportError(interaction: Interaction, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Erro inesperado ao processar a ação.';
  if (!interaction.isRepliable()) return;
  const payload = { content: `❌ ${message}`, flags: MessageFlags.Ephemeral } as const;
  if (interaction.deferred) await interaction.editReply({ content: payload.content }).catch(() => undefined);
  else if (interaction.replied) await interaction.followUp(payload).catch(() => undefined);
  else await interaction.reply(payload).catch(() => undefined);
}
