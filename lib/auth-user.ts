export function isFullyAuthenticatedUser(
  user:
    | {
        phoneNumber?: string | null;
        phoneNumberVerified?: boolean | null;
        twoFactorEnabled?: boolean | null;
      }
    | null
    | undefined
) {
  return Boolean(
    user?.phoneNumber &&
    user.phoneNumberVerified === true &&
    user.twoFactorEnabled === true
  );
}
