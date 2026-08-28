import { and, eq } from "drizzle-orm";
import { user } from "../db/schema";
import { database } from "./database";

export async function findVerifiedAuthUserIdByPhoneNumber(phoneNumber: string) {
  const record = await database().query.user.findFirst({
    columns: { id: true },
    where: and(
      eq(user.phoneNumber, phoneNumber),
      eq(user.phoneNumberVerified, true)
    ),
  });
  return record?.id;
}
