const { DataTypes, Op } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  email: { type: DataTypes.STRING(254), allowNull: false, unique: true },
  phone: { type: DataTypes.STRING(30), allowNull: false },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  dzongkhag: { type: DataTypes.STRING(60), allowNull: false },
  address: { type: DataTypes.STRING(250) },
  role: { type: DataTypes.ENUM('patient', 'admin'), allowNull: false, defaultValue: 'patient' },
  emailVerifiedAt: { type: DataTypes.DATE }
}, { tableName: 'users', underscored: true });

const Hospital = sequelize.define('Hospital', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(180), allowNull: false },
  dzongkhag: { type: DataTypes.STRING(60), allowNull: false },
  town: { type: DataTypes.STRING(100), allowNull: false },
  facilityType: { type: DataTypes.STRING(80), allowNull: false },
  address: { type: DataTypes.STRING(250) },
  phone: { type: DataTypes.STRING(40) },
  website: { type: DataTypes.STRING(300) },
  latitude: { type: DataTypes.DECIMAL(10, 7) },
  longitude: { type: DataTypes.DECIMAL(10, 7) },
  contactVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  coordinatesVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  isVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  isDemo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  verificationNote: { type: DataTypes.STRING(250) }
}, { tableName: 'hospitals', underscored: true });

const Department = sequelize.define('Department', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  description: { type: DataTypes.STRING(500) }
}, { tableName: 'departments', underscored: true });

const Doctor = sequelize.define('Doctor', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  specialization: { type: DataTypes.STRING(100), allowNull: false },
  bio: { type: DataTypes.STRING(500) },
  isDemo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, { tableName: 'doctors', underscored: true });

const DoctorAvailability = sequelize.define('DoctorAvailability', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  dayOfWeek: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 0, max: 6 } },
  startTime: { type: DataTypes.TIME, allowNull: false },
  endTime: { type: DataTypes.TIME, allowNull: false },
  slotDuration: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 10, max: 180 } },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, {
  tableName: 'doctor_availability',
  underscored: true,
  indexes: [{ unique: true, fields: ['doctor_id', 'day_of_week', 'start_time'] }]
});

const AppointmentSlot = sequelize.define('AppointmentSlot', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  startsAt: { type: DataTypes.DATE, allowNull: false },
  endsAt: { type: DataTypes.DATE, allowNull: false },
  status: {
    type: DataTypes.ENUM('available', 'booked', 'blocked'),
    allowNull: false,
    defaultValue: 'available'
  }
}, {
  tableName: 'appointment_slots',
  underscored: true,
  indexes: [
    { unique: true, fields: ['doctor_id', 'starts_at'] },
    { fields: ['doctor_id', 'status', 'starts_at'] }
  ]
});

const Appointment = sequelize.define('Appointment', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  reference: { type: DataTypes.STRING(16), allowNull: false, unique: true },
  reason: { type: DataTypes.STRING(500) },
  status: {
    type: DataTypes.ENUM('pending', 'confirmed', 'cancelled', 'completed'),
    allowNull: false,
    defaultValue: 'confirmed'
  }
}, {
  tableName: 'appointments',
  underscored: true,
  indexes: [
    { unique: true, fields: ['slot_id'], where: { status: { [Op.ne]: 'cancelled' } } },
    { fields: ['user_id', 'status'] }
  ]
});

const EmailToken = sequelize.define('EmailToken', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  purpose: { type: DataTypes.ENUM('verify_email', 'reset_password'), allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  usedAt: { type: DataTypes.DATE }
}, { tableName: 'email_tokens', underscored: true });

const Reminder = sequelize.define('Reminder', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  kind: { type: DataTypes.ENUM('24h', '2h'), allowNull: false },
  status: { type: DataTypes.ENUM('pending', 'sending', 'sent'), allowNull: false, defaultValue: 'pending' },
  sentAt: { type: DataTypes.DATE },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
}, {
  tableName: 'appointment_reminders',
  underscored: true,
  indexes: [{ unique: true, fields: ['appointment_id', 'kind'] }]
});

Hospital.hasMany(Department, { as: 'departments', foreignKey: { allowNull: false } });
Department.belongsTo(Hospital, { as: 'hospital' });
Hospital.hasMany(Doctor, { as: 'doctors', foreignKey: { allowNull: false } });
Doctor.belongsTo(Hospital, { as: 'hospital' });
Department.hasMany(Doctor, { as: 'doctors', foreignKey: { allowNull: false } });
Doctor.belongsTo(Department, { as: 'department' });
Doctor.hasMany(AppointmentSlot, { as: 'slots', foreignKey: { allowNull: false } });
AppointmentSlot.belongsTo(Doctor, { as: 'doctor' });
Doctor.hasMany(DoctorAvailability, { as: 'availability', foreignKey: { allowNull: false } });
DoctorAvailability.belongsTo(Doctor, { as: 'doctor' });
User.hasMany(Appointment, { as: 'appointments', foreignKey: { allowNull: false } });
Appointment.belongsTo(User, { as: 'patient' });
AppointmentSlot.hasOne(Appointment, { as: 'appointment', foreignKey: { name: 'slotId', allowNull: false } });
Appointment.belongsTo(AppointmentSlot, { as: 'slot', foreignKey: { name: 'slotId', allowNull: false } });
Hospital.hasMany(Appointment, { as: 'appointments', foreignKey: { allowNull: false } });
Appointment.belongsTo(Hospital, { as: 'hospital' });
Doctor.hasMany(Appointment, { as: 'appointments', foreignKey: { allowNull: false } });
Appointment.belongsTo(Doctor, { as: 'doctor' });
User.hasMany(EmailToken, { as: 'emailTokens', foreignKey: { allowNull: false } });
EmailToken.belongsTo(User, { as: 'user' });
Appointment.hasMany(Reminder, { as: 'reminders', foreignKey: { allowNull: false } });
Reminder.belongsTo(Appointment, { as: 'appointment' });

module.exports = {
  sequelize,
  User,
  Hospital,
  Department,
  Doctor,
  DoctorAvailability,
  AppointmentSlot,
  Appointment,
  EmailToken,
  Reminder
};
