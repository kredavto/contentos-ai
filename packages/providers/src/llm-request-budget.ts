import { DomainError } from '@contentos/types';

/** Transport JSON bytes, not tokens, model context capacity, credits or a plan limit. */
export const maximumLlmRequestBytes = 256 * 1024;
const maximumJsonDepth = 64;

/** Serialize only plain JSON data without invoking getters/toJSON, then detach it
 * from the caller before the SDK can await or serialize it again. No truncation. */
export function boundedLlmRequestSnapshot<T>(value: T): T {
  const chunks: string[] = [];
  const ancestors = new Set<object>();
  let bytes = 0;
  const invalid = () => new DomainError('INVALID_INPUT');
  const append = (text: string) => {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > maximumLlmRequestBytes) throw invalid();
    chunks.push(text);
  };
  const string = (text: string) => {
    // Refuse huge strings before creating a potentially much larger escaped copy.
    if (Buffer.byteLength(text, 'utf8') > maximumLlmRequestBytes - bytes) throw invalid();
    append(JSON.stringify(text));
  };
  const visit = (current: unknown, depth: number): void => {
    if (depth > maximumJsonDepth) throw invalid();
    if (current === null) { append('null'); return; }
    if (typeof current === 'string') { string(current); return; }
    if (typeof current === 'boolean') { append(String(current)); return; }
    if (typeof current === 'number' && Number.isFinite(current)) { append(JSON.stringify(current)); return; }
    if (typeof current !== 'object' || ancestors.has(current)) throw invalid();
    const array = Array.isArray(current);
    if (!array && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) throw invalid();
    ancestors.add(current);
    if (array && current.length > maximumLlmRequestBytes / 2) throw invalid();
    const serializationHook = Object.getOwnPropertyDescriptor(current, 'toJSON');
    // Even non-enumerable serialization hooks are not accepted at this boundary.
    if (serializationHook && (!('value' in serializationHook) || typeof serializationHook.value === 'function')) throw invalid();
    if (array) {
      append('[');
      for (let i = 0; i < current.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(i));
        if (!descriptor || !('value' in descriptor)) throw invalid();
        if (i) append(',');
        visit(descriptor.value, depth + 1);
      }
      append(']');
    } else {
      append('{');
      let first = true;
      for (const key in current) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor) continue;
        if (!('value' in descriptor)) throw invalid();
        if (!first) append(',');
        first = false; string(key); append(':'); visit(descriptor.value, depth + 1);
      }
      append('}');
    }
    ancestors.delete(current);
  };
  try {
    visit(value, 0);
    return JSON.parse(chunks.join('')) as T;
  } catch {
    // Neither caller content nor the original serialization error is exposed.
    throw invalid();
  }
}
