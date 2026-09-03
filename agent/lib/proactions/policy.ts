import type { AdminPolicy } from "./admin";
import {
  type Autonomy,
  autonomyRank,
  minAutonomy,
  type ProactionDefinition,
} from "./define";

export interface UserProactionPolicy {
  readonly autonomy: Autonomy | null;
  readonly enabled: boolean | null;
}

export interface EffectiveProactionPolicy {
  readonly adminDisabled: boolean;
  readonly autonomy: Autonomy;
  readonly autonomyCeiling: Autonomy;
  readonly enabled: boolean;
  readonly userAutonomy: Autonomy | null;
  readonly userEnabled: boolean | null;
}

export function effectiveProactionPolicy(
  definition: ProactionDefinition,
  admin: AdminPolicy,
  user: UserProactionPolicy | undefined
): EffectiveProactionPolicy {
  const override = admin.overrides[definition.id];
  const adminDisabled =
    admin.disabled.includes(definition.id) || override?.enabled === false;
  const autonomyCeiling = minAutonomy(
    definition.maxAutonomy,
    admin.maxAutonomy,
    override?.maxAutonomy ?? admin.maxAutonomy
  );
  const requested = user?.autonomy ?? definition.defaults.autonomy;
  const autonomy =
    autonomyRank(requested) > autonomyRank(autonomyCeiling)
      ? autonomyCeiling
      : requested;
  return {
    adminDisabled,
    autonomy,
    autonomyCeiling,
    enabled: !adminDisabled && (user?.enabled ?? definition.defaults.enabled),
    userAutonomy: user?.autonomy ?? null,
    userEnabled: user?.enabled ?? null,
  };
}
