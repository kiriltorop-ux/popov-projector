import {existsSync} from 'node:fs';
import {execFile} from 'node:child_process';
import path from 'node:path';

const directory = path.resolve('..');
const python = path.join(directory, '.venv/bin/python');
const script = path.join(directory, 'Исходники/transcribe.py');
export const localDictation = [python, script, path.join(directory, 'Голос/ggml-base-q5_1.bin')].every(file => existsSync(file));
let working = false;

export async function transcribePreview(req, res, url) {
  const reply = (status, data = {}) => res.writeHead(status, {
    'Content-Type':'application/json', 'Cache-Control':'no-store',
  }).end(JSON.stringify(data));
  if (!localDictation || req.method !== 'POST') return reply(404);
  if (!['127.0.0.1:4176','localhost:4176'].includes(req.headers.host) ||
      req.headers.origin !== 'http://' + req.headers.host) return reply(403);
  const language = url.searchParams.get('language');
  if (!['ru','en','zh'].includes(language) || !/^audio\/(webm|mp4|ogg)(;|$)/i.test(req.headers['content-type'] || '')) return reply(415);
  if (working) return reply(429);
  working = true;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) return reply(413);
      chunks.push(chunk);
    }
    if (!size) return reply(422);
    const text = await new Promise((resolve, reject) => {
      const worker = execFile(python, [script, language], {timeout:25000}, (error, stdout, stderr) => {
        if (error && stderr.includes('Нужна запись речи')) resolve('');
        else if (error) reject(error);
        else resolve(stdout.trim());
      });
      worker.stdin.on('error', () => {});
      worker.stdin.end(Buffer.concat(chunks));
    });
    return reply(text ? 200 : 422, {text});
  } catch {
    return reply(503);
  } finally { working = false; }
}
