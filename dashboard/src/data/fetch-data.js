import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const CLI_PATH = join(PROJECT_ROOT, 'riseup-cli-main', 'dist', 'cli.js');
const DATA_DIR = join(__dirname);

// Commands to fetch data for
const commands = [
    'status',
    'balance',
    'spending',
    'income',
    'transactions',
    'trends',
    'progress',
    'plans',
    'insights'
];

console.log('Fetching data from RiseUp CLI...');

for (const cmd of commands) {
    try {
        console.log(`Fetching ${cmd}...`);
        // Execute the CLI command with the --json flag
        const result = execSync(`node "${CLI_PATH}" ${cmd} --json`, {
            encoding: 'utf-8',
        });

        // Save the raw JSON output to a file
        const outputPath = join(DATA_DIR, `${cmd}.json`);
        writeFileSync(outputPath, result);
        console.log(`  -> Saved to ${outputPath}`);
    } catch (error) {
        console.error(`Failed to fetch ${cmd}:`, error.message);
    }
}

console.log('Data extraction complete.');
