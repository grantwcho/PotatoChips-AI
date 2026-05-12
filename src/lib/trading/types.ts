export type AlpacaOrderSide = "buy" | "sell";
export type AlpacaPositionIntent =
  | "buy_to_open"
  | "buy_to_close"
  | "sell_to_open"
  | "sell_to_close";
export type AlpacaOptionType = "call" | "put";

export type AlpacaOptionOrderLegInput = {
  symbol: string;
  ratioQty: number;
  side: AlpacaOrderSide;
  positionIntent: AlpacaPositionIntent;
};

export type AlpacaSubmitOrderInput = {
  kind?: "equity" | "option" | "option_mleg";
  symbol?: string;
  side?: AlpacaOrderSide;
  qty?: number;
  notional?: number;
  type?: "market" | "limit";
  timeInForce?: "day" | "gtc" | "ioc" | "fok" | "opg" | "cls";
  limitPrice?: number;
  extendedHours?: boolean;
  clientOrderId?: string;
  positionIntent?: AlpacaPositionIntent;
  orderClass?: "simple" | "mleg";
  legs?: AlpacaOptionOrderLegInput[];
};

export type AlpacaStockSnapshot = {
  symbol: string;
  askPrice: number | null;
  bidPrice: number | null;
  tradePrice: number | null;
  previousClose: number | null;
  requestId: string | null;
  raw: Record<string, unknown>;
};

export type AlpacaStockBar = {
  timestamp: string;
  close: number | null;
  raw: Record<string, unknown>;
};

export type AlpacaAssetSnapshot = {
  symbol: string;
  status: string | null;
  assetClass: string | null;
  tradable: boolean | null;
  fractionable: boolean | null;
  shortable: boolean | null;
  easyToBorrow: boolean | null;
  marginable: boolean | null;
  raw: Record<string, unknown>;
};

export type AlpacaOptionContractSnapshot = {
  symbol: string;
  underlyingSymbol: string;
  expirationDate: string | null;
  optionType: AlpacaOptionType | null;
  strikePrice: number | null;
  askPrice: number | null;
  bidPrice: number | null;
  tradePrice: number | null;
  requestId: string | null;
  raw: Record<string, unknown>;
};

export type AlpacaAccountSnapshot = {
  accountId: string;
  status: string | null;
  equity: number | null;
  cash: number | null;
  buyingPower: number | null;
  portfolioValue: number | null;
  longMarketValue: number | null;
  shortMarketValue: number | null;
  multiplier: string | null;
  daytradeCount: number | null;
  patternDayTrader: boolean | null;
  requestId: string | null;
  raw: Record<string, unknown>;
};

export type AlpacaPortfolioHistoryPoint = {
  timestamp: string;
  equity: number | null;
  profitLoss: number | null;
  profitLossPct: number | null;
};

export type AlpacaPortfolioHistory = {
  points: AlpacaPortfolioHistoryPoint[];
  baseValue: number | null;
  baseValueAsOf: string | null;
  timeframe: string | null;
  requestId: string | null;
  raw: Record<string, unknown>;
};

export type AlpacaPositionSnapshot = {
  symbol: string;
  side: string | null;
  qty: number | null;
  avgEntryPrice: number | null;
  marketValue: number | null;
  costBasis: number | null;
  unrealizedPl: number | null;
  currentPrice: number | null;
  exchange: string | null;
  assetClass: string | null;
  raw: Record<string, unknown>;
};

export type AlpacaOrderSnapshot = {
  brokerOrderId: string;
  clientOrderId: string | null;
  symbol: string;
  side: string;
  orderType: string;
  orderClass: string | null;
  timeInForce: string;
  qty: number | null;
  notional: number | null;
  filledQty: number | null;
  filledAvgPrice: number | null;
  status: string;
  assetClass: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
  requestId: string | null;
  raw: Record<string, unknown>;
};

export type BrokerDashboardAccount = {
  accountId: string;
  status: string | null;
  equity: number | null;
  cash: number | null;
  buyingPower: number | null;
  portfolioValue: number | null;
  lastSyncedAt: string;
};

export type BrokerDashboardPosition = {
  symbol: string;
  side: string | null;
  qty: number | null;
  marketValue: number | null;
  unrealizedPl: number | null;
  currentPrice: number | null;
};

export type BrokerPositionOwner = {
  agentId: string;
  attributedQty: number | null;
  attributedMarketValue: number | null;
  attributedUnrealizedPl: number | null;
  netSubmittedNotional: number | null;
  orderCount: number;
  lastOrderAt: string | null;
};

export type BrokerAttributedPosition = BrokerDashboardPosition & {
  owners: BrokerPositionOwner[];
  unattributedQty: number | null;
  unattributedMarketValue: number | null;
  unattributedUnrealizedPl: number | null;
};

export type BrokerAgentExposure = {
  agentId: string;
  positionCount: number;
  attributedMarketValue: number | null;
  attributedUnrealizedPl: number | null;
};

export type BrokerDashboardOrder = {
  brokerOrderId: string;
  clientOrderId: string | null;
  agentId: string | null;
  symbol: string;
  side: string;
  status: string;
  qty: number | null;
  notional: number | null;
  submittedAt: string | null;
  updatedAt: string | null;
};

export type BrokerDashboardSnapshot = {
  configured: boolean;
  connected: boolean;
  provider: "ALPACA_PAPER";
  account: BrokerDashboardAccount | null;
  openPositions: BrokerDashboardPosition[];
  attributedPositions: BrokerAttributedPosition[];
  agentExposure: BrokerAgentExposure[];
  recentOrders: BrokerDashboardOrder[];
};
