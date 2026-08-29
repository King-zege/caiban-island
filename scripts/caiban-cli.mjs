#!/usr/bin/env node
import process from 'node:process';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const tokenIndex = args.indexOf('--token');
const commandIndex = args.indexOf('--command');
const url = urlIndex >= 0 ? args[urlIndex + 1] : '';
const token = tokenIndex >= 0 ? args[tokenIndex + 1] : process.env.CAIBAN_CLI_TOKEN ?? '';
const commandJson = commandIndex >= 0 ? args[commandIndex + 1] : '';

if (!url.startsWith('http://127.0.0.1:') || !token || !commandJson) {
  process.stderr.write('用法：caiban-cli --url <回环地址> --token <令牌> --command <JSON>\n');
  process.exitCode = 2;
} else {
  const command = JSON.parse(commandJson);
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(command), signal: AbortSignal.timeout(30000)
  });
  const result = await response.text();
  process.stdout.write(result + '\n');
  if (!response.ok) process.exitCode = 1;
}
