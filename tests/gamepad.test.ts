import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directionAt, InputSources } from '../src/gamepad';
test('continuous directions include diagonals, center dead zone and out-of-bounds dragging', () => {
  assert.deepEqual(directionAt(75,75,150,150), []);
  assert.deepEqual(directionAt(80,75,150,150), []);
  assert.deepEqual(directionAt(140,75,150,150), ['right']);
  assert.deepEqual(directionAt(140,10,150,150), ['up','right']);
  assert.deepEqual(directionAt(10,140,150,150), ['down','left']);
  assert.deepEqual(directionAt(-20,75,150,150), ['left']);
});
test('input sources preserve held keys across partial releases and release all after cancellation', () => {
  const edges: [string,boolean][] = [];
  const state = new InputSources((button,down) => edges.push([button,down]));
  state.set('finger1',['right']); state.set('keyboard',['a']); state.set('finger2',['a']);
  state.set('finger1',['up','right']); state.set('finger2',[]);
  assert.deepEqual(edges, [['right',true],['a',true],['up',true]]);
  state.set('finger1',['left']); state.release(); state.release();
  assert.deepEqual(new Set(edges.slice(3,5).map(edge => edge.join(':'))), new Set(['right:false','up:false']));
  assert.deepEqual(edges[5], ['left',true]);
  assert.deepEqual(new Set(edges.slice(6).map(edge => edge.join(':'))), new Set(['a:false','left:false']));
  assert.equal(edges.length, 8);
});
