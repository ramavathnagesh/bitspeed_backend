import request from 'supertest';
import app from '../src/index';
import prisma from '../src/utils/prisma';

describe('POST /identify', () => {
  beforeEach(async () => {
    // Clean up the database before each test
    await prisma.contact.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. should create primary if none exists (only email)', async () => {
    const res = await request(app)
      .post('/identify')
      .send({ email: 'x@gmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.contact.primaryContatctId).toBeDefined();
    expect(res.body.contact.emails).toEqual(['x@gmail.com']);
    expect(res.body.contact.phoneNumbers).toEqual([]);
    expect(res.body.contact.secondaryContactIds).toEqual([]);
  });

  it('2. should create primary if none exists (email and phone)', async () => {
    const res = await request(app)
      .post('/identify')
      .send({ email: 'doc@hillvalley.edu', phoneNumber: '123' });

    expect(res.status).toBe(200);
    expect(res.body.contact.emails).toEqual(['doc@hillvalley.edu']);
    expect(res.body.contact.phoneNumbers).toEqual(['123']);
    expect(res.body.contact.secondaryContactIds).toEqual([]);
  });

  it('3. should return exact duplicate info without modifying cluster (Existing state)', async () => {
    // Seed
    const contact = await prisma.contact.create({
      data: { email: 'lorraine@hillvalley.edu', phoneNumber: '123456', linkPrecedence: 'primary' }
    });

    const res = await request(app)
      .post('/identify')
      .send({ email: 'lorraine@hillvalley.edu', phoneNumber: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.contact.primaryContatctId).toBe(contact.id);
    expect(res.body.contact.emails).toEqual(['lorraine@hillvalley.edu']);
    expect(res.body.contact.phoneNumbers).toEqual(['123456']);
    expect(res.body.contact.secondaryContactIds).toEqual([]);

    // Verify DB count
    const count = await prisma.contact.count();
    expect(count).toBe(1); // No new row should be created
  });

  it('4. should create secondary contact if new info is added', async () => {
    const contact = await prisma.contact.create({
      data: { email: 'lorraine@hillvalley.edu', phoneNumber: '123456', linkPrecedence: 'primary' }
    });

    const res = await request(app)
      .post('/identify')
      .send({ email: 'mcfly@hillvalley.edu', phoneNumber: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.contact.primaryContatctId).toBe(contact.id);
    expect(res.body.contact.emails).toContain('lorraine@hillvalley.edu');
    expect(res.body.contact.emails).toContain('mcfly@hillvalley.edu');
    expect(res.body.contact.phoneNumbers).toEqual(['123456']);
    expect(res.body.contact.secondaryContactIds.length).toBe(1);

    const count = await prisma.contact.count();
    expect(count).toBe(2);
  });

  it('5. should merge multiple primary contacts and make older primary the root', async () => {
    // Older primary
    const oldPrimary = await prisma.contact.create({
      data: { email: 'george@hillvalley.edu', phoneNumber: '919191', linkPrecedence: 'primary', createdAt: new Date('2023-04-11T00:00:00Z') }
    });
    // Newer primary
    const newPrimary = await prisma.contact.create({
      data: { email: 'biffsucks@hillvalley.edu', phoneNumber: '717171', linkPrecedence: 'primary', createdAt: new Date('2023-04-21T00:00:00Z') }
    });

    // Merge request
    const res = await request(app)
      .post('/identify')
      .send({ email: 'george@hillvalley.edu', phoneNumber: '717171' });

    expect(res.status).toBe(200);
    expect(res.body.contact.primaryContatctId).toBe(oldPrimary.id);
    expect(res.body.contact.emails).toContain('george@hillvalley.edu');
    expect(res.body.contact.emails).toContain('biffsucks@hillvalley.edu');
    expect(res.body.contact.phoneNumbers).toContain('919191');
    expect(res.body.contact.phoneNumbers).toContain('717171');
    expect(res.body.contact.secondaryContactIds).toEqual([newPrimary.id]);

    const updatedNewPrimary = await prisma.contact.findUnique({ where: { id: newPrimary.id } });
    expect(updatedNewPrimary?.linkPrecedence).toBe('secondary');
    expect(updatedNewPrimary?.linkedId).toBe(oldPrimary.id);
  });

  it('6. 🔥 Test: Email Matches Cluster A, Phone Matches Cluster B', async () => {
    const clusterA = await prisma.contact.create({
      data: { email: 'a@gmail.com', phoneNumber: '111', linkPrecedence: 'primary', createdAt: new Date('2023-01-01T00:00:00Z') }
    });
    const clusterA2 = await prisma.contact.create({
      data: { email: 'a_sec@gmail.com', phoneNumber: '111', linkPrecedence: 'secondary', linkedId: clusterA.id, createdAt: new Date('2023-01-02T00:00:00Z') }
    });

    const clusterB = await prisma.contact.create({
      data: { email: 'b@gmail.com', phoneNumber: '222', linkPrecedence: 'primary', createdAt: new Date('2023-02-01T00:00:00Z') } // Newer
    });

    // Incoming payload bridges cluster A and cluster B
    // Email belongs to A. Phone belongs to B.
    const res = await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '222' });

    expect(res.status).toBe(200);
    // Cluster A is older => ROOT should be cluster A.
    expect(res.body.contact.primaryContatctId).toBe(clusterA.id);

    // B should be demoted to secondary pointing to A
    expect(res.body.contact.secondaryContactIds).toContain(clusterB.id);
    expect(res.body.contact.secondaryContactIds).toContain(clusterA2.id);

    // Number of contacts shouldn't increase as NO new information is provided
    const count = await prisma.contact.count();
    expect(count).toBe(3);
  });
  it('7. Validation: Missing both email and phoneNumber should return 400', async () => {
    const res = await request(app)
      .post('/identify')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('8. Validation: Null email and Null phoneNumber should return 400', async () => {
    const res = await request(app)
      .post('/identify')
      .send({ email: null, phoneNumber: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('9. Edge Case: Cascading Merge of 3 distinct clusters', async () => {
    // Cluster 1 (Oldest)
    const c1 = await prisma.contact.create({
      data: { email: '1@test.com', phoneNumber: '111', linkPrecedence: 'primary', createdAt: new Date('2023-01-01T00:00:00Z') }
    });
    // Cluster 2
    const c2 = await prisma.contact.create({
      data: { email: '2@test.com', phoneNumber: '222', linkPrecedence: 'primary', createdAt: new Date('2023-02-01T00:00:00Z') }
    });
    // Cluster 3
    const c3 = await prisma.contact.create({
      data: { email: '3@test.com', phoneNumber: '333', linkPrecedence: 'primary', createdAt: new Date('2023-03-01T00:00:00Z') }
    });

    // Merge 1 and 2
    await request(app).post('/identify').send({ email: '1@test.com', phoneNumber: '222' });
    
    // Merge 2 and 3 (This bridges the now unified 1+2 cluster with 3)
    const res = await request(app).post('/identify').send({ email: '2@test.com', phoneNumber: '333' });

    expect(res.status).toBe(200);
    
    // c1 is the oldest of all, so it should be the ultimate root primary
    expect(res.body.contact.primaryContatctId).toBe(c1.id);
    
    // All 3 emails and 3 phones should be present
    expect(res.body.contact.emails).toContain('1@test.com');
    expect(res.body.contact.emails).toContain('2@test.com');
    expect(res.body.contact.emails).toContain('3@test.com');
    
    expect(res.body.contact.phoneNumbers).toContain('111');
    expect(res.body.contact.phoneNumbers).toContain('222');
    expect(res.body.contact.phoneNumbers).toContain('333');

    // c2 and c3 should both be secondaries now
    expect(res.body.contact.secondaryContactIds).toContain(c2.id);
    expect(res.body.contact.secondaryContactIds).toContain(c3.id);
  });
});