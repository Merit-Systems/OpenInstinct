import type { AccessScope } from "@/lib/access-scope";

export interface TRPCContext {
  readonly origin: string;
  readonly scope: AccessScope;
}
