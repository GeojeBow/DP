// Run after `eas init` in CI: points expo-updates at the linked EAS project so
// the installed app downloads JS updates published with `eas update`.
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../app.json', import.meta.url);
const config = JSON.parse(readFileSync(file, 'utf8'));
const projectId = config.expo.extra?.eas?.projectId;
if (!projectId) throw new Error('app.json has no extra.eas.projectId; run `eas init` first');
config.expo.updates = { ...config.expo.updates, url: `https://u.expo.dev/${projectId}` };
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`EAS project ${projectId}`);
