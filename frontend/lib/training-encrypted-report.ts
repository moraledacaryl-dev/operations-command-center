import { parseTrainingReport } from './training-progress-report';
import type { TrainingProgressReport } from './training-progress-report';

// This file protects a portable learning report. It does not contain the
// fictional database and therefore does not establish saved-work evidence.
const ITERATIONS = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function encoded(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
}
function decoded(value: unknown, maximum: number): Uint8Array {
  if (typeof value !== 'string' || value.length > maximum * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error('Invalid file');
  const raw = atob(value);
  if (raw.length > maximum) throw Error('Invalid file');
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
async function keyFor(password: string, salt: Uint8Array): Promise<CryptoKey> {
  if (password.length < 12 || password.length > 256) throw Error('Use a backup password of 12 to 256 characters.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new Uint8Array(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function trainingLogin(value: unknown): string {
  if (typeof value !== 'string') throw Error('Practice login unavailable');
  const result = value.trim().toLowerCase();
  if (!/^[a-z0-9._+-]+@training\.invalid$/.test(result) || result.length > 150) throw Error('Practice login unavailable');
  return result;
}
export async function encryptTrainingReport(report: TrainingProgressReport, login: unknown, password: string): Promise<string> {
  const user = trainingLogin(login);
  if (!parseTrainingReport(report)) throw Error('Invalid report');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt);
  const bytes = encoder.encode(JSON.stringify({ login: user, report }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return JSON.stringify({ format: 'hidden-oasis-encrypted-report-v1', salt: encoded(salt), iv: encoded(iv), data: encoded(ciphertext) });
}
export async function decryptTrainingReport(raw: string, login: unknown, password: string): Promise<TrainingProgressReport> {
  if (raw.length > 200_000) throw Error('Invalid file');
  const envelope = JSON.parse(raw) as Record<string, unknown>;
  if (!envelope || envelope.format !== 'hidden-oasis-encrypted-report-v1') throw Error('Invalid file');
  const salt = decoded(envelope.salt, 16), iv = decoded(envelope.iv, 12), data = decoded(envelope.data, 120_000);
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16) throw Error('Invalid file');
  const key = await keyFor(password, salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, new Uint8Array(data));
  const payload = JSON.parse(decoder.decode(plain)) as Record<string, unknown>;
  const report = parseTrainingReport(payload.report);
  if (!report || trainingLogin(payload.login) !== trainingLogin(login)) throw Error('Wrong practice login');
  return report;
}
