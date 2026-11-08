const crypto = require('node:crypto');
const express = require('express');
const { Op, Transaction } = require('sequelize');
const { body, validationResult } = require('express-validator');
const dzongkhags = require('../config/dzongkhags');
const {
  sequelize, Hospital, Department, Doctor, AppointmentSlot, Appointment, User, Reminder
} = require('../models');
const { requireLogin, requireVerified } = require('../middleware/auth');
const { sendEmail } = require('../services/email');

const router = express.Router();

router.get('/book', requireLogin, async (req, res, next) => {
  try {
    const hospitalFilter = dzongkhags.includes(req.query.dzongkhag) ? { dzongkhag: req.query.dzongkhag } : {};
    const hospitals = await Hospital.findAll({ where: hospitalFilter, order: [['dzongkhag', 'ASC'], ['name', 'ASC']] });
      let rescheduling = null;
      if (req.query.reschedule) {
        rescheduling = await Appointment.findOne({
          where: {
            id: req.query.reschedule,
            userId: req.session.user.id,
            status: { [Op.in]: ['pending', 'confirmed'] }
          },
          include: [
            { model: AppointmentSlot, as: 'slot' },
            { model: Doctor, as: 'doctor' }
          ]
        });
        if (!rescheduling || rescheduling.slot.startsAt <= new Date()) {
          return res.status(404).render('error', { title: 'Appointment unavailable', message: 'This appointment can no longer be rescheduled.' });
        }
      }
    const selectedHospitalId = req.query.hospital || rescheduling?.hospitalId;
    const selectedHospital = selectedHospitalId ? await Hospital.findByPk(selectedHospitalId) : null;
    const departments = selectedHospital
      ? await Department.findAll({ where: { hospitalId: selectedHospital.id }, order: [['name', 'ASC']] })
      : [];
    const selectedDepartmentId = req.query.department || rescheduling?.doctor?.departmentId;
    const selectedDepartment = selectedDepartmentId
      ? departments.find((department) => department.id === selectedDepartmentId)
      : null;
    const doctors = selectedDepartment
      ? await Doctor.findAll({ where: { hospitalId: selectedHospital.id, departmentId: selectedDepartment.id }, order: [['name', 'ASC']] })
      : [];
    const selectedDoctorId = req.query.doctor || rescheduling?.doctorId;
    const selectedDoctor = selectedDoctorId ? doctors.find((doctor) => doctor.id === selectedDoctorId) : null;
    const slots = selectedDoctor
      ? await AppointmentSlot.findAll({
        where: { doctorId: selectedDoctor.id, status: 'available', startsAt: { [Op.gt]: new Date() } },
        order: [['startsAt', 'ASC']]
      })
      : [];
    return res.render('appointments/book', {
      hospitals, departments, doctors, slots,
      selected: {
        hospital: selectedHospital?.id,
        department: selectedDepartment?.id,
        doctor: selectedDoctor?.id,
        slot: req.query.slot,
        dzongkhag: hospitalFilter.dzongkhag,
        reschedule: rescheduling?.id
      },
      rescheduling,
      dzongkhags
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/appointments/:id/reschedule', requireLogin, requireVerified,
    body('slotId').isUUID().withMessage('Select an available appointment time.'),
    async (req, res, next) => {
      if (!validationResult(req).isEmpty()) {
        req.session.flash = { type: 'danger', text: 'Select a valid appointment time.' };
        return res.redirect('/dashboard');
      }
      let transaction;
      try {
        transaction = await sequelize.transaction();
        const appointment = await Appointment.findOne({
          where: {
            id: req.params.id,
            userId: req.session.user.id,
            status: { [Op.in]: ['pending', 'confirmed'] }
          },
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (!appointment) {
          await transaction.rollback();
          return res.status(404).render('error', { title: 'Appointment unavailable', message: 'This appointment cannot be rescheduled.' });
        }
        const oldSlot = await AppointmentSlot.findByPk(appointment.slotId, { transaction });
        if (!oldSlot || oldSlot.startsAt <= new Date()) {
          await transaction.rollback();
          req.session.flash = { type: 'danger', text: 'This appointment can no longer be rescheduled.' };
          return res.redirect('/dashboard');
        }
        if (req.body.slotId === oldSlot.id) {
          await transaction.rollback();
          req.session.flash = { type: 'info', text: 'Choose a different appointment time to reschedule.' };
          return res.redirect('/dashboard');
        }
        const slots = await AppointmentSlot.findAll({
          where: { id: { [Op.in]: [oldSlot.id, req.body.slotId] } },
          order: [['id', 'ASC']],
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        const slotById = new Map(slots.map((slot) => [slot.id, slot]));
        const newSlot = slotById.get(req.body.slotId);
        if (!newSlot || newSlot.status !== 'available' || newSlot.startsAt <= new Date()) {
          await transaction.rollback();
          req.session.flash = { type: 'danger', text: 'That appointment time is no longer available. Please choose another slot.' };
          return res.redirect(`/book?reschedule=${encodeURIComponent(req.params.id)}`);
        }
        const doctor = await Doctor.findByPk(newSlot.doctorId, { transaction });
        if (!doctor) throw new Error('The selected doctor is no longer available.');
        await slotById.get(oldSlot.id).update({ status: 'available' }, { transaction });
        await newSlot.update({ status: 'booked' }, { transaction });
        await appointment.update({
          slotId: newSlot.id,
          doctorId: doctor.id,
          hospitalId: doctor.hospitalId
        }, { transaction });
        await Reminder.destroy({ where: { appointmentId: appointment.id }, transaction });
        await transaction.commit();

        const details = await Appointment.findByPk(appointment.id, {
          include: [
            { model: User, as: 'patient' },
            { model: Hospital, as: 'hospital' },
            { model: Doctor, as: 'doctor', include: [{ model: Department, as: 'department' }] },
            { model: AppointmentSlot, as: 'slot' }
          ]
        });
        try {
          await sendEmail({
            to: details.patient.email,
            subject: `DrukCare appointment rescheduled: ${details.reference}`,
            text: `Your appointment ${details.reference} has been rescheduled with ${details.doctor.name} (${details.doctor.department.name}, ${details.doctor.specialization}) at ${details.hospital.name}, ${details.hospital.town}, ${details.hospital.dzongkhag} for ${details.slot.startsAt.toLocaleString('en-GB', { timeZone: 'Asia/Thimphu' })} Bhutan time.`
          });
        } catch (error) {
          console.error(`Appointment ${details.reference} was rescheduled, but its notification email failed:`, error);
          req.session.flash = { type: 'warning', text: 'Appointment rescheduled, but the notification email could not be sent.' };
        }
        return res.redirect(`/appointments/${appointment.id}/confirmation`);
      } catch (error) {
        if (transaction && !transaction.finished) await transaction.rollback();
        if (error.name === 'SequelizeUniqueConstraintError') {
          req.session.flash = { type: 'danger', text: 'That time was just booked by someone else. Choose another available slot.' };
          return res.redirect('/dashboard');
        }
        return next(error);
      }
    });

router.post('/appointments', requireLogin, requireVerified,
  body('slotId').isUUID().withMessage('Select an available appointment time.'),
  body('reason').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).withMessage('Visit reason must be 500 characters or fewer.'),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.flash = { type: 'danger', text: errors.array()[0].msg };
      return res.redirect('/book');
    }
    let transaction;
    try {
      transaction = await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED });
      const slot = await AppointmentSlot.findByPk(req.body.slotId, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!slot || slot.status !== 'available' || slot.startsAt <= new Date()) {
        await transaction.rollback();
        req.session.flash = { type: 'danger', text: 'That appointment time is no longer available. Please choose another slot.' };
        return res.redirect('/book');
      }
      const doctor = await Doctor.findByPk(slot.doctorId, { transaction });
      if (!doctor) throw new Error('The selected doctor is no longer available.');
      const reference = `DC-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      await slot.update({ status: 'booked' }, { transaction });
      const appointment = await Appointment.create({
        userId: req.session.user.id,
        hospitalId: doctor.hospitalId,
        doctorId: doctor.id,
        slotId: slot.id,
        reference,
        reason: req.body.reason || null,
        status: 'confirmed'
      }, { transaction });
      await transaction.commit();

      const details = await Appointment.findByPk(appointment.id, {
        include: [
          { model: User, as: 'patient' },
          { model: Hospital, as: 'hospital' },
          { model: Doctor, as: 'doctor', include: [{ model: Department, as: 'department' }] },
          { model: AppointmentSlot, as: 'slot' }
        ]
      });
      try {
        await sendEmail({
          to: details.patient.email,
          subject: `DrukCare appointment confirmed: ${details.reference}`,
          text: `Hello ${details.patient.name}, your appointment ${details.reference} is confirmed with ${details.doctor.name} (${details.doctor.department.name}, ${details.doctor.specialization}) at ${details.hospital.name}, ${details.hospital.town}, ${details.hospital.dzongkhag}. Date and time: ${details.slot.startsAt.toLocaleString('en-GB', { timeZone: 'Asia/Thimphu' })} Bhutan time.`
        });
      } catch (error) {
        console.error(`Appointment ${details.reference} was saved, but its confirmation email failed:`, error);
        req.session.flash = { type: 'warning', text: 'Appointment booked, but the confirmation email could not be sent. Please save your reference.' };
      }
      return res.redirect(`/appointments/${appointment.id}/confirmation`);
    } catch (error) {
      if (transaction && !transaction.finished) await transaction.rollback();
      if (error.name === 'SequelizeUniqueConstraintError') {
        req.session.flash = { type: 'danger', text: 'That time was just booked by someone else. Choose another available slot.' };
        return res.redirect('/book');
      }
      return next(error);
    }
  });

router.get('/appointments/:id/confirmation', requireLogin, async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.session.user.role !== 'admin') where.userId = req.session.user.id;
    const appointment = await Appointment.findOne({
      where,
      include: [
        { model: User, as: 'patient' },
        { model: Hospital, as: 'hospital' },
        { model: Doctor, as: 'doctor', include: [{ model: Department, as: 'department' }] },
        { model: AppointmentSlot, as: 'slot' }
      ]
    });
    if (!appointment) return res.status(404).render('error', { title: 'Appointment not found', message: 'This appointment does not exist or is not accessible to your account.' });
    return res.render('appointments/confirmation', { appointment });
  } catch (error) {
    return next(error);
  }
});

router.post('/appointments/:id/cancel', requireLogin, async (req, res, next) => {
  let transaction;
  try {
    transaction = await sequelize.transaction();
    const where = { id: req.params.id };
    if (req.session.user.role !== 'admin') where.userId = req.session.user.id;
    const appointment = await Appointment.findOne({
      where,
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!appointment) {
      await transaction.rollback();
      return res.status(404).render('error', { title: 'Appointment not found', message: 'This appointment does not exist or is not accessible to your account.' });
    }
    if (['cancelled', 'completed'].includes(appointment.status)) {
      await transaction.rollback();
      req.session.flash = { type: 'warning', text: 'This appointment can no longer be cancelled.' };
      return res.redirect('/dashboard');
    }
    const slot = await AppointmentSlot.findByPk(appointment.slotId, { transaction, lock: transaction.LOCK.UPDATE });
    await appointment.update({ status: 'cancelled' }, { transaction });
    if (slot) await slot.update({ status: 'available' }, { transaction });
    await transaction.commit();
    const [patient, hospital, doctor, slotDetails] = await Promise.all([
      User.findByPk(appointment.userId),
      Hospital.findByPk(appointment.hospitalId),
      Doctor.findByPk(appointment.doctorId),
      AppointmentSlot.findByPk(appointment.slotId)
    ]);
    try {
      await sendEmail({
        to: patient.email,
        subject: `DrukCare appointment cancelled: ${appointment.reference}`,
        text: `Your appointment ${appointment.reference} with ${doctor.name} at ${hospital.name} scheduled for ${slotDetails.startsAt.toLocaleString('en-GB', { timeZone: 'Asia/Thimphu' })} Bhutan time has been cancelled.`
      });
    } catch (error) {
      console.error(`Appointment ${appointment.reference} was cancelled, but its notification email failed:`, error);
    }
    req.session.flash = { type: 'success', text: 'Appointment cancelled. Its time slot is available again.' };
    return res.redirect('/dashboard');
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    return next(error);
  }
});

module.exports = router;
