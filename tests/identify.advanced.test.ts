import request from 'supertest';
import app from '../src/index';
import prisma from '../src/utils/prisma';

describe('Advanced POST /identify Edge Cases', () => {
  beforeEach(async () => {
    await prisma.contact.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // --- 1. Input Normalization & Validation (10-18) ---
  it('10. Should accept number-type phoneNumber and treat as string', async () => {
    const res = await request(app).post('/identify').send({ email: 'num@test.com', phoneNumber: 123456 });
    expect(res.status).toBe(200);
    expect(res.body.contact.phoneNumbers).toEqual(['123456']);
  });

  it('11. Should trim whitespace from email', async () => {
    const res = await request(app).post('/identify').send({ email: ' padded@test.com  ' });
    expect(res.status).toBe(200);
    expect(res.body.contact.emails).toEqual(['padded@test.com']);
  });

  it('12. Should trim whitespace from phoneNumber', async () => {
    const res = await request(app).post('/identify').send({ phoneNumber: '  9999  ' });
    expect(res.status).toBe(200);
    expect(res.body.contact.phoneNumbers).toEqual(['9999']);
  });

  it('13. Should lowercase mixed case emails', async () => {
    const res = await request(app).post('/identify').send({ email: 'UpPerCaSe@TeSt.CoM' });
    expect(res.status).toBe(200);
    expect(res.body.contact.emails).toEqual(['uppercase@test.com']);
  });

  it('14. Should reject invalid email format', async () => {
    const res = await request(app).post('/identify').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('15. Should treat empty string email as undefined/missing', async () => {
    await request(app).post('/identify').send({ phoneNumber: '777' });
    const res = await request(app).post('/identify').send({ email: '', phoneNumber: '777' });
    expect(res.status).toBe(200);
    // Since email is empty, it shouldn't add a new secondary with empty email, it should just return the primary
    expect(res.body.contact.emails.length).toBe(0);
    expect(res.body.contact.secondaryContactIds.length).toBe(0);
  });

  it('16. Should treat empty string phone as undefined/missing', async () => {
    await request(app).post('/identify').send({ email: 'empty@test.com' });
    const res = await request(app).post('/identify').send({ email: 'empty@test.com', phoneNumber: '' });
    expect(res.status).toBe(200);
    expect(res.body.contact.phoneNumbers.length).toBe(0);
    expect(res.body.contact.secondaryContactIds.length).toBe(0);
  });

  it('17. Should handle extremely long valid strings safely (e.g. 250 chars)', async () => {
    const longEmail = 'a'.repeat(240) + '@test.com';
    const res = await request(app).post('/identify').send({ email: longEmail });
    expect(res.status).toBe(200);
    expect(res.body.contact.emails).toEqual([longEmail]);
  });
  
  it('18. Should safely accept plus-aliased emails', async () => {
    const res = await request(app).post('/identify').send({ email: 'user+alias@gmail.com' });
    expect(res.status).toBe(200);
    expect(res.body.contact.emails).toEqual(['user+alias@gmail.com']);
  });


  // --- 2. Advanced Graph Traversal & Tiebreakers (19-25) ---
  it('19. Tiebreaker: 2 Primaries with IDENTICAL createdAt. Smaller ID wins.', async () => {
    const exactTime = new Date('2023-05-05T00:00:00Z');
    const p1 = await prisma.contact.create({ data: { email: 'tie1@test.com', linkPrecedence: 'primary', createdAt: exactTime } });
    const p2 = await prisma.contact.create({ data: { email: 'tie2@test.com', linkPrecedence: 'primary', createdAt: exactTime } });
    
    // Merge them
    const res = await request(app).post('/identify').send({ email: 'tie1@test.com', phoneNumber: '0000' });
    await request(app).post('/identify').send({ email: 'tie2@test.com', phoneNumber: '0000' });

    // Assuming IDs are auto-incremented, p1 < p2
    const rootId = Math.min(p1.id, p2.id);
    const secId = Math.max(p1.id, p2.id);

    const check = await request(app).post('/identify').send({ email: 'tie1@test.com' });
    expect(check.body.contact.primaryContatctId).toBe(rootId);
    expect(check.body.contact.secondaryContactIds).toContain(secId);
  });

  it('20. Deep Chain A -> B -> C -> D -> E resolves instantly to A', async () => {
    // We manually simulate a very deep chain that might happen sequentially
    const a = await prisma.contact.create({ data: { email: 'a@test.com', linkPrecedence: 'primary', createdAt: new Date('2023-01-01T00:00:00Z') } });
    const b = await prisma.contact.create({ data: { email: 'b@test.com', linkPrecedence: 'secondary', linkedId: a.id } });
    const c = await prisma.contact.create({ data: { email: 'c@test.com', linkPrecedence: 'secondary', linkedId: b.id } });
    const d = await prisma.contact.create({ data: { email: 'd@test.com', linkPrecedence: 'secondary', linkedId: c.id } });
    const e = await prisma.contact.create({ data: { email: 'e@test.com', linkPrecedence: 'secondary', linkedId: d.id } });

    // Hit E
    const res = await request(app).post('/identify').send({ email: 'E@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.contact.primaryContatctId).toBe(a.id);
    expect(res.body.contact.secondaryContactIds.length).toBe(4);
    expect(res.body.contact.emails).toContain('a@test.com');
    expect(res.body.contact.emails).toContain('e@test.com');
  });

  it('21. Two deep chains (A->B->C) and (X->Y->Z) bridged together to form A->(B,C,X,Y,Z)', async () => {
    const a = await prisma.contact.create({ data: { email: 'a@test.com', phoneNumber: '111', linkPrecedence: 'primary', createdAt: new Date('2022-01-01T00:00:00Z') } });
    const b = await prisma.contact.create({ data: { email: 'b@test.com', phoneNumber: '111', linkPrecedence: 'secondary', linkedId: a.id } });
    
    const x = await prisma.contact.create({ data: { email: 'x@test.com', phoneNumber: '999', linkPrecedence: 'primary', createdAt: new Date('2023-01-01T00:00:00Z') } });
    const y = await prisma.contact.create({ data: { email: 'y@test.com', phoneNumber: '999', linkPrecedence: 'secondary', linkedId: x.id } });

    // Bridge B and Y
    const res = await request(app).post('/identify').send({ email: 'b@test.com', phoneNumber: '999' });
    
    expect(res.status).toBe(200);
    expect(res.body.contact.primaryContatctId).toBe(a.id);
    expect(res.body.contact.secondaryContactIds).toContain(x.id); // X is demoted
    expect(res.body.contact.secondaryContactIds).toContain(b.id);
    expect(res.body.contact.secondaryContactIds).toContain(y.id);
    
    // Verify X was updated perfectly
    const verifyX = await prisma.contact.findUnique({ where: { id: x.id } });
    expect(verifyX?.linkedId).toBe(a.id);
    expect(verifyX?.linkPrecedence).toBe('secondary');
  });


  // --- 3. Deduplication & Idempotency checks (22-26) ---
  it('22. Exact Duplicate of Secondary payload causes NO database writes', async () => {
    await request(app).post('/identify').send({ email: 'root@test.com', phoneNumber: '123' });
    // create secondary
    await request(app).post('/identify').send({ email: 'sec@test.com', phoneNumber: '123' });
    
    const countBefore = await prisma.contact.count();
    // Hit exact secondary again
    const res = await request(app).post('/identify').send({ email: 'sec@test.com', phoneNumber: '123' });
    const countAfter = await prisma.contact.count();
    
    expect(countBefore).toBe(countAfter);
    expect(res.status).toBe(200);
    expect(res.body.contact.emails.length).toBe(2);
  });

  it('23. Request identifying an existing email perfectly but NO phone provided (Idempotent)', async () => {
    await request(app).post('/identify').send({ email: 'root@test.com', phoneNumber: '123' });
    const countBefore = await prisma.contact.count();
    const res = await request(app).post('/identify').send({ email: 'root@test.com' });
    const countAfter = await prisma.contact.count();

    expect(countBefore).toBe(countAfter);
    expect(res.body.contact.phoneNumbers).toContain('123');
  });

  it('24. Request identifying an existing phone perfectly but NO email provided (Idempotent)', async () => {
    await request(app).post('/identify').send({ email: 'root@test.com', phoneNumber: '123' });
    const countBefore = await prisma.contact.count();
    
    // phone only
    const res = await request(app).post('/identify').send({ phoneNumber: '123' });
    const countAfter = await prisma.contact.count();

    expect(countBefore).toBe(countAfter);
    expect(res.body.contact.emails).toContain('root@test.com');
  });

  it('25. Swapped existing data does not duplicate (Phone A, Email B vs Email A, Phone B)', async () => {
    // If the cluster has Email A, Phone A, Email B, Phone B.
    await request(app).post('/identify').send({ email: 'a@test.com', phoneNumber: 'A-phone' });
    await request(app).post('/identify').send({ email: 'b@test.com', phoneNumber: 'A-phone' });
    await request(app).post('/identify').send({ email: 'a@test.com', phoneNumber: 'B-phone' });

    const countBefore = await prisma.contact.count();
    // Now request with Email B, Phone B (both already exist in cluster but we never sent them together)
    await request(app).post('/identify').send({ email: 'b@test.com', phoneNumber: 'B-phone' });
    const countAfter = await prisma.contact.count();

    // Since both email and phone are known to the cluster, NO NEW ROW
    expect(countBefore).toBe(countAfter);
  });


  // --- 4. Massive Scale Network Merges (26-30) ---
  it('26-30. Iterative Star-graph creation (1 Primary, 10 Secondaries)', async () => {
    // Simulating 10 successive brand new phones for the same email
    for (let i = 0; i < 10; i++) {
        await request(app).post('/identify').send({ email: 'star@test.com', phoneNumber: `phone-${i}` });
    }

    const res = await request(app).post('/identify').send({ email: 'star@test.com' });
    expect(res.body.contact.emails).toEqual(['star@test.com']);
    expect(res.body.contact.phoneNumbers.length).toBe(10);
    expect(res.body.contact.secondaryContactIds.length).toBe(9); // 1 primary, 9 secondaries
  });

  // --- 5. Massive Multi-Cluster Bridge (31-50) ---
  it('31-50. 10 independent primaries merged sequentially into a monolithic 20-node cluster', async () => {
    // Create 10 distinct primaries (Email X, Phone X)
    for (let i = 0; i < 10; i++) {
      // Create primary artificially via DB to ensure exact timestamps
      await prisma.contact.create({
        data: {
          email: `primary${i}@test.com`,
          phoneNumber: `p${i}`,
          linkPrecedence: 'primary',
          createdAt: new Date(`2021-01-${(i + 1).toString().padStart(2, '0')}T00:00:00Z`)
        }
      });
      // Add a secondary manually to each via API
      await request(app).post('/identify').send({ email: `primary${i}@test.com`, phoneNumber: `s${i}` });
    }

    // Now we have 10 isolated clusters of 2 nodes each (20 nodes total).
    // Let's bridge them sequentially!
    for (let i = 0; i < 9; i++) {
      // Bridge primary[i] email with primary[i+1] phone
      await request(app).post('/identify').send({ email: `primary${i}@test.com`, phoneNumber: `p${i+1}` });
    }

    // By now, all 20 nodes should resolve to Primary 0 (the oldest).
    // Verify from any random leaf node.
    const res = await request(app).post('/identify').send({ email: `primary9@test.com` });
    
    // Primary 0 should be the root!
    const rootPrimary = await prisma.contact.findFirst({ where: { email: 'primary0@test.com' } });
    expect(res.body.contact.primaryContatctId).toBe(rootPrimary?.id);

    // Should have 10 primary emails + 10 primary phones + 10 secondary phones
    expect(res.body.contact.emails.length).toBe(10); 
    // Wait, emails: primary0..9 (10 emails)
    // Phones: p0..p9 (10) + s0..s9 (10) = 20 phones
    // Total IDs = 20 nodes. Secondary list = 19 nodes.
    expect(res.body.contact.secondaryContactIds.length).toBe(19);

    // Verify they are uniquely captured
    for (let i = 0; i < 10; i++) {
      expect(res.body.contact.emails).toContain(`primary${i}@test.com`);
      expect(res.body.contact.phoneNumbers).toContain(`p${i}`);
      expect(res.body.contact.phoneNumbers).toContain(`s${i}`);
    }
  });
});
