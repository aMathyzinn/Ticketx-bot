import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AutocompleteInteraction } from 'discord.js';
import { completePanelOrCategory } from '../src/commands/helpers';
import { TicketRepository } from '../src/database/TicketRepository';

function setupRepository(): TicketRepository {
  const repository = new TicketRepository(':memory:');
  repository.ensureGuild('guild');
  repository.upsertPanel({
    guildId: 'guild', key: 'premium', channelId: 'channel', parentCategoryId: 'parent', ticketMode: 'channels', style: 'select',
    title: 'Suporte Premium', description: 'Atendimento', color: '#00D9FF', enabled: true,
  });
  repository.upsertCategory({
    guildId: 'guild', panelKey: 'premium', key: 'pagamento', name: 'Pagamento e cobrança', description: 'Financeiro',
    buttonStyle: 'primary', staffRoleIds: [], allowedRoleIds: [], channelNameTemplate: 'ticket-{number}',
    welcomeMessage: 'Olá', allowUserClose: true, allowClaim: true, maxOpenPerUser: 1, questions: [], enabled: true,
  });
  return repository;
}

function mockInteraction(focused: { name: string; value: string }, panelKey: string | null) {
  const responses: Array<Array<{ name: string; value: string }>> = [];
  return {
    guildId: 'guild',
    options: {
      getFocused: (full?: boolean) => full ? focused : focused.value,
      getString: (name: string) => name === 'painel' ? panelKey : null,
    },
    respond: async (choices: Array<{ name: string; value: string }>) => { responses.push(choices); },
    responses,
  } as unknown as AutocompleteInteraction & { responses: Array<Array<{ name: string; value: string }>> };
}

describe('autocomplete de categorias', () => {
  it('retorna painéis e categorias válidos no fluxo editar', async () => {
    const repository = setupRepository();
    const client = { repository } as any;
    try {
      const panelInteraction = mockInteraction({ name: 'painel', value: '' }, null);
      await completePanelOrCategory(panelInteraction, client);
      assert.deepEqual(panelInteraction.responses, [[{ name: 'Suporte Premium (premium)', value: 'premium' }]]);

      const categoryInteraction = mockInteraction({ name: 'categoria', value: 'pag' }, 'premium');
      await completePanelOrCategory(categoryInteraction, client);
      assert.deepEqual(categoryInteraction.responses, [[{ name: 'Pagamento e cobrança (pagamento)', value: 'pagamento' }]]);
    } finally {
      repository.close();
    }
  });
});
