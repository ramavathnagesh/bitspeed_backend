import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Clear existing
  await prisma.contact.deleteMany();

  // Create Doc Brown's initial purchase
  const doc1 = await prisma.contact.create({
    data: {
      email: "doc.brown@hillvalley.edu",
      phoneNumber: "1234567890",
      linkPrecedence: "primary",
    }
  });
  console.log(`Created primary contact: ${doc1.email}`);

  // Doc makes another purchase with a new phone
  const doc2 = await prisma.contact.create({
    data: {
      email: "doc.brown@hillvalley.edu",
      phoneNumber: "0987654321",
      linkedId: doc1.id,
      linkPrecedence: "secondary",
    }
  });
  console.log(`Created secondary contact bridging ${doc2.email} and ${doc2.phoneNumber}`);

  // A standalone purchase that will later be merged
  const doc3 = await prisma.contact.create({
    data: {
      email: "emmett@timecube.com",
      phoneNumber: "5555555555",
      linkPrecedence: "primary",
    }
  });
  console.log(`Created standalone primary contact: ${doc3.email}`);

  console.log("\nSeed complete! You can test identical or merging identities via the /identify endpoint.");
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
