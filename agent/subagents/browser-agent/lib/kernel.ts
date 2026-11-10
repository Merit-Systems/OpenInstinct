import Kernel from "@onkernel/sdk";
import { env } from "@shared/environment";

// Notte uses CDP directly and does not require a Kernel credential.
export const kernel = new Kernel({ apiKey: env.KERNEL_API_KEY ?? "" });
