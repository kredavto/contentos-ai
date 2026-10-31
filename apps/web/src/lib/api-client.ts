import {apiUrl} from './api-url';
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path), { method, signal, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message ?? 'Не удалось выполнить запрос');
  return json.data as T;
}
