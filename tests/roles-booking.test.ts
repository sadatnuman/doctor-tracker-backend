import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { AppointmentModel } from '../src/models/appointment.model.js';
import { DoctorModel } from '../src/models/doctor.model.js';
import { PatientModel } from '../src/models/patient.model.js';
import { PaymentModel } from '../src/models/payment.model.js';
import { RefreshTokenModel } from '../src/models/refreshToken.model.js';
import { UserModel } from '../src/models/user.model.js';

let mongo: MongoMemoryServer;
const app = createApp();
const admin = request.agent(app);
const doctorA = request.agent(app);
const patient1 = request.agent(app);
const patient2 = request.agent(app);

let doctorAId: string;
let doctorBId: string;

const doctor = (n: string) => ({
  name: `Dr. ${n} Rahman`,
  specialization: 'General Medicine',
  hospital: 'Mirpur Community Hospital',
  phone: '+880 1712-000000',
  email: `${n.toLowerCase()}@clinic.test`,
  consultationFee: 800,
});

const registration = (n: string) => ({
  name: `${n} Ahmed`,
  email: `${n.toLowerCase()}@patient.test`,
  password: 'Secret1234',
  phone: '+880 1811-000000',
  age: 30,
  gender: 'Male',
});

/** Returns `name=value` pairs from Set-Cookie for re-sending. */
const cookiesOf = (res: request.Response) =>
  Object.fromEntries(
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => {
      const [pair] = c.split(';');
      const [name, ...value] = pair!.split('=');
      return [name, value.join('=')];
    }),
  ) as Record<string, string>;

async function firstOpenSlot(doctorId: string) {
  const res = await request(app).get(`/api/public/doctors/${doctorId}/slots`).query({ days: 14 });
  const slot = res.body.data.days.flatMap((d: { slots: { start: string; available: boolean }[] }) => d.slots).find((s: { available: boolean }) => s.available);
  return slot.start as string;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDB(mongo.getUri());
  await Promise.all([UserModel, DoctorModel, PatientModel, AppointmentModel, PaymentModel, RefreshTokenModel].map((m) => m.init()));
  await UserModel.create({ name: 'Admin', email: 'admin@test.dev', password: 'Password123!', role: 'admin' });
  await admin.post('/api/auth/login').send({ email: 'admin@test.dev', password: 'Password123!' }).expect(200);

  const a = await admin.post('/api/doctors').send({ ...doctor('Ayesha'), password: 'DoctorPass1' }).expect(201);
  const b = await admin.post('/api/doctors').send(doctor('Kamal')).expect(201);
  doctorAId = a.body.data.id;
  doctorBId = b.body.data.id;
  expect(a.body.data.hasAccount).toBe(true);
  expect(b.body.data.hasAccount).toBe(false);
});

afterAll(async () => {
  await disconnectDB();
  await mongo?.stop();
});

describe('registration & one login for every role', () => {
  it('registers a patient and ignores any role sent by the client', async () => {
    const res = await patient1.post('/api/auth/register').send({ ...registration('Rafi'), role: 'admin' }).expect(201);
    expect(res.body.data.user.role).toBe('patient');
    expect(Object.keys(cookiesOf(res))).toEqual(expect.arrayContaining(['dt_access', 'dt_refresh']));
    expect(JSON.stringify(res.body)).not.toContain(cookiesOf(res).dt_refresh); // refresh token never in the body
  });

  it('enforces the password policy and unique emails', async () => {
    const weak = await request(app).post('/api/auth/register').send({ ...registration('Weak'), password: 'password' });
    expect(weak.status).toBe(400);
    const dup = await request(app).post('/api/auth/register').send(registration('Rafi'));
    expect(dup.status).toBe(409);
  });

  it('lets a doctor sign in through the same endpoint', async () => {
    const res = await doctorA.post('/api/auth/login').send({ email: 'ayesha@clinic.test', password: 'DoctorPass1' }).expect(200);
    expect(res.body.data.user).toMatchObject({ role: 'doctor', doctorId: doctorAId });
    await patient2.post('/api/auth/register').send(registration('Sadia')).expect(201);
  });
});

describe('role-based access control', () => {
  it.each([
    ['get', '/api/doctors'],
    ['get', '/api/patients'],
    ['get', '/api/stats/overview'],
    ['post', '/api/doctors'],
  ] as const)('blocks a patient from %s %s', async (method, path) => {
    const res = await patient1[method](path).send({});
    expect(res.status).toBe(403);
  });

  it('keeps doctors out of admin routes and other doctors’ patients', async () => {
    expect((await doctorA.get('/api/stats/overview')).status).toBe(403);
    expect((await doctorA.get('/api/doctors')).status).toBe(403);
    expect((await doctorA.get(`/api/doctors/${doctorBId}/patients`)).status).toBe(403);
    expect((await doctorA.get(`/api/doctors/${doctorAId}/patients`)).status).toBe(200);
    expect((await doctorA.get('/api/me/doctor')).body.data.id).toBe(doctorAId);
  });

  it('serves the public directory without contact details', async () => {
    const res = await request(app).get('/api/public/doctors').expect(200);
    expect(res.body.data[0]).not.toHaveProperty('phone');
    expect(res.body.data[0]).not.toHaveProperty('email');
    expect(res.body.data[0]).toHaveProperty('consultationFee', 800);
  });

  it('lets an admin create or reset a doctor login', async () => {
    await admin.put(`/api/doctors/${doctorBId}/account`).send({ password: 'KamalPass1' }).expect(200);
    const login = await request(app).post('/api/auth/login').send({ email: 'kamal@clinic.test', password: 'KamalPass1' });
    expect(login.body.data.user.role).toBe('doctor');
  });
});

describe('booking with a 5-minute payment hold', () => {
  let slot: string;
  let appointmentId: string;

  it('requires a patient account to book', async () => {
    slot = await firstOpenSlot(doctorAId);
    expect((await request(app).post('/api/appointments').send({ doctorId: doctorAId, start: slot, reason: 'Fever' })).status).toBe(401);
    expect((await doctorA.post('/api/appointments').send({ doctorId: doctorAId, start: slot, reason: 'Fever' })).status).toBe(403);
  });

  it('holds the slot for 5 minutes while the patient pays', async () => {
    const res = await patient1.post('/api/appointments').send({ doctorId: doctorAId, start: slot, reason: 'Fever and cough' }).expect(201);
    appointmentId = res.body.data.id;
    expect(res.body.data).toMatchObject({ status: 'pending_payment', fee: 800 });
    const holdMs = new Date(res.body.data.holdExpiresAt).getTime() - Date.now();
    expect(holdMs).toBeGreaterThan(4.5 * 60_000);
    expect(holdMs).toBeLessThanOrEqual(5 * 60_000);

    const slots = await request(app).get(`/api/public/doctors/${doctorAId}/slots`).query({ days: 14 });
    const held = slots.body.data.days.flatMap((d: { slots: { start: string }[] }) => d.slots).find((s: { start: string }) => s.start === slot);
    expect(held.available).toBe(false);
  });

  it('rejects a second booking of the same slot', async () => {
    const res = await patient2.post('/api/appointments').send({ doctorId: doctorAId, start: slot, reason: 'Headache' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('SLOT_TAKEN');
  });

  it('rejects times that are not on the doctor’s schedule', async () => {
    const offGrid = new Date(new Date(slot).getTime() + 7 * 60_000).toISOString();
    const res = await patient2.post('/api/appointments').send({ doctorId: doctorAId, start: offGrid, reason: 'Headache' });
    expect(res.status).toBe(400);
  });

  it('keeps the hold when a card is declined', async () => {
    const res = await patient1.post(`/api/appointments/${appointmentId}/pay`).send({
      method: 'card', cardholder: 'Rafi Ahmed', cardNumber: '4000 0000 0000 0002', expiry: '12/30', cvc: '123',
    });
    expect(res.status).toBe(402);
    expect((await patient1.get(`/api/appointments/${appointmentId}`)).body.data.status).toBe('pending_payment');
  });

  it('only the booking patient can pay', async () => {
    const res = await patient2.post(`/api/appointments/${appointmentId}/pay`).send({ method: 'bkash', walletNumber: '01712345678', pin: '12345' });
    expect(res.status).toBe(404);
  });

  it('confirms on payment and adds the patient to the doctor’s list', async () => {
    const res = await patient1.post(`/api/appointments/${appointmentId}/pay`).send({ method: 'bkash', walletNumber: '01712345678', pin: '12345' }).expect(200);
    expect(res.body.data).toMatchObject({ status: 'confirmed', holdExpiresAt: null });
    expect(res.body.data.payment).toMatchObject({ status: 'paid', amount: 800, instrument: 'bKash •••• 5678' });
    expect(res.body.data.payment.transactionId).toMatch(/^TXN-/);

    const list = await doctorA.get(`/api/doctors/${doctorAId}/patients`).expect(200);
    expect(list.body.data.map((p: { name: string }) => p.name)).toContain('Rafi Ahmed');
    const again = await patient1.post(`/api/appointments/${appointmentId}/pay`).send({ method: 'nagad', walletNumber: '01912345678', pin: '1234' });
    expect(again.status).toBe(409);
  });

  it('scopes appointment lists by role', async () => {
    expect((await patient1.get('/api/appointments')).body.meta.total).toBe(1);
    expect((await patient2.get('/api/appointments')).body.meta.total).toBe(0);
    expect((await doctorA.get('/api/appointments')).body.meta.total).toBe(1);
    expect((await admin.get('/api/appointments')).body.meta.total).toBe(1);
  });

  it('releases the slot to everyone when the hold runs out', async () => {
    const next = await firstOpenSlot(doctorAId);
    const booked = await patient2.post('/api/appointments').send({ doctorId: doctorAId, start: next, reason: 'Back pain' }).expect(201);
    // Simulate the 5 minutes passing.
    await AppointmentModel.updateOne({ _id: booked.body.data.id }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });

    expect(await firstOpenSlot(doctorAId)).toBe(next); // free again
    const late = await patient2.post(`/api/appointments/${booked.body.data.id}/pay`).send({ method: 'nagad', walletNumber: '01912345678', pin: '1234' });
    expect(late.status).toBe(409);
    expect(late.body.error.details.reason).toBe('HOLD_EXPIRED');
    expect((await patient2.get(`/api/appointments/${booked.body.data.id}`)).body.data.status).toBe('expired');

    // Someone else can now take it.
    const fresh = request.agent(app);
    await fresh.post('/api/auth/register').send(registration('Nabila')).expect(201);
    await fresh.post('/api/appointments').send({ doctorId: doctorAId, start: next, reason: 'Back pain' }).expect(201);
  });

  it('refunds when a patient cancels a confirmed visit', async () => {
    const res = await patient1.post(`/api/appointments/${appointmentId}/cancel`).send({ reason: 'Feeling better' }).expect(200);
    expect(res.body.data).toMatchObject({ status: 'cancelled', cancelledBy: 'patient' });
    expect(res.body.data.payment.status).toBe('refunded');
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and detects reuse', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'sadia@patient.test', password: 'Secret1234' }).expect(200);
    const first = cookiesOf(login).dt_refresh!;

    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', `dt_refresh=${first}`).expect(200);
    const second = cookiesOf(rotated).dt_refresh!;
    expect(second).not.toBe(first);

    // Replaying the old token (outside the parallel-tab grace window) ends the whole family.
    await RefreshTokenModel.updateOne({ replacedBy: { $exists: true }, revokedAt: { $ne: null } }, { $set: { revokedAt: new Date(Date.now() - 60_000) } });
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', `dt_refresh=${first}`);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_REUSED');
    expect((await request(app).post('/api/auth/refresh').set('Cookie', `dt_refresh=${second}`)).status).toBe(401);
  });

  it('signs out everywhere after a password change', async () => {
    const other = await request(app).post('/api/auth/login').send({ email: 'sadia@patient.test', password: 'Secret1234' });
    const otherRefresh = cookiesOf(other).dt_refresh!;
    await patient2.post('/api/auth/change-password').send({ currentPassword: 'Secret1234', newPassword: 'NewSecret99' }).expect(200);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', `dt_refresh=${otherRefresh}`)).status).toBe(401);
    expect((await patient2.get('/api/auth/me')).status).toBe(200); // this device stays signed in
  });

  it('blocks state-changing requests from foreign origins', async () => {
    const res = await patient1.post('/api/appointments').set('Origin', 'https://evil.example').send({});
    expect(res.status).toBe(403);
  });
});

describe('profile pictures', () => {
  // 1×1 transparent PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );

  it('accepts a real image and serves it with long-lived caching', async () => {
    const res = await doctorA.put('/api/auth/me/avatar').set('Content-Type', 'image/png').send(png).expect(200);
    expect(res.body.data.avatarUrl).toMatch(/^\/api\/avatars\/[a-f0-9]{24}\?v=\d+$/);

    const image = await request(app).get(res.body.data.avatarUrl).expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toContain('immutable');

    // The doctor's public card now carries the picture.
    const card = await request(app).get(`/api/public/doctors/${doctorAId}`);
    expect(card.body.data.avatarUrl).toBe(res.body.data.avatarUrl);
  });

  it('rejects files whose bytes are not an image, whatever the header says', async () => {
    const res = await patient1.put('/api/auth/me/avatar').set('Content-Type', 'image/png').send(Buffer.from('<script>alert(1)</script>'));
    expect(res.status).toBe(400);
  });

  it('requires sign-in and can be removed', async () => {
    expect((await request(app).put('/api/auth/me/avatar').set('Content-Type', 'image/png').send(png)).status).toBe(401);
    await doctorA.delete('/api/auth/me/avatar').expect(200);
    expect((await doctorA.get('/api/auth/me')).body.data.avatarUrl).toBeNull();
  });
});
