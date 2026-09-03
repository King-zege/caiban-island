export type FeishuBotConnectionState = 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

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
  lastErrorCategory: string | null;
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
