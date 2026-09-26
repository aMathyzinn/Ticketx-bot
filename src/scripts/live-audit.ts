import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { env } from '../config/env';
import { TicketRepository } from '../database/TicketRepository';
import { AdminConsoleScreen, adminConsoleSessions } from '../services/AdminConsoleStore';
import { renderAdminConsole } from '../services/AdminConsoleController';
import { buildAdminLauncher } from '../ui/adminConsole';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  assert(env.guildId, 'GUILD_ID é obrigatório para a auditoria ao vivo.');
  const repository = new TicketRepository(':memory:');
  const client = new TicketBotClient(repository);
  const temporaryChannelIds = new Set<string>();
  try {
    await client.login(env.token);
    const guild = await client.guilds.fetch(env.guildId);
    const fullGuild = await guild.fetch();
    const existingChannels = await fullGuild.channels.fetch();
    const staleCategories = existingChannels.filter((channel) => channel?.type === ChannelType.GuildCategory && /^audit-tickets-\d{6}$/.test(channel.name));
    for (const stale of staleCategories.values()) {
      if (!stale) continue;
      for (const child of existingChannels.filter((channel) => channel?.parentId === stale.id).values()) {
        await child?.delete('Limpeza de auditoria anterior interrompida').catch(() => undefined);
      }
      await stale.delete('Limpeza de auditoria anterior interrompida').catch(() => undefined);
    }
    const me = await fullGuild.members.fetchMe();
    const required = [
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.ManageThreads,
    ];
    assert(required.every((permission) => me.permissions.has(permission)), 'O bot não possui todas as permissões necessárias.');
    console.log(JSON.stringify({ step: 'permissions', ok: true }));
    const guildCommands = await fullGuild.commands.fetch();
    const globalCommands = await client.application!.commands.fetch();
    const commandNames = new Set([...guildCommands.values(), ...globalCommands.values()].map((command) => command.name));
    assert(commandNames.has('admin') && commandNames.has('admin-instalar'), 'Os comandos da central administrativa não foram registrados.');
    console.log(JSON.stringify({ step: 'commands', ok: true }));

    const categoryChannel = await fullGuild.channels.create({
      name: `audit-tickets-${Date.now().toString().slice(-6)}`,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: fullGuild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.SendMessages] },
      ],
      reason: 'Auditoria automatizada end-to-end do bot de tickets',
    });
    temporaryChannelIds.add(categoryChannel.id);
    const panelChannel = await fullGuild.channels.create({
      name: 'audit-painel', type: ChannelType.GuildText, parent: categoryChannel.id,
      reason: 'Auditoria automatizada end-to-end do bot de tickets',
    });
    temporaryChannelIds.add(panelChannel.id);

    repository.ensureGuild(fullGuild.id);
    const panel = repository.upsertPanel({
      guildId: fullGuild.id, key: 'audit', channelId: panelChannel.id, parentCategoryId: categoryChannel.id,
      ticketMode: 'channels', style: 'buttons', title: 'Auditoria E2E', description: 'Painel temporário de teste', color: '#5865F2', enabled: true,
    });
    const ticketCategory = repository.upsertCategory({
      guildId: fullGuild.id, panelKey: panel.key, key: 'test', name: 'Teste', description: 'Fluxo end-to-end',
      emoji: '🧪', buttonStyle: 'primary', staffRoleIds: [], allowedRoleIds: [], channelNameTemplate: 'audit-{number}-{username}',
      welcomeMessage: 'Teste automatizado para {mention}.', allowUserClose: true, allowClaim: true,
      maxOpenPerUser: 2, questions: [], enabled: true,
    });
    const publishedPanel = await client.panels.publish(fullGuild, panel.key);
    assert(publishedPanel.messageId, 'A publicação do painel não retornou mensagem.');
    const panelMessage = await panelChannel.messages.fetch(publishedPanel.messageId);
    assert(panelMessage.flags.has(MessageFlags.IsComponentsV2), 'A mensagem do painel não foi aceita como Components V2.');
    const republishedPanel = await client.panels.publish(fullGuild, panel.key);
    assert(republishedPanel.messageId === publishedPanel.messageId, 'A republicação deveria editar a mensagem existente.');
    console.log(JSON.stringify({ step: 'panel-management', ok: true }));

    repository.setQuestions(fullGuild.id, panel.key, ticketCategory.key, [{ id: 'context', label: 'Contexto', style: 'short', required: false }]);
    const adminSession = adminConsoleSessions.create({
      guildId: fullGuild.id, userId: me.id, screen: 'home', page: 0, panelKey: panel.key, categoryKey: ticketCategory.key, questionId: 'context',
    });
    const consoleScreens: AdminConsoleScreen[] = [
      'home', 'panels', 'panel', 'appearance', 'route', 'route-channel', 'route-category', 'route-mode', 'categories', 'category',
      'category-access', 'category-team', 'category-behaviour', 'forms', 'question', 'settings', 'settings-logs', 'settings-transcripts',
      'settings-admins', 'diagnostics', 'confirm-delete-panel', 'confirm-delete-category', 'confirm-delete-question',
    ];
    for (const screen of consoleScreens) {
      const active = adminConsoleSessions.update(adminSession.id, { screen });
      assert(active, `A sessão administrativa expirou em ${screen}.`);
      const adminMessage = await panelChannel.send(await renderAdminConsole(active, client));
      assert(adminMessage.flags.has(MessageFlags.IsComponentsV2), `A tela administrativa ${screen} não foi aceita como Components V2.`);
    }
    const launcherMessage = await panelChannel.send(buildAdminLauncher(repository.ensureGuild(fullGuild.id)));
    assert(launcherMessage.flags.has(MessageFlags.IsComponentsV2), 'O launcher administrativo não foi aceito como Components V2.');
    console.log(JSON.stringify({ step: 'admin-console-components', ok: true }));

    let ticket = await client.tickets.open(fullGuild, client.user!, panel.key, ticketCategory.key, { Cenário: 'Auditoria canais' });
    assert(ticket.channelId, 'O canal do ticket não foi criado.');
    temporaryChannelIds.add(ticket.channelId);
    console.log(JSON.stringify({ step: 'open-channel', ok: true }));
    ticket = await client.tickets.claim(me, ticket.id);
    assert(ticket.status === 'claimed' && ticket.claimedBy === me.id, 'Claim não foi persistido.');
    ticket = await client.tickets.unclaim(me, ticket.id);
    assert(ticket.status === 'open', 'Unclaim não retornou o ticket para aberto.');
    ticket = await client.tickets.close(me, ticket.id, 'Auditoria fechamento canal');
    assert(ticket.status === 'closed', 'Fechamento não foi persistido.');
    ticket = await client.tickets.reopen(me, ticket.id);
    assert(ticket.status === 'open', 'Reabertura não foi persistida.');
    const transcript = await client.tickets.transcript(me, ticket.id);
    assert(transcript.attachment instanceof Buffer && transcript.attachment.length > 100, 'Transcrição HTML vazia.');
    ticket = await client.tickets.close(me, ticket.id, 'Fim canal');
    await client.tickets.deleteChannel(me, ticket.id);
    temporaryChannelIds.delete(ticket.channelId!);
    console.log(JSON.stringify({ step: 'channel-lifecycle', ok: true }));

    // Teste de threads privadas
    repository.upsertPanel({
      ...panel,
      ticketMode: 'private-threads',
    });
    let threadTicket = await client.tickets.open(fullGuild, client.user!, panel.key, ticketCategory.key, { Cenário: 'Auditoria private-threads' });
    assert(threadTicket.channelId, 'A thread privada do ticket não foi criada.');
    temporaryChannelIds.add(threadTicket.channelId);
    const thread = await fullGuild.channels.fetch(threadTicket.channelId);
    assert(thread?.type === ChannelType.PrivateThread, 'O canal criado não é uma thread privada.');
    console.log(JSON.stringify({ step: 'open-thread', ok: true }));
    threadTicket = await client.tickets.claim(me, threadTicket.id);
    assert(threadTicket.status === 'claimed', 'Claim da thread falhou.');
    threadTicket = await client.tickets.unclaim(me, threadTicket.id);
    assert(threadTicket.status === 'open', 'Unclaim da thread falhou.');
    threadTicket = await client.tickets.close(me, threadTicket.id, 'Auditoria fechamento thread');
    assert(threadTicket.status === 'closed', 'Fechamento da thread falhou.');
    threadTicket = await client.tickets.reopen(me, threadTicket.id);
    assert(threadTicket.status === 'open', 'Reabertura da thread falhou.');
    const threadTranscript = await client.tickets.transcript(me, threadTicket.id);
    assert(threadTranscript.attachment instanceof Buffer && threadTranscript.attachment.length > 100, 'Transcrição da thread vazia.');
    threadTicket = await client.tickets.close(me, threadTicket.id, 'Fim thread');
    await client.tickets.deleteChannel(me, threadTicket.id);
    temporaryChannelIds.delete(threadTicket.channelId!);
    console.log(JSON.stringify({ step: 'thread-lifecycle', ok: true }));

    console.log(JSON.stringify({
      ok: true,
      checks: [
        'permissions',
        'commands',
        'panel-management',
        'admin-console-components',
        'channel-lifecycle',
        'thread-lifecycle',
      ],
      commands: [...commandNames].sort(),
    }));
  } finally {
    if (env.guildId && client.isReady()) {
      const guild = client.guilds.cache.get(env.guildId);
      for (const channelId of [...temporaryChannelIds]) {
        const channel = await guild?.channels.fetch(channelId).catch(() => null);
        await channel?.delete('Limpeza da auditoria automatizada').catch(() => undefined);
      }
    }
    client.destroy();
    repository.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
