require('dotenv').config();
const { sequelize } = require('./models');
const { startReminderWorker } = require('./services/reminders');

async function start() {
  await sequelize.authenticate();
  startReminderWorker();
  console.info('DrukCare reminder worker started (Asia/Thimphu).');
}

start().catch((error) => {
  console.error('DrukCare reminder worker could not start:', error);
  process.exitCode = 1;
});

async function shutdown() {
  await sequelize.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
