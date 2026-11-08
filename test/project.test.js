const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/drukcare_test';
const Sequelize = require('sequelize');
const models = require('../src/models');

test('directory offers each of Bhutan’s 20 Dzongkhags exactly once', () => {
  const dzongkhags = require('../src/config/dzongkhags');
  assert.equal(dzongkhags.length, 20);
  assert.equal(new Set(dzongkhags).size, 20);
  for (const name of [
    'Thimphu', 'Paro', 'Haa', 'Chhukha', 'Samtse', 'Sarpang', 'Tsirang', 'Dagana',
    'Punakha', 'Wangdue Phodrang', 'Gasa', 'Trongsa', 'Bumthang', 'Zhemgang',
    'Mongar', 'Lhuentse', 'Trashigang', 'Trashiyangtse', 'Pemagatshel', 'Samdrup Jongkhar'
  ]) {
    assert.ok(dzongkhags.includes(name), `Missing ${name}`);
  }
});

test('all EJS templates compile', () => {
  const views = path.join(root, 'src', 'views');
  const templates = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.ejs')) templates.push(file);
    }
  }
  walk(views);
  assert.ok(templates.length >= 15);
  for (const file of templates) {
    assert.doesNotThrow(() => ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file }), file);
  }
});

test('appointment schema permits rebooking a cancelled slot only', () => {
  const migration = fs.readFileSync(
    path.join(root, 'src', 'migrations', '20261108000100-create-core.js'),
    'utf8'
  );
  assert.match(migration, /appointments_one_active_booking_per_slot/);
  assert.match(migration, /status: \{ \[Sequelize\.Op\.ne\]: 'cancelled' \}/);
});

test('models expose the recurring availability and active-slot uniqueness constraints', () => {
  assert.ok(models.DoctorAvailability);
  const index = models.Appointment.options.indexes.find((item) => item.unique && item.fields.includes('slot_id'));
  assert.ok(index);
  assert.ok(index.where);
  assert.equal(Sequelize.Op.ne in index.where.status, true);
});

test('initial migration declares the full appointment schema', async () => {
  const migration = require('../src/migrations/20261108000100-create-core');
  const calls = [];
  const queryInterface = {
    async createTable(name) { calls.push(['createTable', name]); },
    async addConstraint(name, options) { calls.push(['addConstraint', name, options]); },
    async addIndex(name, fields, options) { calls.push(['addIndex', name, fields, options]); }
  };
  await migration.up(queryInterface, Sequelize);
  for (const table of [
    'users', 'hospitals', 'departments', 'doctors', 'doctor_availability',
    'appointment_slots', 'appointments', 'email_tokens', 'appointment_reminders'
  ]) {
    assert.ok(calls.some(([kind, name]) => kind === 'createTable' && name === table), `Missing table ${table}`);
  }
  assert.ok(calls.some(([kind, name]) => kind === 'addIndex' && name === 'appointments'));
});
