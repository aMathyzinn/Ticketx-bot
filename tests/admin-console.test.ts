import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MessageFlags } from 'discord.js';
import { GuildSettings, Panel, TicketCategory } from '../src/domain/models';
import { AdminConsoleStore } from '../src/services/AdminConsoleStore';
import { buildAdminHome, buildAdminPanel, buildAdminPanels, buildChannelPicker } from '../src/ui/adminConsole';

const settings: GuildSettings = { guildId: 'guild', adminRoleIds: [], accentColor: '#5865F2', closeDelaySeconds: 10 };
const panel: Panel = {
  guildId: 'guild', key: 'support', channelId: 'channel', parentCategoryId: 'category', ticketMode: 'channels', style: 'select',
  title: 'Support', description: 'Help', color: '#5865F2', enabled: true, createdAt: '', updatedAt: '',
};
const category: TicketCategory = {
  guildId: 'guild', panelKey: 'support', key: 'general', name: 'General', description: 'General help', buttonStyle: 'primary',
  staffRoleIds: [], allowedRoleIds: [], channelNameTemplate: 'ticket-{number}', welcomeMessage: 'Welcome',
  allowUserClose: true, allowClaim: true, maxOpenPerUser: 1, questions: [], enabled: true, createdAt: '', updatedAt: '',
};

describe('Admin console', () => {
  it('mantém a sessão de navegação até a expiração e não expõe seu estado no ID', () => {
    const store = new AdminConsoleStore();
    const session = store.create({ guildId: 'guild', userId: 'admin', screen: 'home', page: 0, panelKey: 'support' });
    assert.equal(session.id.length, 12);
    assert.equal(store.get(session.id)?.panelKey, 'support');
    assert.equal(store.update(session.id, { screen: 'panel', page: 1 })?.screen, 'panel');
    assert.equal(store.get(session.id)?.page, 1);
    store.remove(session.id);
    assert.equal(store.get(session.id), undefined);
  });

  it('renderiza telas V2 com controles de navegação e seleção', () => {
    const store = new AdminConsoleStore();
    const session = store.create({ guildId: 'guild', userId: 'admin', screen: 'home', page: 0, panelKey: 'support' });
    const home = buildAdminHome(session, settings, [panel]);
    const list = buildAdminPanels({ ...session, screen: 'panels' }, settings, [panel], new Map([['support', 1]]));
    const detail = buildAdminPanel({ ...session, screen: 'panel' }, settings, panel, [category]);
    const picker = buildChannelPicker({ ...session, screen: 'route-channel' }, settings, panel, 'panel');

    for (const result of [home, list, detail, picker]) {
      assert.equal(result.flags, MessageFlags.IsComponentsV2);
      const serialized = JSON.stringify(result.components.map((component) => component.toJSON()));
      assert.match(serialized, /ac:/);
      assert.doesNotMatch(serialized, /"embeds"/);
    }
    const listJson = JSON.stringify(list.components[0].toJSON());
    assert.match(listJson, /select:panel/);
    const pickerJson = JSON.stringify(picker.components[0].toJSON());
    assert.match(pickerJson, /select:route-channel/);
  });
});
