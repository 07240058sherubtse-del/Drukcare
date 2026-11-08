const cron = require('node-cron');
const { Op } = require('sequelize');
const { sequelize, Appointment, AppointmentSlot, User, Hospital, Doctor, Department, Reminder } = require('../models');
const { sendEmail } = require('./email');

async function deliverDueReminders() {
  const now = new Date();
  const targets = [
    { kind: '24h', from: new Date(now.getTime() + 23.5 * 60 * 60 * 1000), to: new Date(now.getTime() + 24.5 * 60 * 60 * 1000) },
    { kind: '2h', from: new Date(now.getTime() + 1.5 * 60 * 60 * 1000), to: new Date(now.getTime() + 2.5 * 60 * 60 * 1000) }
  ];

  for (const target of targets) {
    const appointments = await Appointment.findAll({
      where: { status: { [Op.in]: ['pending', 'confirmed'] } },
      include: [
        { model: User, as: 'patient', required: true },
        { model: Hospital, as: 'hospital', required: true },
        { model: Doctor, as: 'doctor', required: true, include: [{ model: Department, as: 'department', required: true }] },
        { model: AppointmentSlot, as: 'slot', required: true, where: { startsAt: { [Op.between]: [target.from, target.to] } } },
        { model: Reminder, as: 'reminders', required: false, where: { kind: target.kind } }
      ]
    });
    for (const appointment of appointments) {
      const transaction = await sequelize.transaction();
      let reminder;
      try {
        [reminder] = await Reminder.findOrCreate({
          where: { appointmentId: appointment.id, kind: target.kind },
          defaults: { status: 'pending', attempts: 0 },
          transaction
        });
        reminder = await Reminder.findByPk(reminder.id, {
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        const staleClaim = reminder.status === 'sending'
          && reminder.updatedAt < new Date(Date.now() - 30 * 60 * 1000);
        if (reminder.status === 'sent' || (reminder.status === 'sending' && !staleClaim)) {
          await transaction.rollback();
          continue;
        }
        await reminder.update({ status: 'sending', attempts: reminder.attempts + 1 }, { transaction });
        await transaction.commit();
      } catch (error) {
        if (!transaction.finished) await transaction.rollback();
        throw error;
      }
      try {
        await sendEmail({
          to: appointment.patient.email,
          subject: `DrukCare appointment reminder (${target.kind})`,
          text: `Hello ${appointment.patient.name}, your appointment ${appointment.reference} with ${appointment.doctor.name} (${appointment.doctor.department.name}, ${appointment.doctor.specialization}) at ${appointment.hospital.name}, ${appointment.hospital.town}, ${appointment.hospital.dzongkhag} is scheduled for ${appointment.slot.startsAt.toLocaleString('en-GB', { timeZone: 'Asia/Thimphu' })} Bhutan time.`
        });
        await reminder.update({ status: 'sent', sentAt: new Date() });
      } catch (error) {
        await reminder.update({ status: 'pending' });
        console.error(`Could not send reminder ${reminder.id}:`, error);
      }
    }
  }
}

function startReminderWorker() {
  cron.schedule('*/10 * * * *', () => {
    deliverDueReminders().catch((error) => console.error('Appointment reminder job failed:', error));
  }, { timezone: 'Asia/Thimphu' });
}

module.exports = { deliverDueReminders, startReminderWorker };
