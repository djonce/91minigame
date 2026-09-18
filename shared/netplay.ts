export const NETPLAY_VERSION = 1;
export const NETPLAY_PROFILE = 'ejs423-fceumm-f1054b094e7149fd-lockstep-v1';
export const netplayProfile = (controller: 'nes-2pad' | 'nes-four-score') => `${NETPLAY_PROFILE}/${controller}`;
export const INPUT_KEYS = ['a', 'b', 'select', 'start', 'up', 'down', 'left', 'right'] as const;
export type InputFrame = [number, number, number, number];
export const HASH_INTERVAL = 120;
export const FRAME_WINDOW = 8;
export const INPUT_DELAY = 3;
export const MAX_SNAPSHOT = 512 * 1024;
export const MAX_PARTICIPANTS = 3;
export interface NetplayGame { gameId: string; sha256: string; runtimeProfileId: string; profile: string; controller: 'nes-2pad' | 'nes-four-score'; players: number; fps: number }
export interface MemberView { id: string; seat: number | null; connected: boolean; ready: boolean }
export interface RoomView { code: string; epoch: number; phase: 'lobby' | 'loading' | 'playing' | 'paused' | 'ended'; game: NetplayGame; members: MemberView[]; owner: string; frame: number; reason?: string }
export type ClientMessage =
  | { type: 'create'; gameId: string; version: number }
  | { type: 'join'; code: string; spectator: boolean; version: number }
  | { type: 'reconnect'; code: string; token: string; version: number; frame: number; epoch: number }
  | { type: 'ready'; profile: string; sha256: string }
  | { type: 'start' }
  | { type: 'snapshot'; epoch: number; state: string; hash: string }
  | { type: 'loaded'; epoch: number; hash: string }
  | { type: 'input'; epoch: number; frame: number; buttons: number }
  | { type: 'hash'; epoch: number; frame: number; hash: string }
  | { type: 'pause'; reason: 'menu' | 'background' | 'error' }
  | { type: 'resume' }
  | { type: 'leave' };
export type ServerMessage =
  | { type: 'welcome'; memberId: string; token: string; room: RoomView }
  | { type: 'room'; room: RoomView }
  | { type: 'need-snapshot'; epoch: number; frame: number }
  | { type: 'load'; epoch: number; frame: number; state: string; hash: string }
  | { type: 'go'; epoch: number; frame: number; seats: number[] }
  | { type: 'frame'; epoch: number; frame: number; inputs: InputFrame }
  | { type: 'error'; message: string };
export const isInteger = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
export const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
