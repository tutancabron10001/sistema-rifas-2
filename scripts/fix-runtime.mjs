import fs from 'fs';
import path from 'path';

const vcConfigPath = '.vercel/output/functions/_render.func/.vc-config.json';

if (fs.existsSync(vcConfigPath)) {
  const config = JSON.parse(fs.readFileSync(vcConfigPath, 'utf-8'));
  config.runtime = 'nodejs20.x';
  fs.writeFileSync(vcConfigPath, JSON.stringify(config, null, 2));
  console.log('✓ Fixed runtime to nodejs20.x');
} else {
  console.log('⚠ .vc-config.json not found, skipping fix');
}
