import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vgcRecord, vgcAppids, vgcQueue, refreshVgc, attachVgc } from '../scripts/vgc.mjs';

const page = (id, extra = {}) => ({ id, status: 'scored', url: `https://videogamescritic.com/game/x-${id}`, scores: { vgc: 85, players: 85, critics: 95, criticCount: 219, confidence: 'high', trend: 'stable',
  gap: { value: 10, verdict: 'Critics warmer than players' }, sincePatch: { score: 89, reviews: 300, patch: { title: 'Patch 1.17', date: '2026-08-27' } }, ...extra } });
const reply = (status, body, remaining = 50) => ({ status, ok: status < 300, json: async () => body, headers: { get: name => name === 'x-ratelimit-remaining' ? String(remaining) : null } });

test('VGC pages keep the scores, trend, patch view and the page to credit', () => {
  assert.deepEqual(vgcRecord(page(1245620)), { status: 'scored', score: 85, players: 85, critics: 95, criticCount: 219, confidence: 'high', trend: 'stable', gap: 'Critics warmer than players',
    sincePatch: { score: 89, reviews: 300, title: 'Patch 1.17', date: '2026-08-27' }, url: 'https://videogamescritic.com/game/x-1245620', updatedAt: null });
});

test('lookups cover Steam copies and the wishlist; missing games first, unknown games retried later', () => {
  const groups = [{ copies: [{ steamAppId: '10' }, { igdb: { steam: ['20'] } }, { igdb: { steam: ['30', '31'] } }] }];
  assert.deepEqual(vgcAppids(groups, [{ appid: 40 }, { appid: 10 }]), ['10', '20', '40']);
  const now = Date.parse('2026-09-30T00:00:00Z'), days = count => new Date(now - count * 86400000).toISOString();
  const cache = { games: { 10: { status: 'scored', fetchedAt: days(20) }, 20: { status: 'scored', fetchedAt: days(2) }, 40: { status: 'missing', fetchedAt: days(20) } } };
  assert.deepEqual(vgcQueue(cache, ['10', '20', '40', '50'], now), ['50', '10']);
});

test('a refresh stops at the hourly limit, saves what it got and resumes with the rest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vgc-')), seen = [];
  const fetch = async url => { const id = url.split('/').pop(); seen.push(id); return id === '3' ? reply(404, {}) : reply(200, page(Number(id)), id === '4' ? 1 : 50); };
  const first = await refreshVgc(root, { appids: ['1', '2', '3', '4', '5'], fetch, key: null });
  assert.deepEqual([first.fetched, first.waiting, first.limited, seen], [4, 1, true, ['1', '2', '3', '4']]);
  const saved = JSON.parse(await readFile(path.join(root, 'library/data/vgc.json'), 'utf8'));
  assert.equal(saved.games[3].status, 'missing');
  const second = await refreshVgc(root, { appids: ['1', '2', '3', '4', '5'], fetch, key: 'k' });
  assert.deepEqual([second.fetched, second.waiting, seen.at(-1)], [1, 0, '5']);
  // Only scored games attach.
  const groups = [{ copies: [{ steamAppId: '1' }, { steamAppId: '3' }] }], wishlist = [{ appid: 2 }];
  attachVgc(JSON.parse(await readFile(path.join(root, 'library/data/vgc.json'), 'utf8')), { groups, wishlist });
  assert.deepEqual([groups[0].copies[0].vgc.score, groups[0].copies[1].vgc, wishlist[0].vgc.critics], [85, undefined, 95]);
});

test('games VGC hasn’t scored yet keep the order given: your own before the Game Atlas’s', () => {
  assert.deepEqual(vgcQueue({ games: {} }, ['900', '100', '500']), ['900', '100', '500']);
});
