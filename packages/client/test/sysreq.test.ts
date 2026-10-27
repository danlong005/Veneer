import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sysreqField } from '../src/ui/sysreq.ts';
import { mainMenu, signOn, sysreqPrompt, titled } from './screens.ts';

test('after SysReq, "1" goes in the lone input field of the line or the menu', () => {
  assert.equal(sysreqField(sysreqPrompt())?.id, '24:2');
  assert.equal(sysreqField(mainMenu())?.id, '20:7');
  assert.equal(sysreqField(signOn()), null);
  assert.equal(sysreqField(titled('No fields')), null);
});
