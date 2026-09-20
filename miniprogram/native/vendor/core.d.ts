export { NES, Controller } from 'jsnes';
export function sha256(bytes: Uint8Array): Uint8Array;
export type Input = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'start' | 'select';
export function directionAt(x: number, y: number, width: number, height: number, previous?: readonly Input[]): Input[];
export class InputSources {
  constructor(send: (button: Input, down: boolean) => void);
  set(source: string, buttons: readonly Input[]): void;
  release(): void;
}
