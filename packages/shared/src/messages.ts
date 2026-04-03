// Message type constants

export const ServerMsgType = {
    Welcome: 'welcome',
    PlayerMoved: 'playerMoved',
    SectorDisplay: 'sectorDisplay',
    PlayerLeft: 'playerLeft',
    PlayersOnline: 'playersOnline',
    NoShip: 'noShip',
    NonAdjacentMoveRequested: 'nonAdjacentMoveRequested',
    RateLimited: 'rateLimited',
    SectorWarps: 'sectorWarps',
    PathResult: 'pathResult',
    PortInfo: 'portInfo',
    ShipInfo: 'shipInfo',
    CargoInfo: 'cargoInfo',
    PortTransactionResult: 'portTransactionResult',
    BuyResult: 'buyResult',
    ShipExchangeResult: 'shipExchangeResult',
    AttackResult: 'attackResult',
    DockResult: 'dockResult',
    Error: 'error',
} as const;
type ServerMsgType = typeof ServerMsgType;

export const ClientMsgType = {
    Move: 'move',
    SectorDisplay: 'sectorDisplay',
    Who: 'who',
    SectorWarps: 'sector',
    Path: 'path',
    PortInfo: 'portInfo',
    ShipInfo: 'ship',
    CargoInfo: 'cargoInfo',
    PortTransaction: 'portTransaction',
    BuyFighters: 'buyFighters',
    BuyShields: 'buyShields',
    BuyHolds: 'buyHolds',
    ShipExchange: 'shipExchange',
    Attack: 'attack',
    Dock: 'dock',
    Undock: 'undock',
} as const;
type ClientMsgType = typeof ClientMsgType;
