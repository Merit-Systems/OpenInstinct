import type { ChatSummary, SaveChat } from "../../chat";
import type { BrowserMode } from "../../manager";
import type { ConnectionRecord, ModelStorage, VaultRecord } from "./records";

export interface AppStore {
  createConnection(
    record: ConnectionRecord,
    replaceProvider: boolean
  ): Promise<readonly string[]>;
  createVaultItem(record: VaultRecord): Promise<void>;
  deleteConnection(id: string): Promise<void>;
  deleteVaultItem(id: string): Promise<void>;
  initialize(): Promise<void>;
  listChats(): Promise<readonly ChatSummary[]>;
  listConnections(): Promise<readonly ConnectionRecord[]>;
  listVaultItems(): Promise<readonly VaultRecord[]>;
  readConnectionByProvider(
    provider: ConnectionRecord["provider"]
  ): Promise<ConnectionRecord | undefined>;
  readBrowserMode(): Promise<BrowserMode | undefined>;
  readModelStorage(): Promise<ModelStorage>;
  saveChat(chat: SaveChat): Promise<void>;
  selectGatewayModel(modelId: string): Promise<void>;
  selectBrowserMode(mode: BrowserMode): Promise<void>;
  selectLocalModel(): Promise<void>;
}
