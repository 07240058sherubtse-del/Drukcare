const express = require('express');
const { Op } = require('sequelize');
const { Hospital, Department, Doctor, AppointmentSlot } = require('../models');
const dzongkhags = require('../config/dzongkhags');

const router = express.Router();

router.get('/hospitals', async (req, res, next) => {
  try {
    const where = {};
    if (dzongkhags.includes(req.query.dzongkhag)) where.dzongkhag = req.query.dzongkhag;
    if (req.query.type) where.facilityType = req.query.type;
    if (req.query.q) where.name = { [Op.iLike]: `%${String(req.query.q).slice(0, 80)}%` };
    const hospitals = await Hospital.findAll({
      where,
      include: [{ model: Department, as: 'departments' }, { model: Doctor, as: 'doctors' }],
      order: [['dzongkhag', 'ASC'], ['name', 'ASC']]
    });
    const latitude = Number(req.query.lat);
    const longitude = Number(req.query.lng);
    const hasLocation = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
      && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
    if (hasLocation) {
      for (const hospital of hospitals) {
        if (!hospital.coordinatesVerified || hospital.latitude == null || hospital.longitude == null) continue;
        const lat = Number(hospital.latitude) * Math.PI / 180;
        const userLat = latitude * Math.PI / 180;
        const deltaLat = lat - userLat;
        const deltaLng = Number(hospital.longitude) * Math.PI / 180 - longitude * Math.PI / 180;
        const a = Math.sin(deltaLat / 2) ** 2
          + Math.cos(userLat) * Math.cos(lat) * Math.sin(deltaLng / 2) ** 2;
        hospital.distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
      hospitals.sort((a, b) => {
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        return a.distanceKm - b.distanceKm;
      });
    }
    const types = await Hospital.findAll({ attributes: ['facilityType'], group: ['facilityType'], raw: true });
    const locationMessage = hasLocation && hospitals.every((hospital) => hospital.distanceKm == null)
      ? 'No listed facility has verified coordinates yet, so nearby sorting is not available.'
      : null;
    return res.render('directory/hospitals', {
      hospitals, dzongkhags, types: types.map((item) => item.facilityType),
      filters: req.query, locationMessage
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/hospitals/:id', async (req, res, next) => {
  try {
    const hospital = await Hospital.findByPk(req.params.id, {
      include: [
        { model: Department, as: 'departments' },
        { model: Doctor, as: 'doctors', include: [{ model: Department, as: 'department' }] }
      ]
    });
    if (!hospital) return res.status(404).render('error', { title: 'Facility not found', message: 'We could not find that directory listing.' });
    return res.render('directory/hospital', { hospital });
  } catch (error) {
    return next(error);
  }
});

router.get('/doctors', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.q) where.name = { [Op.iLike]: `%${String(req.query.q).slice(0, 80)}%` };
    if (req.query.specialization) where.specialization = req.query.specialization;
    const doctors = await Doctor.findAll({
      where,
      include: [
        { model: Hospital, as: 'hospital', where: req.query.dzongkhag && dzongkhags.includes(req.query.dzongkhag) ? { dzongkhag: req.query.dzongkhag } : undefined },
        { model: Department, as: 'department' }
      ],
      order: [['name', 'ASC']]
    });
    const specializations = await Doctor.findAll({ attributes: ['specialization'], group: ['specialization'], raw: true });
    return res.render('directory/doctors', { doctors, dzongkhags, specializations: specializations.map((item) => item.specialization), filters: req.query });
  } catch (error) {
    return next(error);
  }
});

router.get('/doctors/:id', async (req, res, next) => {
  try {
    const doctor = await Doctor.findByPk(req.params.id, {
      include: [
        { model: Hospital, as: 'hospital' },
        { model: Department, as: 'department' },
        { model: AppointmentSlot, as: 'slots', where: { status: 'available', startsAt: { [Op.gt]: new Date() } }, required: false }
      ]
    });
    if (!doctor) return res.status(404).render('error', { title: 'Doctor not found', message: 'We could not find that provider.' });
    return res.render('directory/doctor', { doctor });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
