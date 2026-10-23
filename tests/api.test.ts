import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { DoctorModel } from '../src/models/doctor.model.js';
import { PatientModel } from '../src/models/patient.model.js';
import { UserModel } from '../src/models/user.model.js';

let mongo: MongoMemoryServer;
const app = createApp();
const agent = request.agent(app); // keeps the auth cookie between requests

const doctorInput = {
  name: 'Dr. Ada Lovelace',
  specialization: 'Cardiology',
  hospital: 'Riverside General Hospital',
  phone: '+1 555 010 2000',
  email: 'ada@example.com',
};

const patientInput = {
  name: 'Grace Hopper',
  age: 54,
  gender: 'Female',
  phone: '+1 555 010 3000',
  condition: 'Hypertension',
  status: 'Active',
  admissionDate: '2026-01-15',
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDB(mongo.getUri());
  await Promise.all([UserModel.init(), DoctorModel.init(), PatientModel.init()]);
  await UserModel.create({ name: 'Admin', email: 'admin@test.dev', password: 'Password123!' });
});

afterAll(async () => {
  await disconnectDB();
  await mongo?.stop();
});

describe('auth', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/doctors');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects bad credentials with a generic message', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.dev', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('validates the login payload', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in and sets an httpOnly cookie', async () => {
    const res = await agent.post('/api/auth/login').send({ email: 'ADMIN@test.dev', password: 'Password123!' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/dt_token=.+HttpOnly/i);
    const me = await agent.get('/api/auth/me');
    expect(me.body.data.email).toBe('admin@test.dev');
  });

  it('accepts a Bearer token', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@test.dev', password: 'Password123!' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.data.token}`);
    expect(res.status).toBe(200);
  });
});

describe('doctors & patients', () => {
  let doctorId: string;
  let patientId: string;

  it('creates a doctor', async () => {
    const res = await agent.post('/api/doctors').send(doctorInput);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: doctorInput.name, patientCount: 0 });
    expect(res.body.data.id).toBeTypeOf('string');
    expect(res.body.data).not.toHaveProperty('nameLower');
    doctorId = res.body.data.id;
  });

  it('rejects duplicate doctor emails with 409', async () => {
    const res = await agent.post('/api/doctors').send({ ...doctorInput, name: 'Dr. Someone Else' });
    expect(res.status).toBe(409);
  });

  it('returns field-level validation errors', async () => {
    const res = await agent.post('/api/doctors').send({ ...doctorInput, email: 'bad', phone: 'x' });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'phone']));
  });

  it('adds a patient under a doctor and lists it', async () => {
    const res = await agent.post(`/api/doctors/${doctorId}/patients`).send(patientInput);
    expect(res.status).toBe(201);
    expect(res.body.data.doctor).toMatchObject({ id: doctorId, name: doctorInput.name });
    patientId = res.body.data.id;

    const list = await agent.get(`/api/doctors/${doctorId}/patients`);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].id).toBe(patientId);
  });

  it('searches, filters and paginates doctors', async () => {
    await agent.post('/api/doctors').send({ ...doctorInput, name: 'Dr. Alan Turing', email: 'alan@example.com', specialization: 'Neurology' });

    const search = await agent.get('/api/doctors').query({ search: 'dr. ad' });
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].patientCount).toBe(1);

    const filtered = await agent.get('/api/doctors').query({ specialization: 'Neurology' });
    expect(filtered.body.data.map((d: { name: string }) => d.name)).toEqual(['Dr. Alan Turing']);

    const paged = await agent.get('/api/doctors').query({ limit: 1, page: 2, sort: 'name' });
    expect(paged.body.meta).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2, hasPrevPage: true, hasNextPage: false });
    expect(paged.body.data[0].name).toBe('Dr. Alan Turing');
  });

  it('filters patients by condition and date range', async () => {
    const hit = await agent.get('/api/patients').query({ condition: 'Hypertension,Asthma', from: '2026-01-01', to: '2026-01-31' });
    expect(hit.body.meta.total).toBe(1);
    const miss = await agent.get('/api/patients').query({ condition: 'Asthma' });
    expect(miss.body.meta.total).toBe(0);
    const bad = await agent.get('/api/patients').query({ condition: 'Nope' });
    expect(bad.status).toBe(400);
  });

  it('edits a patient', async () => {
    const res = await agent.patch(`/api/patients/${patientId}`).send({ status: 'Recovered', age: 55 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'Recovered', age: 55 });

    // A partial update must not reset other fields to their defaults.
    const partial = await agent.patch(`/api/patients/${patientId}`).send({ age: 56 });
    expect(partial.body.data).toMatchObject({ status: 'Recovered', age: 56 });
  });

  it('blocks deleting a doctor with patients unless cascading', async () => {
    const res = await agent.delete(`/api/doctors/${doctorId}`);
    expect(res.status).toBe(409);
  });

  it('only deletes a patient through the doctor it belongs to', async () => {
    const other = await agent.get('/api/doctors').query({ search: 'dr. alan' });
    const wrong = await agent.delete(`/api/doctors/${other.body.data[0].id}/patients/${patientId}`);
    expect(wrong.status).toBe(404);
    const right = await agent.delete(`/api/doctors/${doctorId}/patients/${patientId}`);
    expect(right.status).toBe(200);
  });

  it('returns 400 for malformed ids and 404 for unknown ones', async () => {
    expect((await agent.get('/api/patients/not-an-id')).status).toBe(400);
    expect((await agent.get('/api/patients/64b7f0000000000000000000')).status).toBe(404);
  });
});

describe('stats', () => {
  it('returns dashboard aggregates', async () => {
    const doctor = await DoctorModel.findOne().lean();
    await PatientModel.create([
      { ...patientInput, doctor: doctor!._id, admissionDate: new Date() },
      { ...patientInput, name: 'Ken Thompson', status: 'Critical', doctor: doctor!._id, admissionDate: new Date() },
    ]);
    const res = await agent.get('/api/stats/overview');
    expect(res.status).toBe(200);
    const { totals, patientsOverTime, patientsPerDoctor, byStatus } = res.body.data;
    expect(totals).toMatchObject({ doctors: 2, patients: 2, patientsInRange: 2, criticalInRange: 1 });
    expect(patientsOverTime.length).toBeGreaterThanOrEqual(12);
    expect(patientsPerDoctor[0]).toMatchObject({ name: doctor!.name, count: 2, critical: 1 });
    expect(byStatus).toEqual(expect.arrayContaining([{ status: 'Critical', count: 1 }]));
  });
});
