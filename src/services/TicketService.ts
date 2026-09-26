import {
  ChannelType,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  PrivateThreadChannel,
  TextChannel,
  ThreadAutoArchiveDuration,
  User,
} from 'discord.js';
import { ForbiddenError, NotFoundError } from '../core/errors';
import { logger } from '../core/logger';
import { TicketRepository } from '../database/TicketRepository';
import { Ticket, TicketCategory } from '../domain/models';
import { buildLog, buildTicketStatus, buildTicketWelcome } from '../ui/components';
import { AuthorizationService } from './AuthorizationService';
import { TranscriptService } from './TranscriptService';

function channelName(template: string, ticket: Ticket): string {
  const rendered = template
    .replaceAll('{number}', String(ticket.ticketNumber).padStart(4, '0'))
    .replaceAll('{username}', ticket.username)
    .replaceAll('{userId}', ticket.userId)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (rendered || `ticket-${ticket.ticketNumber}`).slice(0, 90);
}

type TicketConversation = TextChannel | PrivateThreadChannel;

export class TicketService {
  public constructor(
    private readonly repository: TicketRepository,
    private readonly authorization: AuthorizationService,
    private readonly transcripts: TranscriptService,
  ) {}

  public async open(
    guild: Guild,
    user: User,
    panelKey: string,
    categoryKey: string,
    answers: Record<string, string>,
  ): Promise<Ticket> {
    const panel = this.repository.getPanel(guild.id, panelKey);
    const category = this.repository.getCategory(guild.id, panelKey, categoryKey);
    if (!panel.enabled || !category.enabled) throw new ForbiddenError('Esta categoria está desativada.');
    if (category.allowedRoleIds.length > 0) {
      const member = await guild.members.fetch(user.id);
      const isAllowed = category.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
      if (!isAllowed && !this.authorization.isStaff(member, category)) {
        throw new ForbiddenError('Você não possui um dos cargos necessários para abrir tickets nesta categoria. Consulte a equipe do servidor.');
      }
    }

    const ticket = this.repository.reserveTicket({
      guildId: guild.id,
      panelKey,
      categoryKey,
      userId: user.id,
      username: user.username,
      answers,
    });

    try {
      const created = panel.ticketMode === 'private-threads'
        ? await this.createPrivateThread(guild, panel.channelId, category, ticket, user)
        : await this.createPrivateChannel(guild, panel.parentCategoryId, category, ticket, user);
      const active = this.repository.activateTicket(ticket.id, created.id);
      const settings = this.repository.ensureGuild(guild.id);
      await created.send(buildTicketWelcome(active, category, settings));
      await this.sendLog(guild, 'aberto', active, user.id);
      return active;
    } catch (error) {
      this.repository.failTicket(ticket.id);
      logger.error('Falha ao criar atendimento de ticket', error, { guildId: guild.id, ticketId: ticket.id, mode: panel.ticketMode });
      throw error;
    }
  }

  public async claim(member: GuildMember, ticketId: number): Promise<Ticket> {
    const { ticket, category, channel } = await this.context(member.guild, ticketId);
    if (!this.authorization.isStaff(member, category)) throw new ForbiddenError('Somente a equipe de atendimento pode reivindicar tickets.');
    if (ticket.status === 'claimed') throw new ForbiddenError(`Este ticket já foi reivindicado por <@${ticket.claimedBy}>.`);
    if (ticket.status !== 'open') throw new ForbiddenError('Este ticket não está aberto.');
    const updated = this.repository.claimTicket(ticket.id, member.id);
    await channel.send(buildTicketStatus(updated, category, this.repository.ensureGuild(member.guild.id)));
    await this.sendLog(member.guild, 'reivindicado', updated, member.id);
    return updated;
  }

  public async unclaim(member: GuildMember, ticketId: number): Promise<Ticket> {
    const { ticket, category, channel } = await this.context(member.guild, ticketId);
    if (!this.authorization.isStaff(member, category)) throw new ForbiddenError('Somente a equipe pode liberar tickets.');
    if (ticket.status !== 'claimed') throw new ForbiddenError('Este ticket não está reivindicado.');
    if (ticket.claimedBy !== member.id && !this.authorization.isAdministrator(member)) {
      throw new ForbiddenError('Somente quem reivindicou ou um administrador pode liberar este ticket.');
    }
    const updated = this.repository.unclaimTicket(ticket.id);
    await channel.send(buildTicketStatus(updated, category, this.repository.ensureGuild(member.guild.id)));
    await this.sendLog(member.guild, 'liberado', updated, member.id);
    return updated;
  }

  public async close(member: GuildMember, ticketId: number, reason?: string): Promise<Ticket> {
    const { ticket, category, channel } = await this.context(member.guild, ticketId);
    const staff = this.authorization.isStaff(member, category);
    if (!staff && !(category.allowUserClose && ticket.userId === member.id)) {
      throw new ForbiddenError('Somente o autor autorizado ou a equipe pode fechar este ticket.');
    }
    if (!['open', 'claimed'].includes(ticket.status)) throw new ForbiddenError('Este ticket já está fechado.');

    await this.archiveTranscript(channel, ticket, member.id);
    const updated = this.repository.closeTicket(ticket.id, reason?.trim().slice(0, 500));
    await channel.send(buildTicketStatus(updated, category, this.repository.ensureGuild(member.guild.id)));
    if (channel.type === ChannelType.PrivateThread) {
      await channel.setLocked(true, `Ticket #${ticket.ticketNumber} fechado`);
      await channel.setArchived(true, `Ticket #${ticket.ticketNumber} fechado`);
    } else {
      await channel.permissionOverwrites.edit(ticket.userId, { SendMessages: false, AddReactions: false });
    }
    await this.sendLog(member.guild, 'fechado', updated, member.id);
    return updated;
  }

  public async reopen(member: GuildMember, ticketId: number): Promise<Ticket> {
    const { ticket, category, channel } = await this.context(member.guild, ticketId);
    if (!this.authorization.isStaff(member, category)) throw new ForbiddenError('Somente a equipe pode reabrir tickets.');
    if (ticket.status !== 'closed') throw new ForbiddenError('Este ticket não está fechado.');
    const updated = this.repository.reopenTicket(ticket.id);
    if (channel.type === ChannelType.PrivateThread) {
      await channel.setArchived(false, `Ticket #${ticket.ticketNumber} reaberto`);
      await channel.setLocked(false, `Ticket #${ticket.ticketNumber} reaberto`);
    } else {
      await channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    }
    await channel.send(buildTicketStatus(updated, category, this.repository.ensureGuild(member.guild.id)));
    await this.sendLog(member.guild, 'reaberto', updated, member.id);
    return updated;
  }

  public async deleteChannel(member: GuildMember, ticketId: number): Promise<void> {
    const { ticket, category, channel } = await this.context(member.guild, ticketId);
    if (!this.authorization.isStaff(member, category)) throw new ForbiddenError('Somente a equipe pode excluir canais de ticket.');
    if (ticket.status !== 'closed') throw new ForbiddenError('Feche o ticket antes de excluir o canal.');
    await this.archiveTranscript(channel, ticket, member.id);
    await this.sendLog(member.guild, 'excluído', ticket, member.id);
    await channel.delete(`Ticket #${ticket.ticketNumber} excluído por ${member.user.tag}`);
  }

  public async addParticipantToTicket(member: GuildMember, ticketId: number, user: User): Promise<void> {
    const { ticket, category, channel } = await this.context(member.guild, ticketId);
    if (!this.authorization.isStaff(member, category)) throw new ForbiddenError('Somente a equipe pode adicionar participantes.');
    if (ticket.status === 'closed') throw new ForbiddenError('O ticket está fechado.');
    if (channel.type === ChannelType.PrivateThread) await channel.members.add(user.id);
    else await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
    this.repository.addParticipant(ticket.id, user.id);
  }

  public async removeParticipantFromTicket(member: GuildMember, ticketId: number, user: User): Promise<void> {
    const { ticket, category, channel } = await this.context(member.guild, ticketId);
    if (!this.authorization.isStaff(member, category)) throw new ForbiddenError('Somente a equipe pode remover participantes.');
    if (user.id === ticket.userId) throw new ForbiddenError('O criador do ticket não pode ser removido.');
    if (channel.type === ChannelType.PrivateThread) await channel.members.remove(user.id);
    else await channel.permissionOverwrites.delete(user.id);
    this.repository.removeParticipant(ticket.id, user.id);
  }

  public async transcript(member: GuildMember, ticketId: number) {
    const { ticket, category, channel } = await this.context(member.guild, ticketId);
    if (!this.authorization.isStaff(member, category) && ticket.userId !== member.id) throw new ForbiddenError();
    return this.transcripts.create(channel, ticket);
  }

  public async ticketFromChannel(guild: Guild, channelId: string): Promise<Ticket> {
    return this.repository.getTicketByChannel(guild.id, channelId);
  }

  private async context(guild: Guild, ticketId: number): Promise<{ ticket: Ticket; category: TicketCategory; channel: TicketConversation }> {
    const ticket = this.repository.getTicketById(ticketId);
    if (ticket.guildId !== guild.id) throw new NotFoundError('Ticket');
    const category = this.repository.getCategory(guild.id, ticket.panelKey, ticket.categoryKey);
    if (!ticket.channelId) throw new NotFoundError('Canal do ticket');
    const fetched = await guild.channels.fetch(ticket.channelId);
    if (!fetched || (fetched.type !== ChannelType.GuildText && fetched.type !== ChannelType.PrivateThread)) throw new NotFoundError('Canal do ticket');
    return { ticket, category, channel: fetched as TicketConversation };
  }

  private async archiveTranscript(channel: TicketConversation, ticket: Ticket, actorId: string): Promise<void> {
    const settings = this.repository.ensureGuild(channel.guild.id);
    if (!settings.transcriptChannelId) return;
    try {
      const destination = await channel.guild.channels.fetch(settings.transcriptChannelId);
      if (!destination?.isTextBased() || destination.isDMBased()) return;
      const attachment = await this.transcripts.create(channel, ticket);
      await destination.send({ content: `📄 Ticket #${ticket.ticketNumber} • <@${ticket.userId}> • ação por <@${actorId}>`, files: [attachment], allowedMentions: { parse: [] } });
    } catch (error) {
      logger.error('Falha ao arquivar transcrição', error, { guildId: channel.guild.id, ticketId: ticket.id });
    }
  }

  private async sendLog(guild: Guild, action: string, ticket: Ticket, actorId: string): Promise<void> {
    const settings = this.repository.ensureGuild(guild.id);
    if (!settings.logChannelId) return;
    try {
      const channel = await guild.channels.fetch(settings.logChannelId);
      if (channel?.isTextBased() && !channel.isDMBased()) await channel.send(buildLog(action, ticket, actorId, settings));
    } catch (error) {
      logger.error('Falha ao enviar log', error, { guildId: guild.id, ticketId: ticket.id, action });
    }
  }

  private async createPrivateChannel(
    guild: Guild,
    parentCategoryId: string,
    category: TicketCategory,
    ticket: Ticket,
    user: User,
  ): Promise<TextChannel> {
    const me = guild.members.me ?? await guild.members.fetchMe();
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: me.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
      },
      {
        id: user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
      },
      ...category.staffRoleIds.map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageMessages],
      })),
    ];
    return guild.channels.create({
      name: channelName(category.channelNameTemplate, ticket),
      type: ChannelType.GuildText,
      parent: parentCategoryId,
      topic: `Ticket #${ticket.ticketNumber} | user:${ticket.userId} | ${ticket.panelKey}/${ticket.categoryKey}`,
      permissionOverwrites: overwrites,
      reason: `Ticket #${ticket.ticketNumber} aberto por ${user.tag}`,
    });
  }

  private async createPrivateThread(
    guild: Guild,
    parentChannelId: string,
    category: TicketCategory,
    ticket: Ticket,
    user: User,
  ): Promise<PrivateThreadChannel> {
    const parent = await guild.channels.fetch(parentChannelId);
    if (parent?.type !== ChannelType.GuildText) throw new NotFoundError('Canal pai das threads privadas');
    const me = guild.members.me ?? await guild.members.fetchMe();
    const required = [
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.ManageThreads,
    ];
    if (!required.every((permission) => parent.permissionsFor(me).has(permission))) {
      throw new ForbiddenError('O bot precisa de Criar threads privadas, Enviar mensagens em threads e Gerenciar threads no canal do painel.');
    }
    const thread = await parent.threads.create({
      name: channelName(category.channelNameTemplate || 'ticket-{number}-{username}', ticket),
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Ticket #${ticket.ticketNumber} aberto por ${user.tag}`,
    });
    await thread.members.add(user.id);
    if (thread.type !== ChannelType.PrivateThread) throw new Error('Discord did not create a private ticket thread.');
    return thread as PrivateThreadChannel;
  }
}
