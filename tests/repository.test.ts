import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActiveTicketExistsError } from '../src/core/errors';
import { TicketRepository } from '../src/database/TicketRepository';
import { PanelManagementService } from '../src/services/PanelManagementService';

function seed(repository: TicketRepository, guildId = '100000000000000001', maxOpenPerUser = 1): void {
  repository.ensureGuild(guildId);
  repository.upsertPanel({
    guildId, key: 'support', channelId: '200000000000000001', parentCategoryId: '300000000000000001',
    ticketMode: 'channels', style: 'buttons', title: 'Support', description: 'Open a ticket', color: '#5865F2', enabled: true,
  });
  repository.upsertCategory({
    guildId, panelKey: 'support', key: 'general', name: 'General', description: 'General support',
    buttonStyle: 'primary', staffRoleIds: ['400000000000000001'], allowedRoleIds: [], channelNameTemplate: 'ticket-{number}-{username}',
    welcomeMessage: 'Welcome {mention}', allowUserClose: true, allowClaim: true, maxOpenPerUser,
    questions: [], enabled: true,
  });
}

describe('TicketRepository', () => {
  it('isola configurações e painéis por servidor', () => {
    const repository = new TicketRepository(':memory:');
    seed(repository, '100000000000000001');
    seed(repository, '100000000000000002');
    repository.updateGuildSettings('100000000000000001', { accentColor: '#FF0000' });
    assert.equal(repository.getGuildSettings('100000000000000001').accentColor, '#FF0000');
    assert.equal(repository.getGuildSettings('100000000000000002').accentColor, '#5865F2');
    assert.equal(repository.listPanels('100000000000000001').length, 1);
    repository.close();
  });

  it('impõe o limite simultâneo dentro da transação', () => {
    const repository = new TicketRepository(':memory:');
    seed(repository);
    repository.reserveTicket({ guildId: '100000000000000001', panelKey: 'support', categoryKey: 'general', userId: '500000000000000001', username: 'user', answers: {} });
    assert.throws(
      () => repository.reserveTicket({ guildId: '100000000000000001', panelKey: 'support', categoryKey: 'general', userId: '500000000000000001', username: 'user', answers: {} }),
      ActiveTicketExistsError,
    );
    repository.close();
  });

  it('permite o limite configurado e controla o ciclo de vida', () => {
    const repository = new TicketRepository(':memory:');
    seed(repository, '100000000000000001', 2);
    const first = repository.reserveTicket({ guildId: '100000000000000001', panelKey: 'support', categoryKey: 'general', userId: '500000000000000001', username: 'user', answers: { Subject: 'Help' } });
    const second = repository.reserveTicket({ guildId: '100000000000000001', panelKey: 'support', categoryKey: 'general', userId: '500000000000000001', username: 'user', answers: {} });
    assert.equal(second.ticketNumber, first.ticketNumber + 1);
    const active = repository.activateTicket(first.id, '600000000000000001');
    assert.equal(active.status, 'open');
    assert.equal(repository.claimTicket(active.id, '700000000000000001').status, 'claimed');
    assert.equal(repository.closeTicket(active.id, 'resolved').status, 'closed');
    assert.equal(repository.reopenTicket(active.id).status, 'open');
    const stats = repository.getStats('100000000000000001');
    assert.deepEqual(stats, { total: 2, open: 1, claimed: 0, closed: 0 });
    repository.close();
  });

  it('persiste e atualiza o modo de tickets do painel (canais ou private-threads)', () => {
    const repository = new TicketRepository(':memory:');
    seed(repository, '100000000000000003');
    const initial = repository.getPanel('100000000000000003', 'support');
    assert.equal(initial.ticketMode, 'channels');

    repository.upsertPanel({
      ...initial,
      ticketMode: 'private-threads',
    });
    const updated = repository.getPanel('100000000000000003', 'support');
    assert.equal(updated.ticketMode, 'private-threads');
    repository.close();
  });

  it('duplica painel e categorias sem reaproveitar a mensagem publicada', () => {
    const repository = new TicketRepository(':memory:');
    seed(repository);
    repository.setPanelMessage('100000000000000001', 'support', '900000000000000001', '200000000000000001');
    const management = new PanelManagementService(repository);
    const clone = management.clone('100000000000000001', 'support');
    assert.notEqual(clone.key, 'support');
    assert.equal(clone.messageId, undefined);
    const categories = repository.listCategories('100000000000000001', clone.key);
    assert.equal(categories.length, 1);
    assert.equal(categories[0]?.panelKey, clone.key);
    repository.close();
  });
});
