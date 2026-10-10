export type Position = Readonly<{ x: number; y: number }>;
export type Level = 0 | 1 | 2 | 3 | 4;

export interface Contribution {
  readonly date: string;
  readonly count: number;
  readonly level: Level;
}

export interface Tile extends Contribution, Position {}

export interface Arena {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly Tile[];
}

export type GameEvent =
  | { type: 'move'; time: number; duration: number; from: Position; to: Position }
  | { type: 'bomb'; time: number; id: number; position: Position; fuse: number }
  | { type: 'explode'; time: number; duration: number; id: number; position: Position; cells: Position[]; destroyed: Position[] }
  | { type: 'restore'; time: number; column: number; cells: Position[] };

export interface GameConfig {
  mode: 'clear' | 'preview';
  seed: number;
  maxBombs: number;
  explosionRange: number;
  stepDuration: number;
  fuse: number;
  safetyMargin: number;
  blastDuration: number;
  maxDuration: number;
}

export interface Replay {
  arena: Arena;
  config: GameConfig;
  start: Position;
  events: GameEvent[];
  duration: number;
  resultTime: number;
  restoreTime: number;
  stats: { bombs: number; destroyed: number; totalBoxes: number; remaining: number; contributions: number };
}
