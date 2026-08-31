export function blobAuthentication(
  input: {
    readonly readWriteToken?: string;
    readonly storeId?: string;
  },
  unavailableMessage: string
) {
  if (input.storeId) return { storeId: input.storeId };
  if (input.readWriteToken) return { token: input.readWriteToken };
  throw new Error(unavailableMessage);
}
