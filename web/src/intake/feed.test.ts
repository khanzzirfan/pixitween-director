import { expect, it } from 'vitest';
import { matchPhotos, needingPhoto, parseFeed, sortDropped } from './feed';

const file = (name: string, type = '') => new File(['x'], name, { type });
const CSV = ['id,title,price,sale_price,currency,image_link', 'a,"Rose Gold, Orchid",49,,USD,orchid.png', 'b,Forest Oud,95,,USD,fixtures/oud.png', 'c,Sale Musk,60,45,EUR,musk-1.jpg'].join('\n');

it('reads products with their prices', () => {
  const { products, error } = parseFeed(CSV);
  expect(error).toBeUndefined();
  expect(products.map((p) => [p.title, p.price])).toEqual([['Rose Gold, Orchid', '$49'], ['Forest Oud', '$95'], ['Sale Musk', '€45']]);
});

it('says why a feed cannot be read', () => {
  expect(parseFeed('id,title\n').error).toMatch(/no products/);
  expect(parseFeed('foo,bar\n1,2').error).toMatch(/columns/);
});

it('matches uploaded photos by name and leaves repo links alone', () => {
  const products = matchPhotos(parseFeed(CSV).products, [file('musk.jpg')]);
  expect(products[2].photo?.name).toBe('musk.jpg');
  expect(needingPhoto(products).map((p) => p.id)).toEqual(['a']);
});

it('sorts a drop into one csv, images and the rest', () => {
  const got = sortDropped([file('feed.csv'), file('a.png', 'image/png'), file('b.JPG'), file('notes.txt')]);
  expect(got.csv?.name).toBe('feed.csv');
  expect(got.photos).toHaveLength(2);
  expect(got.rejected).toEqual(['notes.txt']);
});
