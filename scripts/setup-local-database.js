require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { parse } = require('pg-connection-string');
const readline = require('node:readline/promises');

const envPath = path.resolve('.env');
const exampleEnvPath = path.resolve('.env.example');
const envText = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, 'utf8')
  : fs.existsSync(exampleEnvPath)
    ? fs.readFileSync(exampleEnvPath, 'utf8')
    : '';
const envValues = require('dotenv').parse(envText);

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Run npm run setup in an interactive terminal so the PostgreSQL password can be entered privately.');
  }
  return new Promise((resolve) => {
    let value = '';
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 3) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          process.exit(130);
        }
        if (byte === 13 || byte === 10) {
          process.stdin.removeListener('data', onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) {
          value = value.slice(0, -1);
          continue;
        }
        if (byte >= 32) value += String.fromCharCode(byte);
      }
    };
    process.stdin.on('data', onData);
  });
}

async function ask(prompt, defaultValue) {
  const interface_ = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await interface_.question(`${prompt} [${defaultValue}]: `)).trim();
    return answer || defaultValue;
  } finally {
    interface_.close();
  }
}

function setDatabaseUrlInEnv(text, databaseUrl) {
  const line = `DATABASE_URL=${databaseUrl}`;
  if (/^DATABASE_URL=.*$/m.test(text)) {
    return text.replace(/^DATABASE_URL=.*$/m, line);
  }
  return `${text.trimEnd()}${text.trim() ? '\n' : ''}${line}\n`;
}

function runNpm(script, databaseUrl) {
  const npmPath = process.env.npm_execpath;
  const command = npmPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = npmPath ? [npmPath, 'run', script] : ['run', script];
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
    shell: !npmPath && process.platform === 'win32'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm run ${script} failed with exit code ${result.status}.`);
}

async function main() {
  const configuredUrl = envValues.DATABASE_URL;
  if (!configuredUrl) throw new Error('DATABASE_URL is missing from .env and .env.example.');

  let parsed = {};
  try {
    parsed = parse(configuredUrl);
  } catch {
    console.info('The saved connection URL is not usable. Enter your local PostgreSQL connection details.');
  }
  const hostDefault = ['localhost', '127.0.0.1', '::1'].includes(parsed.host)
    ? parsed.host
    : '127.0.0.1';
  const host = await ask('PostgreSQL host', hostDefault);
  const port = await ask('PostgreSQL port', parsed.port || '5432');
  const username = await ask('PostgreSQL username', parsed.user || 'postgres');
  const database = await ask('Database name to create', parsed.database || 'drukcare');
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(database)) {
    throw new Error('The local database name must contain only letters, numbers, and underscores.');
  }
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('PostgreSQL port must be a number between 1 and 65535.');
  }

  const databaseUrl = new URL('postgres://localhost');
  databaseUrl.hostname = host;
  databaseUrl.port = port;
  databaseUrl.username = username;
  databaseUrl.pathname = `/${database}`;
  databaseUrl.password = await readHidden('Enter your PostgreSQL password (input is hidden): ');
  if (!databaseUrl.password) throw new Error('A PostgreSQL password is required.');

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';
  const client = new Client({
    connectionString: adminUrl.toString(),
    ssl: envValues.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
    connectionTimeoutMillis: 10000
  });

  try {
    await client.connect();
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${database}"`);
      console.info(`Created PostgreSQL database "${database}".`);
    } else {
      console.info(`PostgreSQL database "${database}" already exists.`);
    }
  } catch (error) {
    if (error.code === '28P01') {
      throw new Error('PostgreSQL rejected that password. Check the password you entered and try npm run setup again.');
    }
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Could not reach PostgreSQL on the configured host/port. Start the PostgreSQL service and try again.');
    }
    if (error.code === '42501') {
      throw new Error(`PostgreSQL connected, but "${username}" cannot create databases. Create "${database}" in pgAdmin using a database superuser, then run npm run setup again.`);
    }
    throw error;
  } finally {
    await client.end().catch(() => {});
  }

  fs.writeFileSync(envPath, setDatabaseUrlInEnv(envText, databaseUrl.toString()), { mode: 0o600 });
  console.info('Saved DATABASE_URL in the Git-ignored .env file.');
  runNpm('db:migrate', databaseUrl.toString());
  runNpm('db:seed', databaseUrl.toString());
  console.info('Database setup is complete. Start DrukCare with npm run dev.');
}

main().catch((error) => {
  console.error(`Database setup failed: ${error.message}`);
  process.exitCode = 1;
});
