import fs from 'fs';
import path from 'path';

// Define expected keys by manually parsing env.ts or we could try to import if we mock processEnv
// Let's parse env.ts text to avoid schema validation failure on import
const envPath = path.join(__dirname, '../src/config/env.ts');
const envExamplePath = path.join(__dirname, '../.env.example');

const envTsContent = fs.readFileSync(envPath, 'utf-8');
const envExampleContent = fs.readFileSync(envExamplePath, 'utf-8');

// Parse keys from env.ts
const schemaMatch = envTsContent.match(/const envSchema = z\.object\(\{([\s\S]*?)\}\);/);
if (!schemaMatch) {
  console.error("❌ Failed to parse envSchema from env.ts");
  process.exit(1);
}

const schemaBody = schemaMatch[1];
const schemaKeys = Array.from(schemaBody.matchAll(/([A-Z0-9_]+)\s*:/g)).map(m => m[1]);

// Parse keys from .env.example
const exampleKeys = envExampleContent
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))
  .map(line => line.split('=')[0]);

let hasError = false;

// Check for missing keys in .env.example
for (const key of schemaKeys) {
  if (!exampleKeys.includes(key)) {
    console.error(`❌ Missing required env var in .env.example: ${key}`);
    hasError = true;
  }
}

// Check for undocumented keys in .env.example
for (const key of exampleKeys) {
  if (!schemaKeys.includes(key)) {
    console.error(`❌ Undocumented env var in .env.example (not in schema): ${key}`);
    hasError = true;
  }
}

if (hasError) {
  console.error("Environment variable coverage check failed.");
  process.exit(1);
}

console.log("✅ Environment variable coverage is complete.");
process.exit(0);
