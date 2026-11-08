require('dotenv').config();

const databaseUrl = process.env.DATABASE_URL || '';
if (!databaseUrl || databaseUrl.includes('YOUR_POSTGRES_PASSWORD')) {
  throw new Error('Set DATABASE_URL in .env to your PostgreSQL connection.');
}

module.exports = {
  development: {
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    dialectOptions: process.env.DATABASE_SSL === 'true'
      ? { ssl: { require: true, rejectUnauthorized: false } }
      : {}
  },
  test: {
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres'
  },
  production: {
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    dialectOptions: process.env.DATABASE_SSL === 'true'
      ? { ssl: { require: true, rejectUnauthorized: false } }
      : {}
  }
};
