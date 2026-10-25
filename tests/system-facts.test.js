import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, unitsSold, systemFacts, SYSTEM_ITEMS } from '../scripts/system-facts.mjs';
import { readFile } from 'node:fs/promises';

const claim = (value, extra = {}) => ({ rank: 'normal', mainsnak: { datavalue: { value } }, ...extra });

test('dates read as precisely as Wikidata knows them', () => {
  assert.equal(formatTime({ time: '+1983-07-15T00:00:00Z', precision: 11 }), '15 July 1983');
  assert.equal(formatTime({ time: '+1989-09-00T00:00:00Z', precision: 10 }), 'September 1989');
  assert.equal(formatTime({ time: '+1977-00-00T00:00:00Z', precision: 9 }), '1977');
  assert.equal(formatTime(null), null);
});

test('units sold: the newest figure wins, with its date', () => {
  const figures = [claim({ amount: '+40000000' }, { qualifiers: { P585: [{ datavalue: { value: { time: '+2015-01-01T00:00:00Z', precision: 9 } } }] } }),
    claim({ amount: '+61910000' }, { qualifiers: { P585: [{ datavalue: { value: { time: '+2022-03-31T00:00:00Z', precision: 11 } } }] } })];
  assert.deepEqual(unitsSold(figures), { amount: 61910000, asOf: 'March 2022' });
  assert.equal(unitsSold([]), null);
});

test('a system keeps every processor and maker, the earliest release and the latest end', () => {
  const entity = { id: 'Q10676', descriptions: { en: { value: 'fourth-generation home video game console' } }, sitelinks: { enwiki: { title: 'Sega Genesis' } },
    claims: { P880: [claim({ id: 'Q1' }), claim({ id: 'Q2' })], P176: [claim({ id: 'Q3' })], P18: [claim('Sega Genesis.jpg')],
      P577: [claim({ time: '+1989-08-14T00:00:00Z', precision: 11 }), claim({ time: '+1988-10-29T00:00:00Z', precision: 11 })], P2669: [claim({ time: '+1997-00-00T00:00:00Z', precision: 9 })] } };
  const facts = systemFacts(entity, { Q1: 'Motorola 68000', Q2: 'Zilog Z80', Q3: 'Sega' }, 'The Sega Genesis is…');
  assert.deepEqual(facts.cpu, ['Motorola 68000', 'Zilog Z80']); assert.deepEqual(facts.manufacturer, ['Sega']);
  assert.equal(facts.released, '29 October 1988'); assert.equal(facts.discontinued, '1997');
  assert.equal(facts.tagline, 'Fourth-generation home video game console'); assert.equal(facts.page, 'Sega Genesis');
  assert.match(facts.image.url, /Special:FilePath\/Sega%20Genesis\.jpg/);
});

test('every Game Atlas system has a Wikidata item and saved facts', async () => {
  const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url)));
  const saved = JSON.parse(await readFile(new URL('../data/system-facts.json', import.meta.url))).systems;
  for (const system of catalog.systems) { assert.match(SYSTEM_ITEMS[system.id] ?? '', /^Q\d+$/, system.id); assert.ok(saved[system.id], system.id); }
});
