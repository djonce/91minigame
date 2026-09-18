export interface RomInspection {
  format: 'iNES' | 'archaic-iNES' | 'NES2';
  sizeBytes: number;
  prgBytes: number;
  chrBytes: number;
  mapperRaw: number;
  mapperCandidate: number;
  trainer: boolean;
  battery: boolean;
  warnings: string[];
}
export interface Game {
  id: string;
  title: string;
  system: 'NES';
  description: string;
  sha256: string;
  sizeBytes: number;
  inspection: RomInspection;
  romUrl: string;
  runtimeProfileId: string;
  available: boolean;
}
export interface RuntimeManifest {
  version: string;
  core: string;
  profileId: string;
  coreSha256: string;
  files: { path: string; size: number; sha256: string }[];
}
export type SaveSlot = 'quick' | 'manual-1' | 'manual-2' | 'manual-3';
export interface SaveRecord {
  key: string;
  gameId: string;
  title: string;
  romSha256: string;
  runtimeProfileId: string;
  slot: SaveSlot;
  updatedAt: number;
  state: Uint8Array;
  stateSha256: string;
  screenshot?: Blob;
}
