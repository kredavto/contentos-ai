import { describe, expect, it } from 'vitest';
import { buildUtmUrl, utmFieldsSchema } from '../packages/types/src/utm';
const input = { name: 'Launch', destinationUrl: 'https://example.com/path?keep=a&keep=b&utm_source=old&UTM_campaign=old&utm_term=old#section', source: 'телеграм', medium: 'social', campaign: 'Лето & скидки', term: '', content: 'Видео 1' };
describe('UTM URL construction', () => {
  it('replaces old tags case-insensitively, encodes values and preserves unrelated query and fragment', () => {
    const url = new URL(buildUtmUrl(input));
    expect(url.searchParams.getAll('keep')).toEqual(['a','b']); expect(url.hash).toBe('#section');
    expect(url.searchParams.get('utm_source')).toBe('телеграм'); expect(url.searchParams.get('utm_campaign')).toBe('Лето & скидки');
    expect(url.searchParams.get('utm_content')).toBe('Видео 1'); expect(url.searchParams.has('utm_term')).toBe(false); expect(url.searchParams.has('UTM_campaign')).toBe(false);
    expect(url.searchParams.getAll('utm_source')).toHaveLength(1);
  });
  it.each(['javascript:alert(1)', 'data:text/html,hi', '//example.com', '/relative', 'https://user:pass@example.com', 'https://example.com/a b', 'https://example.com/\npath'])('rejects unsafe or ambiguous destination %s', destinationUrl => {
    expect(utmFieldsSchema.safeParse({ ...input, destinationUrl }).success).toBe(false);
  });
  it('canonicalizes URL casing and rejects empty or oversized tags and unknown fields', () => {
    expect(utmFieldsSchema.parse({ ...input, destinationUrl: 'HTTPS://EXAMPLE.COM' }).destinationUrl).toBe('https://example.com/');
    for (const patch of [{ source: ' ' }, { campaign: 'x'.repeat(101) }, { content: 'x\ny' }, { hidden: true }]) expect(utmFieldsSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
});
