'use strict';

const bcrypt = require('bcrypt');
const dzongkhags = require('../config/dzongkhags');

const facilities = [
  ['Jigme Dorji Wangchuck National Referral Hospital', 'Thimphu', 'Thimphu', 'National Referral Hospital'],
  ['Paro Hospital', 'Paro', 'Paro', 'District Hospital'],
  ['Phuentsholing General Hospital', 'Chhukha', 'Phuentsholing', 'General Hospital'],
  ['Samtse District Hospital', 'Samtse', 'Samtse', 'District Hospital'],
  ['Central Regional Referral Hospital', 'Sarpang', 'Gelephu', 'Regional Referral Hospital'],
  ['Wangdue Hospital', 'Wangdue Phodrang', 'Wangdue Phodrang', 'District Hospital'],
  ['Eastern Regional Referral Hospital', 'Mongar', 'Mongar', 'Regional Referral Hospital'],
  ['Trashigang Hospital', 'Trashigang', 'Trashigang', 'District Hospital']
];

function localBhutanTime(dayOffset, hour, minute) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(hour - 6, minute, 0, 0);
  return date;
}

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const hospitalIds = new Map();
    for (const [name, dzongkhag, town, facilityType] of facilities) {
      const [row] = await queryInterface.sequelize.query(
        'SELECT id FROM hospitals WHERE name = :name LIMIT 1',
        { replacements: { name }, type: queryInterface.sequelize.QueryTypes.SELECT }
      );
      if (row) {
        hospitalIds.set(name, row.id);
        continue;
      }
      const id = require('node:crypto').randomUUID();
      await queryInterface.bulkInsert('hospitals', [{
        id, name, dzongkhag, town, facility_type: facilityType,
        is_demo: false,
        verification_note: 'Directory name taken from the supplied project brief; not independently verified. Confirm details before relying on or publishing contact information.',
        created_at: now, updated_at: now
      }]);
      hospitalIds.set(name, id);
    }

    const [existingDemo] = await queryInterface.sequelize.query(
      "SELECT id FROM hospitals WHERE name = 'DrukCare Demonstration Clinic' LIMIT 1",
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    const demoHospitalId = existingDemo ? existingDemo.id : require('node:crypto').randomUUID();
    if (!existingDemo) {
      await queryInterface.bulkInsert('hospitals', [{
        id: demoHospitalId,
        name: 'DrukCare Demonstration Clinic (Demo)',
        dzongkhag: 'Thimphu',
        town: 'Thimphu',
        facility_type: 'Demonstration facility',
        is_demo: true,
        verification_note: 'Entirely fictional demonstration listing. Not a real clinic; do not travel to this listing.',
        created_at: now,
        updated_at: now
      }]);
    }

    let departmentId;
    const [existingDepartment] = await queryInterface.sequelize.query(
      "SELECT id FROM departments WHERE hospital_id = :hospitalId AND name = 'General Medicine' LIMIT 1",
      { replacements: { hospitalId: demoHospitalId }, type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    if (existingDepartment) {
      departmentId = existingDepartment.id;
    } else {
      departmentId = require('node:crypto').randomUUID();
      await queryInterface.bulkInsert('departments', [{
        id: departmentId, hospital_id: demoHospitalId,
        name: 'General Medicine', description: 'Demonstration service only.',
        created_at: now, updated_at: now
      }]);
    }

    let doctorId;
    const [existingDoctor] = await queryInterface.sequelize.query(
      "SELECT id FROM doctors WHERE hospital_id = :hospitalId AND name = 'Demo Doctor' LIMIT 1",
      { replacements: { hospitalId: demoHospitalId }, type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    if (existingDoctor) {
      doctorId = existingDoctor.id;
    } else {
      doctorId = require('node:crypto').randomUUID();
      await queryInterface.bulkInsert('doctors', [{
        id: doctorId, hospital_id: demoHospitalId, department_id: departmentId,
        name: 'Demo Doctor (not a real clinician)',
        specialization: 'General Medicine',
        bio: 'Fictional provider record for testing the booking flow. No medical consultation is provided.',
        is_demo: true, created_at: now, updated_at: now
      }]);
    }

    const [existingSlots] = await queryInterface.sequelize.query(
      'SELECT id FROM appointment_slots WHERE doctor_id = :doctorId LIMIT 1',
      { replacements: { doctorId }, type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    if (!existingSlots) {
      const slots = [];
      for (let offset = 1; offset <= 14; offset += 1) {
        const day = localBhutanTime(offset, 9, 0).getUTCDay();
        if (day === 0 || day === 6) continue;
        for (const [hour, minute] of [[9, 0], [9, 30], [10, 0], [10, 30], [14, 0], [14, 30]]) {
          const startsAt = localBhutanTime(offset, hour, minute);
          const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
          slots.push({
            id: require('node:crypto').randomUUID(), doctor_id: doctorId,
            starts_at: startsAt, ends_at: endsAt, status: 'available',
            created_at: now, updated_at: now
          });
        }
      }
      if (slots.length) await queryInterface.bulkInsert('appointment_slots', slots);
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminEmail && adminPassword) {
      const [existingAdmin] = await queryInterface.sequelize.query(
        'SELECT id FROM users WHERE email = :email LIMIT 1',
        { replacements: { email: adminEmail.toLowerCase() }, type: queryInterface.sequelize.QueryTypes.SELECT }
      );
      if (!existingAdmin) {
        await queryInterface.bulkInsert('users', [{
          id: require('node:crypto').randomUUID(),
          name: 'DrukCare Administrator',
          email: adminEmail.toLowerCase(),
          phone: '00000000',
          password_hash: await bcrypt.hash(adminPassword, 12),
          dzongkhag: 'Thimphu',
          role: 'admin',
          email_verified_at: now,
          created_at: now,
          updated_at: now
        }]);
      }
    }

    if (dzongkhags.length !== 20) throw new Error('Expected exactly 20 Dzongkhags in the directory.');
  },

  async down(queryInterface) {
    // Keep administrator-managed data intact; rollback of the schema migration removes the tables.
  }
};
