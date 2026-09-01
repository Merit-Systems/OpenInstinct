import Kernel from "@onkernel/sdk";
import { env } from "@/lib/env";

export const kernel = new Kernel({ apiKey: env.KERNEL_API_KEY });
