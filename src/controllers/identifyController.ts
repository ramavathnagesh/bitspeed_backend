import { Request, Response } from 'express';
import { z } from 'zod';
import { reconcileIdentity } from '../services/identityService';

const IdentifySchema = z.object({
  email: z.string().trim().optional().nullable(),
  phoneNumber: z.union([z.string(), z.number()]).optional().nullable(),
}).refine(data => {
  // If email acts as non-empty, rigorously validate format
  if (data.email && data.email.trim() !== '') {
    if (!z.string().email().safeParse(data.email).success) return false;
  }
  return true;
}, { message: "Invalid email format" })
.refine(data => {
  const hasEmail = data.email && data.email.trim() !== '';
  const hasPhone = data.phoneNumber && data.phoneNumber.toString().trim() !== '';
  return hasEmail || hasPhone;
}, {
  message: "Either email or phoneNumber must be provided",
});

export const identifyController = async (req: Request, res: Response) => {
  try {
    const parsedParams = IdentifySchema.safeParse(req.body);

    if (!parsedParams.success) {
      return res.status(400).json({ error: parsedParams.error.errors[0].message });
    }

    const { email, phoneNumber } = parsedParams.data;

    // Normalize inputs
    const cleanEmail = email ? email.trim().toLowerCase() : undefined;
    const cleanPhone = phoneNumber ? phoneNumber.toString().trim() : undefined;

    // Reconcile
    const result = await reconcileIdentity(cleanEmail, cleanPhone);

    return res.status(200).json(result);
  } catch (error) {
    console.error("Error evaluating identity logic:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
