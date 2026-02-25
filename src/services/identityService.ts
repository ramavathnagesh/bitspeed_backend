import prisma from '../utils/prisma';
import { Contact } from '@prisma/client';

export const reconcileIdentity = async (email?: string | null, phoneNumber?: string | null) => {
  return await prisma.$transaction(async (tx) => {
    // 1. Find all initial contacts matching the email or phoneNumber
    const initialMatches = await tx.contact.findMany({
      where: {
        OR: [
          ...(email ? [{ email }] : []),
          ...(phoneNumber ? [{ phoneNumber }] : []),
        ],
      },
    });

    // Condition 1: No matches at all -> Create a new primary contact
    if (initialMatches.length === 0) {
      const newContact = await tx.contact.create({
        data: {
          email: email || null,
          phoneNumber: phoneNumber || null,
          linkPrecedence: 'primary',
        },
      });
      return formatResponse([newContact], newContact.id);
    }

    // 2. Resolve root Primary IDs
    // We will find the root primary for every matched contact
    const rootPrimaryIds = new Set<number>();
    
    for (const match of initialMatches) {
      let current = match;
      // Trace back until we find a primary
      while (current.linkPrecedence === 'secondary' && current.linkedId) {
        const parent = await tx.contact.findUnique({ where: { id: current.linkedId } });
        if (!parent) break; // Defensive, shouldn't happen with FK constraints if we had them
        current = parent;
      }
      rootPrimaryIds.add(current.id);
    }

    // Helper inside transaction to iteratively fetch full deep cluster
    const fetchClusterIteratively = async (seedIds: number[]) => {
      const ids = new Set<number>(seedIds);
      let size = 0;
      let result: Contact[] = [];
      while (ids.size > size) {
        size = ids.size;
        result = await tx.contact.findMany({
          where: {
            OR: [
              { id: { in: Array.from(ids) } },
              { linkedId: { in: Array.from(ids) } },
            ],
          },
        });
        for (const c of result) {
          ids.add(c.id);
          if (c.linkedId) ids.add(c.linkedId);
        }
      }
      return result;
    };

    // 3. Fetch the full cluster
    // Any contact that is ONE OF the root primaries, or points to ANY of the root primaries
    let cluster = await fetchClusterIteratively(Array.from(rootPrimaryIds));

    // 4. Multi-Primary Merge Handling
    // If there are multiple primaries in this cluster, we need to consolidate them
    const clusterPrimaries = cluster.filter((c) => c.linkPrecedence === 'primary');
    
    let rootPrimary = clusterPrimaries[0];

    if (clusterPrimaries.length > 1) {
      // Sort by createdAt ASC (and tiebreaker id ASC)
      clusterPrimaries.sort((a, b) => {
        const dateDiff = a.createdAt.getTime() - b.createdAt.getTime();
        return dateDiff === 0 ? a.id - b.id : dateDiff;
      });

      rootPrimary = clusterPrimaries[0];
      const otherPrimaries = clusterPrimaries.slice(1);
      const otherPrimaryIds = otherPrimaries.map((p) => p.id);

      // Update the other primaries to be secondary and link to the oldest primary
      await tx.contact.updateMany({
        where: {
          id: { in: otherPrimaryIds },
        },
        data: {
          linkPrecedence: 'secondary',
          linkedId: rootPrimary.id,
        },
      });

      // Also update any secondaries that were pointing to the now-demoted primaries
      // to point directly to the new rootPrimary
      await tx.contact.updateMany({
        where: {
          linkedId: { in: otherPrimaryIds },
        },
        data: {
          linkedId: rootPrimary.id,
        },
      });

      // Refetch cluster since we mutated the relationships
      cluster = await fetchClusterIteratively([rootPrimary.id]);
    }

    // Ensure we only have one root primary ID going forward
    rootPrimaryIds.clear();
    rootPrimaryIds.add(rootPrimary.id);

    // 5. New Information Check -> Create new secondary if needed
    // Is the provided email or phone completely new to this cluster?
    const clusterEmails = new Set(cluster.map((c) => c.email).filter(Boolean));
    const clusterPhones = new Set(cluster.map((c) => c.phoneNumber).filter(Boolean));

    let emailIsNew = email && !clusterEmails.has(email);
    let phoneIsNew = phoneNumber && !clusterPhones.has(phoneNumber);

    // Exact Duplicate Info Check - if everything provided is already in the cluster, do nothing
    // We only create a secondary if we have NEW information that is NOT present in the cluster
    if (emailIsNew || phoneIsNew) {
      // Create new secondary contact pointing to root primary
      const newSecondary = await tx.contact.create({
        data: {
          email: email || null,
          phoneNumber: phoneNumber || null,
          linkedId: rootPrimary.id,
          linkPrecedence: 'secondary',
        },
      });
      // Add to cluster for final formatting
      cluster.push(newSecondary);
    }

    // 6. Formatting Payload
    return formatResponse(cluster, rootPrimary.id);
  });
};

// Helper: Formats the raw cluster DB rows into the required JSON payload
function formatResponse(cluster: Contact[], primaryContactId: number) {
  // We Ensure Primary Contact's email/phone is FIRST in the arrays
  const primaryContact = cluster.find((c) => c.id === primaryContactId);
  const secondaries = cluster.filter((c) => c.id !== primaryContactId);

  const emails = new Set<string>();
  const phoneNumbers = new Set<string>();
  const secondaryContactIds: number[] = [];

  // 1. Add Primary Contact info first
  if (primaryContact?.email) emails.add(primaryContact.email);
  if (primaryContact?.phoneNumber) phoneNumbers.add(primaryContact.phoneNumber);

  // 2. Add Secondary Contacts info, collect their IDs
  for (const sec of secondaries) {
    if (sec.email) emails.add(sec.email);
    if (sec.phoneNumber) phoneNumbers.add(sec.phoneNumber);
    secondaryContactIds.push(sec.id);
  }

  return {
    contact: {
      primaryContatctId: primaryContactId, // As per requirements "primaryContatctId" literal
      emails: Array.from(emails),
      phoneNumbers: Array.from(phoneNumbers),
      secondaryContactIds,
    },
  };
}