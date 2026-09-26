import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';
import { GuildSettings, Panel, Ticket, TicketCategory, TicketStats } from '../domain/models';

export interface V2Message {
  components: any[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions?: { users?: string[]; roles?: string[]; parse?: never[] };
}

function color(value: string): number {
  return Number.parseInt(value.replace('#', ''), 16);
}

function style(value: TicketCategory['buttonStyle']): ButtonStyle {
  return { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger }[value];
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);
}

function trim(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function buildPanel(panel: Panel, categories: TicketCategory[]): V2Message {
  const container = new ContainerBuilder().setAccentColor(color(panel.color));
  if (panel.bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(panel.bannerUrl)),
    );
    container.addSeparatorComponents(separator());
  }

  if (panel.thumbnailUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${trim(panel.title, 250)}`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(panel.thumbnailUrl)),
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${trim(panel.title, 250)}`));
  }
  container.addSeparatorComponents(separator());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(trim(panel.description, 4000)));
  if (panel.footer) {
    container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${trim(panel.footer, 1000)}`));
  }

  const rows: ActionRowBuilder<any>[] = [];
  if (panel.style === 'select') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`panel:open:${panel.key}`)
      .setPlaceholder('Selecione / Choose a category…')
      .addOptions(categories.slice(0, 25).map((category) => {
        const option = new StringSelectMenuOptionBuilder()
          .setLabel(trim(category.name, 100))
          .setDescription(trim(category.description || 'Abrir ticket', 100))
          .setValue(category.key);
        if (category.emoji) option.setEmoji(category.emoji);
        return option;
      }));
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  } else {
    const buttons = categories.slice(0, 25).map((category) => {
      const button = new ButtonBuilder()
        .setCustomId(`panel:open:${panel.key}:${category.key}`)
        .setLabel(trim(category.name, 80))
        .setStyle(style(category.buttonStyle));
      if (category.emoji) button.setEmoji(category.emoji);
      return button;
    });
    for (let index = 0; index < buttons.length; index += 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 5)));
    }
  }

  container.addActionRowComponents(...rows);
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export function buildTicketWelcome(ticket: Ticket, category: TicketCategory, settings: GuildSettings): V2Message {
  const container = new ContainerBuilder().setAccentColor(color(settings.accentColor));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 🎫 Ticket #${String(ticket.ticketNumber).padStart(4, '0')} — ${category.name}`),
  );
  container.addSeparatorComponents(separator());
  const welcome = category.welcomeMessage
    .replaceAll('{mention}', `<@${ticket.userId}>`)
    .replaceAll('{username}', ticket.username)
    .replaceAll('{ticketId}', String(ticket.ticketNumber).padStart(4, '0'))
    .replaceAll('{category}', category.name);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(trim(welcome, 4000)));

  const answers = Object.entries(ticket.answers);
  if (answers.length > 0) {
    container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('### 📋 Informações fornecidas'));
    for (const [label, answer] of answers) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${trim(label, 100)}**\n${trim(answer, 1500)}`));
    }
  }
  container.addSeparatorComponents(separator());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Aberto por <@${ticket.userId}> • ${new Date(ticket.createdAt).toLocaleString('pt-BR')}`),
  );

  const actions = new ActionRowBuilder<ButtonBuilder>();
  if (category.allowClaim) {
    actions.addComponents(
      new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel('Reivindicar').setEmoji('✋').setStyle(ButtonStyle.Success),
    );
  }
  actions.addComponents(
    new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Fechar').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
  container.addActionRowComponents(actions);
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [ticket.userId], roles: category.staffRoleIds, parse: [] },
  };
}

export function buildTicketStatus(ticket: Ticket, category: TicketCategory, settings: GuildSettings): V2Message {
  const status = ticket.status === 'claimed' ? `Reivindicado por <@${ticket.claimedBy}>` : ticket.status === 'closed' ? 'Fechado' : 'Aguardando atendimento';
  const container = new ContainerBuilder().setAccentColor(color(ticket.status === 'closed' ? '#ED4245' : settings.accentColor));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 🎫 Ticket #${String(ticket.ticketNumber).padStart(4, '0')} — ${category.name}`),
    new TextDisplayBuilder().setContent(`**Status:** ${status}\n**Criado por:** <@${ticket.userId}>${ticket.closeReason ? `\n**Motivo:** ${ticket.closeReason}` : ''}`),
  );
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (ticket.status === 'closed') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`ticket:reopen:${ticket.id}`).setLabel('Reabrir').setEmoji('🔓').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ticket:delete:${ticket.id}`).setLabel('Excluir ticket').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    );
  } else {
    if (category.allowClaim) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:${ticket.status === 'claimed' ? 'unclaim' : 'claim'}:${ticket.id}`)
          .setLabel(ticket.status === 'claimed' ? 'Liberar' : 'Reivindicar')
          .setStyle(ButtonStyle.Success),
      );
    }
    row.addComponents(new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Fechar').setStyle(ButtonStyle.Danger));
  }
  container.addActionRowComponents(row);
  const mentionedUsers = [...new Set([ticket.userId, ...(ticket.claimedBy ? [ticket.claimedBy] : [])])];
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { users: mentionedUsers, parse: [] } };
}

export function buildLog(action: string, ticket: Ticket, actorId: string, settings: GuildSettings): V2Message {
  const container = new ContainerBuilder().setAccentColor(color(settings.accentColor));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 📜 Ticket ${action}`),
    new TextDisplayBuilder().setContent(
      `**Ticket:** #${String(ticket.ticketNumber).padStart(4, '0')}\n**Usuário:** <@${ticket.userId}>\n**Canal:** ${ticket.channelId ? `<#${ticket.channelId}>` : 'indisponível'}\n**Responsável pela ação:** <@${actorId}>\n**Horário:** ${new Date().toLocaleString('pt-BR')}`,
    ),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export function buildPanelList(panels: Panel[], categoryCounts: Map<string, number>, settings: GuildSettings): V2Message {
  const container = new ContainerBuilder().setAccentColor(color(settings.accentColor));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 📋 Painéis de tickets'));
  if (panels.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Nenhum painel configurado. Use `/painel criar`.'));
  } else {
    for (const panel of panels) {
      container.addSeparatorComponents(separator());
      const modeLabel = panel.ticketMode === 'private-threads' ? 'Threads privadas' : 'Canais';
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `**${panel.title}** — \`${panel.key}\`\n<#${panel.channelId}> • ${panel.style === 'select' ? 'Menu' : 'Botões'} • ${modeLabel} • ${categoryCounts.get(panel.key) ?? 0} categoria(s) • ${panel.messageId ? '🟢 Publicado' : '🟡 Rascunho'}`,
      ));
    }
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export function buildStats(stats: TicketStats, settings: GuildSettings): V2Message {
  const container = new ContainerBuilder().setAccentColor(color(settings.accentColor));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## 📊 Estatísticas de tickets'),
    new TextDisplayBuilder().setContent(`🟢 **Abertos:** ${stats.open}\n✋ **Reivindicados:** ${stats.claimed}\n🔒 **Fechados:** ${stats.closed}\n🗂️ **Total:** ${stats.total}`),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}
