// Uruchomienie: npm start [-- <nazwa-scenariusza>]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readConfig() {
  const file = path.join(ROOT, 'config.json');
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8'));
}

const config = readConfig();
const name = process.argv[2] || config.scenario;
if (!name) {
  console.error('Podaj scenariusz: npm start -- <nazwa> albo ustaw "scenario" w config.json');
  process.exit(1);
}
const scenarioDir = path.isAbsolute(name) ? name : path.join(ROOT, 'scenarios', name);
if (!existsSync(path.join(scenarioDir, 'scenario.json'))) {
  console.error(`Nie znaleziono scenariusza: ${scenarioDir}`);
  process.exit(1);
}

const port = Number(process.env.PORT || config.port || 8080);
const { server } = createApp(scenarioDir);
server.listen(port, '127.0.0.1', () => {
  console.log(`Kriegsspiel AI — scenariusz „${name}”`);
  console.log(`Otwórz http://localhost:${port}`);
});
