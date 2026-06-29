export type RootStackParamList = {
  WalletConnect: undefined;
  TradeList: undefined;
  TradeDetail: { id: string } | { tradeId: string };
  DisputeDetail: { id: string };
  CreateTrade: undefined;
  EvidenceCapture: { tradeId: string };
};
