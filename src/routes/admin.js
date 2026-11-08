const express = require('express');
const { Op } = require('sequelize');
const { body, validationResult } = require('express-validator');
const { requireAdmin } = require('../middleware/auth');
const {
  sequelize, Hospital, Department, Doctor, DoctorAvailability, User, Appointment, AppointmentSlot
} = require('../models');
const dzongkhags = require('../config/dzongkhags');
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function bhutanLocalDate(date) {
  const local = new Date(date.getTime() + 6 * 60 * 60 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
}

const router = express.Router();
router.use(requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const appointmentWhere = {};
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.query.hospitalId || '')) {
      appointmentWhere.hospitalId = req.query.hospitalId;
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.query.doctorId || '')) {
      appointmentWhere.doctorId = req.query.doctorId;
    }
    if (req.query.q) appointmentWhere.reference = { [Op.iLike]: `%${String(req.query.q).slice(0, 40)}%` };
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')
      ? new Date(`${req.query.date}T00:00:00Z`)
      : null;
    const dateFilter = parsedDate
      && !Number.isNaN(parsedDate.getTime())
      && parsedDate.toISOString().slice(0, 10) === req.query.date;
    const dateStart = dateFilter ? new Date(`${req.query.date}T00:00:00+06:00`) : null;
    const slotWhere = dateFilter
      ? {
        startsAt: {
          [Op.gte]: dateStart,
          [Op.lt]: new Date(dateStart.getTime() + 24 * 60 * 60 * 1000)
        }
      }
      : undefined;
    const [patients, hospitals, departments, doctors, appointments, upcoming] = await Promise.all([
      User.count({ where: { role: 'patient' } }),
      Hospital.count(),
      Department.count(),
      Doctor.count(),
      Appointment.count(),
      Appointment.count({
        where: { status: { [Op.in]: ['pending', 'confirmed'] } },
        include: [{ model: AppointmentSlot, as: 'slot', required: true, where: { startsAt: { [Op.gt]: new Date() } } }]
      })
    ]);
    const [hospitalRows, departmentRows, doctorRows, appointmentRows, availabilityRows, slotRows] = await Promise.all([
      Hospital.findAll({ order: [['dzongkhag', 'ASC'], ['name', 'ASC']] }),
      Department.findAll({ include: [{ model: Hospital, as: 'hospital' }], order: [['name', 'ASC']] }),
      Doctor.findAll({ include: [{ model: Hospital, as: 'hospital' }, { model: Department, as: 'department' }] }),
      Appointment.findAll({
        where: appointmentWhere,
        include: [
          { model: User, as: 'patient' },
          { model: Hospital, as: 'hospital' },
          { model: Doctor, as: 'doctor' },
          { model: AppointmentSlot, as: 'slot', where: slotWhere, required: Boolean(slotWhere) }
        ],
        order: [['createdAt', 'DESC']],
        limit: 100
      }),
      DoctorAvailability.findAll({
        include: [{ model: Doctor, as: 'doctor', include: [{ model: Hospital, as: 'hospital' }] }],
        order: [['dayOfWeek', 'ASC'], ['startTime', 'ASC']]
      }),
      AppointmentSlot.findAll({
        where: { startsAt: { [Op.gt]: new Date() } },
        include: [{ model: Doctor, as: 'doctor', include: [{ model: Hospital, as: 'hospital' }] }],
        order: [['startsAt', 'ASC']],
        limit: 100
      })
    ]);
    return res.render('admin/index', {
      stats: { patients, hospitals, departments, doctors, appointments, upcoming },
      hospitalRows, departmentRows, doctorRows, appointmentRows, availabilityRows, slotRows, dayNames, dzongkhags,
      filters: req.query,
      facilityTypes: ['National Referral Hospital', 'Regional Referral Hospital', 'District Hospital', 'General Hospital', 'Basic Health Unit', 'Primary Health Centre', 'Demonstration facility']
    });

router.post('/availability',
    body('doctorId').isUUID(),
    body('dayOfWeek').isInt({ min: 0, max: 6 }),
    body('startTime').matches(/^([01]\d|2[0-3]):[0-5]\d$/),
    body('endTime').matches(/^([01]\d|2[0-3]):[0-5]\d$/),
    body('slotDuration').isInt({ min: 10, max: 180 }),
    async (req, res, next) => {
      try {
        const { doctorId, dayOfWeek, startTime, endTime } = req.body;
        if (!validationResult(req).isEmpty()
          || startTime >= endTime
          || !await Doctor.findByPk(doctorId)) {
          req.session.flash = { type: 'danger', text: 'Choose a provider and valid Bhutan-time working hours.' };
          return res.redirect('/admin');
        }
        const day = Number(dayOfWeek);
        const schedules = await DoctorAvailability.findAll({ where: { doctorId, dayOfWeek: day, active: true } });
        const matching = schedules.find((item) => item.startTime.slice(0, 5) === startTime);
        const overlaps = schedules.some((item) =>
          item.id !== matching?.id
          && startTime < item.endTime.slice(0, 5)
          && endTime > item.startTime.slice(0, 5)
        );
        if (overlaps) {
          req.session.flash = { type: 'danger', text: 'This working period overlaps another schedule for that day.' };
          return res.redirect('/admin');
        }
        const values = {
          endTime: `${endTime}:00`,
          slotDuration: Number(req.body.slotDuration),
          active: true
        };
        if (matching) await matching.update(values);
        else await DoctorAvailability.create({
          doctorId, dayOfWeek: day, startTime: `${startTime}:00`, ...values
        });

        const slots = [];
        const today = new Date();
        const todayBhutan = new Date(today.getTime() + 6 * 60 * 60 * 1000);
        const midnightUtc = Date.UTC(todayBhutan.getUTCFullYear(), todayBhutan.getUTCMonth(), todayBhutan.getUTCDate());
        for (let offset = 0; offset < 60; offset += 1) {
          const calendarDay = new Date(midnightUtc + offset * 24 * 60 * 60 * 1000);
          if (calendarDay.getUTCDay() !== day) continue;
          const date = bhutanLocalDate(calendarDay);
          const periodStart = new Date(`${date}T${startTime}:00+06:00`);
          const periodEnd = new Date(`${date}T${endTime}:00+06:00`);
          for (let start = periodStart; start.getTime() + values.slotDuration * 60000 <= periodEnd.getTime(); start = new Date(start.getTime() + values.slotDuration * 60000)) {
            if (start > today) {
              slots.push({
                id: require('node:crypto').randomUUID(),
                doctorId,
                startsAt: start,
                endsAt: new Date(start.getTime() + values.slotDuration * 60000),
                status: 'available',
                createdAt: new Date(),
                updatedAt: new Date()
              });
            }
          }
        }
        if (slots.length) await AppointmentSlot.bulkCreate(slots, { ignoreDuplicates: true });
        req.session.flash = { type: 'success', text: `Schedule saved. ${slots.length} upcoming slot(s) generated for the next 60 days.` };
        return res.redirect('/admin');
      } catch (error) {
        return next(error);
      }
    });

router.post('/slots/:id/status', async (req, res, next) => {
    let transaction;
    try {
      if (!['available', 'blocked'].includes(req.body.status)) {
        return res.status(400).render('error', { title: 'Invalid slot status', message: 'Select a valid slot status.' });
      }
      transaction = await sequelize.transaction();
      const slot = await AppointmentSlot.findByPk(req.params.id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!slot) {
        await transaction.rollback();
        return res.status(404).render('error', { title: 'Slot not found', message: 'No matching slot was found.' });
      }
      if (slot.status === 'booked') {
        await transaction.rollback();
        req.session.flash = { type: 'danger', text: 'Booked appointment slots cannot be blocked or released here.' };
        return res.redirect('/admin');
      }
      await slot.update({ status: req.body.status }, { transaction });
      await transaction.commit();
      req.session.flash = { type: 'success', text: `Slot ${req.body.status === 'blocked' ? 'blocked' : 'made available'}.` };
      return res.redirect('/admin');
    } catch (error) {
      if (transaction && !transaction.finished) await transaction.rollback();
      return next(error);
    }
});
  } catch (error) {
    return next(error);
  }
});

router.post('/hospitals',
  body('name').trim().isLength({ min: 2, max: 180 }),
  body('dzongkhag').isIn(dzongkhags),
  body('town').trim().isLength({ min: 2, max: 100 }),
  body('facilityType').trim().isLength({ min: 2, max: 80 }),
  body('website').optional({ values: 'falsy' }).isURL({ protocols: ['http', 'https'], require_protocol: true }),
  body('latitude').optional({ values: 'falsy' }).isFloat({ min: -90, max: 90 }),
  body('longitude').optional({ values: 'falsy' }).isFloat({ min: -180, max: 180 }),
  async (req, res, next) => {
    try {
      if (!validationResult(req).isEmpty()
        || ((req.body.latitude || req.body.longitude) && !(req.body.latitude && req.body.longitude))
        || (req.body.coordinatesVerified === 'on' && !(req.body.latitude && req.body.longitude))) {
        req.session.flash = { type: 'danger', text: 'Enter a facility name, town, valid Dzongkhag and facility type.' };
        return res.redirect('/admin');
      }
      await Hospital.create({
        name: req.body.name.trim(), dzongkhag: req.body.dzongkhag,
        town: req.body.town.trim(), facilityType: req.body.facilityType.trim(),
        address: req.body.address?.trim() || null,
        phone: req.body.phone?.trim() || null,
        website: req.body.website?.trim() || null,
        contactVerified: req.body.contactVerified === 'on',
        coordinatesVerified: req.body.coordinatesVerified === 'on',
        latitude: req.body.coordinatesVerified === 'on' ? Number(req.body.latitude) : null,
        longitude: req.body.coordinatesVerified === 'on' ? Number(req.body.longitude) : null,
        isVerified: req.body.facilityVerified === 'on',
        verificationNote: req.body.facilityVerified === 'on'
          ? 'Facility information independently verified by an administrator.'
          : 'Entered by an administrator; facility information has not been independently verified.'
      });
      req.session.flash = { type: 'success', text: 'Facility added.' };
      return res.redirect('/admin');
    } catch (error) {
      return next(error);
    }
  });

router.post('/hospitals/:id',
  body('name').trim().isLength({ min: 2, max: 180 }),
  body('dzongkhag').isIn(dzongkhags),
  body('town').trim().isLength({ min: 2, max: 100 }),
  body('facilityType').trim().isLength({ min: 2, max: 80 }),
  body('website').optional({ values: 'falsy' }).isURL({ protocols: ['http', 'https'], require_protocol: true }),
  async (req, res, next) => {
    try {
      if (!validationResult(req).isEmpty()) {
        req.session.flash = { type: 'danger', text: 'Facility details are invalid.' };
        return res.redirect('/admin');
      }
      const hospital = await Hospital.findByPk(req.params.id);
      if (!hospital) return res.status(404).render('error', { title: 'Facility not found', message: 'No matching facility was found.' });
      await hospital.update({
        name: req.body.name.trim(),
        dzongkhag: req.body.dzongkhag,
        town: req.body.town.trim(),
        facilityType: req.body.facilityType.trim(),
        address: req.body.address?.trim() || null,
        phone: req.body.phone?.trim() || null,
        website: req.body.website?.trim() || null,
        contactVerified: req.body.contactVerified === 'on',
        isVerified: req.body.facilityVerified === 'on',
        verificationNote: req.body.facilityVerified === 'on'
          ? 'Facility information independently verified by an administrator.'
          : 'Facility information has not been independently verified.'
      });
      req.session.flash = { type: 'success', text: 'Facility details updated.' };
      return res.redirect('/admin');
    } catch (error) {
      return next(error);
    }
  });

router.post('/hospitals/:id/delete', async (req, res, next) => {
  try {
    const hospital = await Hospital.findByPk(req.params.id);
    if (!hospital) return res.status(404).render('error', { title: 'Facility not found', message: 'No matching facility was found.' });
    if (await Appointment.count({ where: { hospitalId: hospital.id } })) {
      req.session.flash = { type: 'danger', text: 'Facilities with appointment history cannot be deleted.' };
      return res.redirect('/admin');
    }
    await hospital.destroy();
    req.session.flash = { type: 'success', text: 'Facility deleted.' };
    return res.redirect('/admin');
  } catch (error) {
    return next(error);
  }
});

router.post('/departments',
  body('hospitalId').isUUID(),
  body('name').trim().isLength({ min: 2, max: 100 }),
  async (req, res, next) => {
    try {
      if (!validationResult(req).isEmpty() || !await Hospital.findByPk(req.body.hospitalId)) {
        req.session.flash = { type: 'danger', text: 'Choose a facility and enter a valid department name.' };
        return res.redirect('/admin');
      }
      await Department.create({ hospitalId: req.body.hospitalId, name: req.body.name.trim() });
      req.session.flash = { type: 'success', text: 'Department added.' };
      return res.redirect('/admin');
    } catch (error) {
      return next(error);
    }
  });

router.post('/departments/:id',
  body('name').trim().isLength({ min: 2, max: 100 }),
  async (req, res, next) => {
    try {
      if (!validationResult(req).isEmpty()) {
        req.session.flash = { type: 'danger', text: 'Enter a valid department name.' };
        return res.redirect('/admin');
      }
      const department = await Department.findByPk(req.params.id);
      if (!department) return res.status(404).render('error', { title: 'Department not found', message: 'No matching department was found.' });
      await department.update({ name: req.body.name.trim() });
      req.session.flash = { type: 'success', text: 'Department updated.' };
      return res.redirect('/admin');
    } catch (error) {
      return next(error);
    }
  });

router.post('/departments/:id/delete', async (req, res, next) => {
  try {
    const department = await Department.findByPk(req.params.id);
    if (!department) return res.status(404).render('error', { title: 'Department not found', message: 'No matching department was found.' });
    if (await Doctor.count({ where: { departmentId: department.id } })) {
      req.session.flash = { type: 'danger', text: 'Departments with assigned providers cannot be deleted.' };
      return res.redirect('/admin');
    }
    await department.destroy();
    req.session.flash = { type: 'success', text: 'Department deleted.' };
    return res.redirect('/admin');
  } catch (error) {
    return next(error);
  }
});

router.post('/doctors',
  body('hospitalId').isUUID(),
  body('departmentId').isUUID(),
  body('name').trim().isLength({ min: 2, max: 120 }),
  body('specialization').trim().isLength({ min: 2, max: 100 }),
  async (req, res, next) => {
    try {
      const department = await Department.findByPk(req.body.departmentId);
      if (!validationResult(req).isEmpty() || !department || department.hospitalId !== req.body.hospitalId) {
        req.session.flash = { type: 'danger', text: 'Choose a valid facility and its department, then enter the provider details.' };
        return res.redirect('/admin');
      }
      await Doctor.create({
        hospitalId: req.body.hospitalId, departmentId: department.id,
        name: req.body.name.trim(), specialization: req.body.specialization.trim(),
        bio: req.body.bio?.trim() || null, isDemo: req.body.isDemo === 'on'
      });
      req.session.flash = { type: 'success', text: 'Doctor added.' };
      return res.redirect('/admin');
    } catch (error) {
      return next(error);
    }
  });

router.post('/doctors/:id',
  body('hospitalId').isUUID(),
  body('departmentId').isUUID(),
  body('name').trim().isLength({ min: 2, max: 120 }),
  body('specialization').trim().isLength({ min: 2, max: 100 }),
  async (req, res, next) => {
    try {
      const doctor = await Doctor.findByPk(req.params.id);
      const department = await Department.findByPk(req.body.departmentId);
      if (!doctor) return res.status(404).render('error', { title: 'Doctor not found', message: 'No matching provider was found.' });
      if (!validationResult(req).isEmpty() || !department || department.hospitalId !== req.body.hospitalId) {
        req.session.flash = { type: 'danger', text: 'Choose a valid facility and its department, then enter the provider details.' };
        return res.redirect('/admin');
      }
      await doctor.update({
        hospitalId: req.body.hospitalId,
        departmentId: department.id,
        name: req.body.name.trim(),
        specialization: req.body.specialization.trim(),
        bio: req.body.bio?.trim() || null,
        isDemo: req.body.isDemo === 'on'
      });
      req.session.flash = { type: 'success', text: 'Provider details updated.' };
      return res.redirect('/admin');
    } catch (error) {
      return next(error);
    }
  });

router.post('/doctors/:id/delete', async (req, res, next) => {
  try {
    const doctor = await Doctor.findByPk(req.params.id);
    if (!doctor) return res.status(404).render('error', { title: 'Doctor not found', message: 'No matching provider was found.' });
    if (await Appointment.count({ where: { doctorId: doctor.id } })) {
      req.session.flash = { type: 'danger', text: 'Providers with appointment history cannot be deleted.' };
      return res.redirect('/admin');
    }
    await doctor.destroy();
    req.session.flash = { type: 'success', text: 'Provider deleted.' };
    return res.redirect('/admin');
  } catch (error) {
    return next(error);
  }
});

router.post('/slots',
  body('doctorId').isUUID(),
  body('startsAt').isISO8601(),
  body('duration').isInt({ min: 10, max: 180 }),
  async (req, res, next) => {
    try {
      const start = new Date(`${req.body.startsAt}:00+06:00`);
      if (!validationResult(req).isEmpty() || start <= new Date() || !await Doctor.findByPk(req.body.doctorId)) {
        req.session.flash = { type: 'danger', text: 'Select a provider and a future date/time with a valid duration.' };
        return res.redirect('/admin');
      }
      await AppointmentSlot.create({
        doctorId: req.body.doctorId,
        startsAt: start,
        endsAt: new Date(start.getTime() + Number(req.body.duration) * 60 * 1000)
      });
      req.session.flash = { type: 'success', text: 'Appointment slot created.' };
      return res.redirect('/admin');
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        req.session.flash = { type: 'danger', text: 'This provider already has a slot at that start time.' };
        return res.redirect('/admin');
      }
      return next(error);
    }
  });

router.post('/appointments/:id/status', async (req, res, next) => {
  let transaction;
  try {
    if (!['confirmed', 'cancelled', 'completed'].includes(req.body.status)) {
      return res.status(400).render('error', { title: 'Invalid status', message: 'Select a valid appointment status.' });
    }
    transaction = await sequelize.transaction();
    const appointment = await Appointment.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!appointment) {
      await transaction.rollback();
      return res.status(404).render('error', { title: 'Appointment not found', message: 'No matching appointment was found.' });
    }
    if (appointment.status === req.body.status) {
      await transaction.rollback();
      req.session.flash = { type: 'info', text: 'Appointment already has that status.' };
      return res.redirect('/admin');
    }
    if (req.body.status === 'confirmed' && appointment.status === 'cancelled') {
      await transaction.rollback();
      req.session.flash = { type: 'danger', text: 'A cancelled appointment cannot be restored. Create a new booking instead.' };
      return res.redirect('/admin');
    }
    if (appointment.status === 'cancelled' && req.body.status !== 'cancelled') {
      await transaction.rollback();
      req.session.flash = { type: 'danger', text: 'A cancelled appointment cannot be changed to another status.' };
      return res.redirect('/admin');
    }
    const slot = await AppointmentSlot.findByPk(appointment.slotId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (req.body.status === 'cancelled' && slot) await slot.update({ status: 'available' }, { transaction });
    await appointment.update({ status: req.body.status }, { transaction });
    await transaction.commit();
    req.session.flash = { type: 'success', text: 'Appointment status updated.' };
    return res.redirect('/admin');
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    return next(error);
  }
});

module.exports = router;
