export type FeishuBotConnectionState = 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export type FeishuBotErrorCategory =
  | 'credentials'
  | 'decryption'
  | 'long_connection'
  | 'permission'
  | 'bot_disabled'
  | 'rate_limit'
  | 'network'
  | 'provider';

export interface FeishuPairedUser {
  openId: string;
  displayName: string;
  pairedAt: string;
  lastSeenAt: string;
}

export interface FeishuBotStatus {
  appId: string;
  configured: boolean;
  enabled: boolean;
  connectionState: FeishuBotConnectionState;
  botName: string | null;
  botOpenId: string | null;
  lastErrorCategory: FeishuBotErrorCategory | null;
  lastErrorMessage: string | null;
  retryAttempt: number;
  diagnosticsEnabled: boolean;
  pairedUsers: FeishuPairedUser[];
}

export interface FeishuBotConfigInput {
  appId: string;
  appSecret: string;
  enabled: boolean;
}

export interface FeishuPairingCode {
  code: string;
  expiresAt: string;
}

export interface FeishuDiagnosticExportResult {
  path: string;
  entryCount: number;
}
