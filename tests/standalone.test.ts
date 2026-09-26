import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

function runIsolated(code: string, token?: string) {
  const directory = mkdtempSync(join(tmpdir(), 'ticketx-test-'));
  const environment: NodeJS.ProcessEnv = { ...process.env };
  // Use an empty working directory so dotenv cannot load local credentials.
  for (const key of Object.keys(environment)) {
    if (/^(SITE_|DISCORD_|CLIENT_ID$|GUILD_ID$|GLOBAL_COMMANDS$|DATABASE_PATH$|LOG_LEVEL$|DOTENV_)/.test(key)) delete environment[key];
  }
  environment.CLIENT_ID = '100000000000000000';
  if (token) environment.DISCORD_TOKEN = token;
  try {
    return spawnSync(process.execPath, ['--require', require.resolve('tsx/cjs'), '-e', code], {
      cwd: directory, env: environment, encoding: 'utf8', timeout: 15_000,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('Standalone ticket bot', () => {
  it('initializes with only Discord credentials and an empty local database', () => {
    const result = runIsolated(`
      const assert = require('node:assert/strict');
      const { env } = require(${JSON.stringify(resolve('src/config/env.ts'))});
      const { TicketRepository } = require(${JSON.stringify(resolve('src/database/TicketRepository.ts'))});
      const { TicketBotClient } = require(${JSON.stringify(resolve('src/bot/TicketBotClient.ts'))});
      const { loadCommands } = require(${JSON.stringify(resolve('src/handlers/commandHandler.ts'))});
      const { loadEvents } = require(${JSON.stringify(resolve('src/handlers/eventHandler.ts'))});
      const repository = new TicketRepository(':memory:');
      const client = new TicketBotClient(repository);
      assert.ok(client.tickets);
      assert.ok(client.panels);
      assert.equal(repository.listPanels('100000000000000000').length, 0);
      assert.equal('discordLinks' in client, false);
      assert.equal(Object.keys(env).some(key => key.startsWith('site')), false);
      (async () => {
        await loadCommands(client);
        await loadEvents(client);
        assert.equal(client.commands.size, 7);
        assert.ok(client.commands.has('ticket'));
        assert.ok(client.commands.has('admin'));
        client.destroy();
        repository.close();
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `, 'test-placeholder-token-with-at-least-30-characters');
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  });

  it('still rejects missing Discord credentials without requiring any site secret', () => {
    const result = runIsolated(`require(${JSON.stringify(resolve('src/config/env.ts'))})`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DISCORD_TOKEN/);
    assert.doesNotMatch(result.stderr, /SITE_|SHARED_SECRET/);
  });
});
