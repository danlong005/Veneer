import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_SIGN_ON, passwordAllowedHere, signOnMessage, signOnProblem } from '../src/ui/signOn.ts';

const SHA = { maxLength: 128, caseSensitive: true };
const DES = { maxLength: 10, caseSensitive: false };

test('a password is sent only from a page on HTTPS or this machine', () => {
  assert.equal(passwordAllowedHere({ protocol: 'https:', hostname: 'veneer.example.com' }), true);
  assert.equal(passwordAllowedHere({ protocol: 'http:', hostname: 'localhost' }), true);
  assert.equal(passwordAllowedHere({ protocol: 'http:', hostname: '127.0.0.1' }), true);
  assert.equal(passwordAllowedHere({ protocol: 'http:', hostname: '[::1]' }), true);
  assert.equal(passwordAllowedHere({ protocol: 'http:', hostname: 'veneer.example.com' }), false);
  assert.equal(passwordAllowedHere({ protocol: 'http:', hostname: '10.0.0.5' }), false);
  assert.equal(passwordAllowedHere({ protocol: 'file:', hostname: 'localhost' }), false);
});

test('the sign-on page checks what the host would refuse anyway', () => {
  const form = { ...EMPTY_SIGN_ON, user: ' dlong ', password: 'A long pass phrase' };
  assert.equal(signOnProblem(form, SHA), undefined);
  assert.equal(signOnProblem({ ...form, user: '' }, SHA), 'Type your user name.');
  assert.match(signOnProblem({ ...form, user: '1abc' }, SHA)!, /starting with a letter/);
  assert.match(signOnProblem({ ...form, user: 'longerthan10' }, SHA)!, /up to 10/);
  assert.equal(signOnProblem({ ...form, password: '' }, SHA), 'Type your password.');
  assert.equal(signOnProblem(form, DES), 'A password is at most 10 characters on this IBM i.');
  assert.match(signOnProblem({ ...form, library: 'my lib' }, SHA)!, /current library must be an IBM i name/);
});

test('the message uppercases names and leaves out blanks; the password stays as typed', () => {
  assert.deepEqual(signOnMessage({ user: ' dlong', password: ' Pass Word ', program: '', menu: ' main ', library: '' }),
    { type: 'signon', user: 'DLONG', password: ' Pass Word ', menu: 'MAIN' });
});
