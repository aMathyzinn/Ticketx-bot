import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MessageFlags } from 'discord.js';
import { GuildSettings, Panel, Ticket, TicketCategory } from '../src/domain/models';
import { buildPanel, buildTicketStatus, buildTicketWelcome } from '../src/ui/components';

const panel: Panel = {
  guildId: '1', key: 'support', channelId: '2', parentCategoryId: '3', ticketMode: 'channels', style: 'buttons', title: 'Support',
  description: 'Choose', color: '#5865F2', enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
const category: TicketCategory = {
  guildId: '1', panelKey: 'support', key: 'general', name: 'General', description: 'Help', emoji: '🎫',
  buttonStyle: 'primary', staffRoleIds: ['4'], allowedRoleIds: [], channelNameTemplate: 'ticket-{number}-{username}',
  welcomeMessage: 'Welcome {mention}', allowUserClose: true, allowClaim: true, maxOpenPerUser: 1,
  questions: [], enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
const settings: GuildSettings = { guildId: '1', adminRoleIds: [], accentColor: '#5865F2', closeDelaySeconds: 10 };
const ticket: Ticket = {
  id: 1, guildId: '1', ticketNumber: 1, panelKey: 'support', categoryKey: 'general', userId: '5',
  username: 'user', channelId: '6', status: 'open', answers: { Subject: 'Testing' },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

describe('Components V2', () => {
  it('gera painel exclusivamente com componentes V2', () => {
    const message = buildPanel(panel, [category]);
    assert.equal(message.flags, MessageFlags.IsComponentsV2);
    assert.equal(message.components.length, 1);
    const serialized = message.components[0].toJSON();
    assert.ok(serialized.components.some((component: { type: number }) => component.type === 1));
    assert.equal('content' in message, false);
  });

  it('inclui respostas e restringe menções na mensagem do ticket', () => {
    const message = buildTicketWelcome(ticket, category, settings);
    const serialized = JSON.stringify(message.components.map((component) => component.toJSON()));
    assert.match(serialized, /Testing/);
    assert.deepEqual(message.allowedMentions?.users, ['5']);
    assert.deepEqual(message.allowedMentions?.roles, ['4']);
    assert.deepEqual(message.allowedMentions?.parse, []);
  });

  it('não duplica menções quando o autor reivindica o ticket', () => {
    const message = buildTicketStatus({ ...ticket, status: 'claimed', claimedBy: ticket.userId }, category, settings);
    assert.deepEqual(message.allowedMentions?.users, [ticket.userId]);
  });

});
