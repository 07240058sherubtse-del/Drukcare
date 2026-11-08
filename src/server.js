require('dotenv').config();
const app = require('./app');
const { sequelize } = require('./models');
const { startReminderWorker } = require('./services/reminders');

const port = Number(process.env.PORT || 3000);

async function start() {
  await sequelize.authenticate();
  await app.locals.sessionStore.sync();
  const server = app.listen(port, () => {
    console.info(`DrukCare listening on port ${port}`);
  });
  if (process.env.ENABLE_REMINDERS === 'true') {
    startReminderWorker();
  }
  const shutdown = async () => {
    server.close(async () => {
      await sequelize.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => {
  console.error('DrukCare could not start:', error);
  process.exitCode = 1;
});
