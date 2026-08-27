import { z } from "zod";
import { auth, ensureAuthDatabase } from "../../auth.js";

const verifiedPhoneUserSchema = z.object({
  id: z.string().min(1),
  phoneNumberVerified: z.literal(true),
});

export async function findVerifiedAuthUserIdByPhoneNumber(phoneNumber: string) {
  await ensureAuthDatabase();
  const context = await auth.$context;
  const user = await context.adapter.findOne({
    model: "user",
    where: [{ field: "phoneNumber", value: phoneNumber }],
  });
  const parsed = verifiedPhoneUserSchema.safeParse(user);
  return parsed.success ? parsed.data.id : undefined;
}
