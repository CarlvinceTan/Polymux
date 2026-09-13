import test from 'node:test';
import assert from 'node:assert/strict';
import {chassisDeviceType} from './device-type.js';
import {deviceType} from '@polymux/protocol';
test('hardware chassis types distinguish tablets and laptops from desktop PCs', () => {
  for (const value of [30, 32]) assert.equal(chassisDeviceType(value), 'tablet');
  for (const value of [8, 9, 10, 14, 31]) assert.equal(chassisDeviceType(value), 'laptop');
  for (const value of [3, 4, 7, 0]) assert.equal(chassisDeviceType(value), 'pc');
  assert.equal(deviceType('server'), 'server'); assert.equal(deviceType('invalid'), undefined);
});
