import Kernel from "@onkernel/sdk";
import { env } from "@/env";

export const kernel = new Kernel({ apiKey: env.KERNEL_API_KEY });
