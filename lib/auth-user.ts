export function isFullyAuthenticatedUser(
  user:
    | {
        phoneNumber?: string | null;
        phoneNumberVerified?: boolean | null;
      }
    | null
    | undefined
) {
  return Boolean(user?.phoneNumber && user.phoneNumberVerified === true);
}
