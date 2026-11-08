'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const uuid = { type: Sequelize.UUID, allowNull: false };
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    };

    await queryInterface.createTable('users', {
      id: { ...uuid, primaryKey: true },
      name: { type: Sequelize.STRING(120), allowNull: false },
      email: { type: Sequelize.STRING(254), allowNull: false, unique: true },
      phone: { type: Sequelize.STRING(30), allowNull: false },
      password_hash: { type: Sequelize.STRING, allowNull: false },
      dzongkhag: { type: Sequelize.STRING(60), allowNull: false },
      address: Sequelize.STRING(250),
      role: { type: Sequelize.ENUM('patient', 'admin'), allowNull: false, defaultValue: 'patient' },
      email_verified_at: Sequelize.DATE,
      ...timestamps
    });
    await queryInterface.createTable('hospitals', {
      id: { ...uuid, primaryKey: true },
      name: { type: Sequelize.STRING(180), allowNull: false },
      dzongkhag: { type: Sequelize.STRING(60), allowNull: false },
      town: { type: Sequelize.STRING(100), allowNull: false },
      facility_type: { type: Sequelize.STRING(80), allowNull: false },
      address: Sequelize.STRING(250),
      phone: Sequelize.STRING(40),
      website: Sequelize.STRING(300),
      latitude: Sequelize.DECIMAL(10, 7),
      longitude: Sequelize.DECIMAL(10, 7),
      contact_verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      coordinates_verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      is_verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      is_demo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      verification_note: Sequelize.STRING(250),
      ...timestamps
    });
    await queryInterface.createTable('departments', {
      id: { ...uuid, primaryKey: true },
      hospital_id: { ...uuid, references: { model: 'hospitals', key: 'id' }, onDelete: 'CASCADE' },
      name: { type: Sequelize.STRING(100), allowNull: false },
      description: Sequelize.STRING(500),
      ...timestamps
    });
    await queryInterface.createTable('doctors', {
      id: { ...uuid, primaryKey: true },
      hospital_id: { ...uuid, references: { model: 'hospitals', key: 'id' }, onDelete: 'CASCADE' },
      department_id: { ...uuid, references: { model: 'departments', key: 'id' }, onDelete: 'CASCADE' },
      name: { type: Sequelize.STRING(120), allowNull: false },
      specialization: { type: Sequelize.STRING(100), allowNull: false },
      bio: Sequelize.STRING(500),
      is_demo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      ...timestamps
    });
    await queryInterface.createTable('doctor_availability', {
      id: { ...uuid, primaryKey: true },
      doctor_id: { ...uuid, references: { model: 'doctors', key: 'id' }, onDelete: 'CASCADE' },
      day_of_week: { type: Sequelize.INTEGER, allowNull: false },
      start_time: { type: Sequelize.TIME, allowNull: false },
      end_time: { type: Sequelize.TIME, allowNull: false },
      slot_duration: { type: Sequelize.INTEGER, allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps
    });
    await queryInterface.addConstraint('doctor_availability', {
      fields: ['doctor_id', 'day_of_week', 'start_time'],
      type: 'unique',
      name: 'doctor_availability_doctor_day_start_unique'
    });
    await queryInterface.createTable('appointment_slots', {
      id: { ...uuid, primaryKey: true },
      doctor_id: { ...uuid, references: { model: 'doctors', key: 'id' }, onDelete: 'CASCADE' },
      starts_at: { type: Sequelize.DATE, allowNull: false },
      ends_at: { type: Sequelize.DATE, allowNull: false },
      status: { type: Sequelize.ENUM('available', 'booked', 'blocked'), allowNull: false, defaultValue: 'available' },
      ...timestamps
    });
    await queryInterface.addConstraint('appointment_slots', {
      fields: ['doctor_id', 'starts_at'],
      type: 'unique',
      name: 'appointment_slots_doctor_start_unique'
    });
    await queryInterface.createTable('appointments', {
      id: { ...uuid, primaryKey: true },
      user_id: { ...uuid, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      hospital_id: { ...uuid, references: { model: 'hospitals', key: 'id' }, onDelete: 'RESTRICT' },
      doctor_id: { ...uuid, references: { model: 'doctors', key: 'id' }, onDelete: 'RESTRICT' },
      slot_id: { ...uuid, references: { model: 'appointment_slots', key: 'id' }, onDelete: 'RESTRICT' },
      reference: { type: Sequelize.STRING(16), allowNull: false, unique: true },
      reason: Sequelize.STRING(500),
      status: { type: Sequelize.ENUM('pending', 'confirmed', 'cancelled', 'completed'), allowNull: false, defaultValue: 'confirmed' },
      ...timestamps
    });
    await queryInterface.addIndex('appointments', ['slot_id'], {
      unique: true,
      where: { status: { [Sequelize.Op.ne]: 'cancelled' } },
      name: 'appointments_one_active_booking_per_slot'
    });
    await queryInterface.createTable('email_tokens', {
      id: { ...uuid, primaryKey: true },
      user_id: { ...uuid, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      token_hash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      purpose: { type: Sequelize.ENUM('verify_email', 'reset_password'), allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      used_at: Sequelize.DATE,
      ...timestamps
    });
    await queryInterface.createTable('appointment_reminders', {
      id: { ...uuid, primaryKey: true },
      appointment_id: { ...uuid, references: { model: 'appointments', key: 'id' }, onDelete: 'CASCADE' },
      kind: { type: Sequelize.ENUM('24h', '2h'), allowNull: false },
      status: { type: Sequelize.ENUM('pending', 'sending', 'sent'), allowNull: false, defaultValue: 'pending' },
      sent_at: Sequelize.DATE,
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      ...timestamps
    });
    await queryInterface.addConstraint('appointment_reminders', {
      fields: ['appointment_id', 'kind'],
      type: 'unique',
      name: 'appointment_reminders_appointment_kind_unique'
    });
  },

  async down(queryInterface) {
    for (const table of [
      'appointment_reminders',
      'email_tokens',
      'appointments',
      'appointment_slots',
      'doctor_availability',
      'doctors',
      'departments',
      'hospitals',
      'users'
    ]) {
      await queryInterface.dropTable(table);
    }
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_users_role";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_appointment_slots_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_appointments_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_email_tokens_purpose";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_appointment_reminders_kind";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_appointment_reminders_status";');
  }
};
