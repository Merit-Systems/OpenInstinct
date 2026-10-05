import { defineState } from "eve/context";
import type { z } from "zod";
import type { sendMessageOutputSchema } from "@shared/chat/message-delivery";

export const contactDelivery = defineState<{
  userId: string;
  message: z.infer<typeof sendMessageOutputSchema>;
  sent: boolean;
} | null>("openinstinct.contact-delivery", () => null);
