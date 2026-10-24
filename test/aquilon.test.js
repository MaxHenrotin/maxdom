import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dedupeEditions, parseListing, parseSummary, sortBooks } from '../src/aquilon.js';

const fixture = (name) => readFileSync(`test/fixtures/aquilon/${name}`, 'utf8');

describe('parseListing', () => {
  it('reads every volume of a listing page', () => {
    const { books, pages } = parseListing(fixture('terres-d-ynuma.html'), "Terres d'Ynuma");
    expect(pages).toBe(1);
    expect(books.find((b) => b.id === 'terres-d-ynuma-t04')).toEqual({
      id: 'terres-d-ynuma-t04',
      series: "Terres d'Ynuma",
      volume: 4,
      title: 'Les Noces écarlates',
      published: '2026-09-10',
      cover_url: 'https://www.monde-aquilon.com/wp-content/uploads/2026/09/TERRES-YNUMA-04-9782302106789.jpg',
    });
  });

  it('finds the last page and keeps special editions as separate entries', () => {
    const { books, pages } = parseListing(fixture('elfes-page-1.html'), 'Elfes');
    expect(pages).toBe(4);
    expect(books.filter((b) => b.volume === 37).map((b) => [b.id, b.published])).toEqual([
      ['elfes-t37', '2026-11-12'],
      ['elfes-t37-edition-nb', '2026-11-05'],
    ]);
  });
});

it('parseSummary returns the plain text of the summary', () => {
  expect(parseSummary(fixture('mages-t04.html'))).toBe('Arundill cherche l’alchimiste qui l’a élevée. Résumé écrit pour les tests.');
  expect(parseSummary('<html></html>')).toBe('');
});

it('dedupeEditions keeps the standard edition and its date', () => {
  const { books } = parseListing(fixture('elfes-page-1.html'), 'Elfes');
  const t37 = dedupeEditions(books).filter((b) => b.volume === 37);
  expect(t37.map((b) => [b.id, b.published])).toEqual([['elfes-t37', '2026-11-12']]);
});

it('dedupeEditions keeps a crossover volume in the first series that lists it', () => {
  const books = dedupeEditions([
    { id: 'orcs-et-gobelins-t24-guerres-d-arran', series: 'Orcs & Gobelins', volume: 24 },
    { id: 'guerres-d-arran-t03', series: "Guerres d'Arran", volume: 3 },
    { id: 'orcs-et-gobelins-t24-guerres-d-arran', series: "Guerres d'Arran", volume: 24 },
  ]);
  expect(books.map((b) => [b.id, b.series])).toEqual([
    ['orcs-et-gobelins-t24-guerres-d-arran', 'Orcs & Gobelins'],
    ['guerres-d-arran-t03', "Guerres d'Arran"],
  ]);
});

it('sortBooks orders by date, then series column, then volume', () => {
  const book = (id, series, volume, published) => ({ id, series, volume, published });
  const sorted = sortBooks([
    book('n2', 'Nains', 2, '2020-01-01'),
    book('e9', 'Elfes', 9, '2020-01-01'),
    book('n1', 'Nains', 1, '2020-01-01'),
    book('m1', 'Mages', 1, '2019-06-01'),
  ]);
  expect(sorted.map((b) => b.id)).toEqual(['m1', 'e9', 'n1', 'n2']);
});
