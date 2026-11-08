const { Sequelize } = require('sequelize');
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('YOUR_POSTGRES_PASSWORD')) {
  throw new Error('Set DATABASE_URL in .env to your PostgreSQL connection. Run npm run setup to create the database and tables.');
}

module.exports = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  dialectOptions: process.env.DATABASE_SSL === 'true'
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : {},
  pool: { max: 10, min: 0, acquire: 30000, idle: 10000 }
});
