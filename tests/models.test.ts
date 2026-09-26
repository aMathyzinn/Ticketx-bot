import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeHexColor, normalizeKey } from '../src/domain/models';

describe('normalização', () => {
  it('gera chaves seguras para custom IDs e banco', () => {
    assert.equal(normalizeKey(' Suporte VIP! '), 'suporte-vip');
    assert.equal(normalizeKey('A'.repeat(50)).length, 31);
  });

  it('aceita apenas cores hexadecimais completas', () => {
    assert.equal(normalizeHexColor('#aa00ff'), '#AA00FF');
    assert.equal(normalizeHexColor('red'), '#5865F2');
  });
});
