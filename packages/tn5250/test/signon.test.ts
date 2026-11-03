import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  desSubstitute, foldedId, passwordProblem, shaSubstitute, signOnOutcome, startupResponse, substituteFor,
} from '../src/signon.ts';
import { TelnetCodec, requestedSeed } from '../src/telnet.ts';

const hex = (s: string) => Buffer.from(s.replace(/\s/g, ''), 'hex');

test('DES password substitutes match RFC 4777', () => {
  // Section 5.1, step 9.
  assert.equal(desSubstitute('USER123', 'ABCDEFG', hex('7D4C2319F28004B2'), hex('08BEF662D851F4B1')).toString('hex'), '5a58bd50e4dd9b5f');
  // Section 5, the encrypted example.
  assert.equal(desSubstitute('DUMMYUSR', 'DUMMYPW', hex('7D3E488F18080404'), hex('4E4142334E414233')).toString('hex'), 'dfb0402f22aba3ba');
  assert.equal(desSubstitute('dummyusr', 'dummypw', hex('7D3E488F18080404'), hex('4E4142334E414233')).toString('hex'), 'dfb0402f22aba3ba', 'uppercased first');
});

test('DES: a 9- or 10-character user ID is folded into 8 bytes, as RFC 4777 step 4 describes', () => {
  // USERNAME10 in EBCDIC: E4 E2 C5 D9 D5 C1 D4 C5, then F1 F0. F1 = 11 11 00 01 goes two bits at a
  // time into the top bits of bytes 1-4 (C0 C0 00 40), F0 = 11 11 00 00 into bytes 5-8 (C0 C0 00 00).
  assert.equal(foldedId(hex('E4E2C5D9D5C1D4C5F1F0')).toString('hex'), '2422c5991501d4c5');
  // A ninth character only: the tenth is a blank (40 = 01 00 00 00), which changes byte 5 alone (D5 -> 95).
  assert.equal(foldedId(hex('E4E2C5D9D5C1D4C5F1')).toString('hex'), '2422c59995c1d4c5');
  assert.equal(foldedId(hex('C4D3D6D5C7')).toString('hex'), 'c4d3d6d5c7404040', 'a short ID is padded with blanks');
});

test('DES: 9- and 10-character passwords and user IDs use every character', () => {
  const s = hex('7D4C2319F28004B2'), c = hex('08BEF662D851F4B1');
  const base = desSubstitute('USER123', 'ABCDEFGH', s, c);
  assert.notDeepEqual(desSubstitute('USER123', 'ABCDEFGHI', s, c), base);
  assert.notDeepEqual(desSubstitute('USER123', 'ABCDEFGHIJ', s, c), desSubstitute('USER123', 'ABCDEFGHIK', s, c));
  assert.notDeepEqual(desSubstitute('USERNAME9', 'ABCDEFG', s, c), desSubstitute('USERNAME', 'ABCDEFG', s, c));
  assert.notDeepEqual(desSubstitute('USERNAME10', 'ABCDEFG', s, c), desSubstitute('USERNAME11', 'ABCDEFG', s, c));
  assert.throws(() => desSubstitute('USER123', 'ABCDEFGHIJK', s, c), RangeError);
  assert.throws(() => desSubstitute('USER123', 'ABC', s, hex('00')), RangeError, 'seeds are 8 bytes');
});

test('the SHA-1 password substitute matches RFC 4777, and the password keeps its case', () => {
  const s = hex('3E3A71C78795E5F5'), c = hex('B1C806D5D377D994');
  // Section 5.2, step 6.
  assert.equal(shaSubstitute('USER123', 'AbCdEfGh123?+', s, c).toString('hex'), 'e7fab5f034beda42e91f439dd07532a24140e3dd');
  assert.equal(shaSubstitute('user123', 'AbCdEfGh123?+', s, c).toString('hex'), 'e7fab5f034beda42e91f439dd07532a24140e3dd');
  assert.notDeepEqual(shaSubstitute('USER123', 'ABCDEFGH123?+', s, c), shaSubstitute('USER123', 'AbCdEfGh123?+', s, c));
  assert.equal(shaSubstitute('USER123', 'x'.repeat(128), s, c).length, 20);
  assert.throws(() => shaSubstitute('USER123', 'x'.repeat(129), s, c), RangeError);
});

test('the password level picks the substitute, and what a password may be', () => {
  assert.deepEqual([0, 1, 2, 3].map(substituteFor), ['des', 'des', 'sha', 'sha']);
  assert.equal(passwordProblem('', 'sha'), 'Type your password.');
  assert.equal(passwordProblem('a long pass phrase, with spaces!', 'sha'), undefined);
  assert.equal(passwordProblem('x'.repeat(129), 'sha'), 'A password is at most 128 characters.');
  assert.equal(passwordProblem('Passw0rd', 'des'), undefined);
  assert.match(passwordProblem('Passw0rd123', 'des')!, /at most 10/);
  assert.match(passwordProblem('pass word', 'des')!, /letters, digits/);
});

test('reads Startup Response Records: the code, system and device', () => {
  // RFC 4777 section 10.1.
  const rfc = hex('004912A090000560060020C0003D0000C9F9F0F2E3C1D9C7C5E34040D7C3D7D9C9D5E3C5D940' + '00'.repeat(36));
  assert.deepEqual(startupResponse(rfc), { code: 'I902', system: 'TARGET', device: 'PCPRINTER' });
  // PUB400's, captured.
  const pub400 = hex('004912a090000560060020c0003d0000c9f9f0f2d7e4c2f4f0f04040d8d7c1c4c5e5f0f0f3f0' + '00'.repeat(37));
  assert.deepEqual(startupResponse(pub400), { code: 'I902', system: 'PUB400', device: 'QPADEV0030' });
  // An ordinary 5250 record (Write To Display) is not one.
  assert.equal(startupResponse(hex('000d12a0000004000003044011')), undefined);
});

test('what the codes say about an automatic sign-on', () => {
  assert.equal(signOnOutcome('I902'), 'signed-on');
  assert.equal(signOnOutcome('I906'), 'not-allowed');
  assert.equal(signOnOutcome('8937'), 'not-allowed');
  assert.equal(signOnOutcome('0005'), 'expired');
  for (const code of ['0002', '0003', '0004', '0008']) assert.equal(signOnOutcome(code), 'rejected', code);
  assert.equal(signOnOutcome('8902'), undefined, 'a device error is not about sign-on');
});

const IAC = 0xff, SB = 0xfa, SE = 0xf0;

test("reads the host's seed from its NEW-ENVIRON request, escaped bytes and all", () => {
  // RFC 4777 section 5: USERVAR "IBMRSEEDxxxxxxxx" USERVAR "IBMSUBSPW" VAR USERVAR.
  const rfc = [0x03, ...Buffer.from('IBMRSEED'), ...hex('7D3E488F18080404'), 0x03, ...Buffer.from('IBMSUBSPW'), 0x03, 0x00];
  assert.deepEqual(requestedSeed(rfc), hex('7D3E488F18080404'));
  // Seed bytes 0-3 come after ESC (02).
  const escaped = [0x03, ...Buffer.from('IBMRSEED'), 0x7d, 0x02, 0x02, 0x48, 0x02, 0x00, 0x18, 0x08, 0x04, 0x04, 0x00, 0x03];
  assert.deepEqual(requestedSeed(escaped), Buffer.from([0x7d, 0x02, 0x48, 0x00, 0x18, 0x08, 0x04, 0x04]));
  assert.equal(requestedSeed([0x00, 0x03]), undefined, 'no seed');
  assert.equal(requestedSeed([0x03, ...Buffer.from('IBMRSEED'), 0x01, 0x02]), undefined, 'a short one');
});

test('sends the user, its seed and the substitute, never the password, and asks for the Startup Response Record', () => {
  const sent: number[][] = [];
  const c = new TelnetCodec({
    terminalType: 'IBM-3179-2', deviceName: 'WEB01',
    autoSignOn: { user: 'dlong', password: 'Secret Phrase 1', substitute: 'sha', menu: 'main' },
    send: (b) => sent.push([...b]), onRecord: () => {},
  });
  assert.equal(c.autoSignOnOffered, undefined);
  // The seed holds IAC (doubled on the wire) and ESC.
  const seed = [0x7d, 0x02, 0x02, 0x48, 0xff, 0xff, 0x18, 0x08, 0x04, 0x04];
  c.receive(Buffer.from([IAC, SB, 0x27, 0x01, 0x03, ...Buffer.from('IBMRSEED'), ...seed, 0x03, ...Buffer.from('IBMSUBSPW'), 0x00, 0x03, IAC, SE]));
  assert.equal(c.autoSignOnOffered, true);
  const reply = Buffer.from(sent[0]!);
  const text = reply.toString('latin1');
  assert.ok(text.startsWith('\xff\xfa\x27\x00\x00USER\x01DLONG\x03IBMRSEED\x01'));
  assert.ok(text.includes('\x03IBMIMENU\x01MAIN\x03IBMSENDCONFREC\x01YES\x03DEVNAME\x01WEB01\xff\xf0'));
  assert.ok(!text.toLowerCase().includes('secret'), 'no password');

  // Unescape the reply and check the substitute against the seeds in it.
  const unIac = Buffer.from(sent[0]!.slice(3, -2)).toString('latin1').replace(/\xff\xff/g, '\xff');
  const value = (name: string) => {
    const from = unIac.indexOf(`\x03${name}\x01`) + name.length + 2;
    const out: number[] = [];
    for (let i = from; i < unIac.length; i++) {
      let b = unIac.charCodeAt(i);
      if (b === 0x02) b = unIac.charCodeAt(++i);
      else if (b <= 0x03) break;
      out.push(b);
    }
    return Buffer.from(out);
  };
  const clientSeed = value('IBMRSEED');
  assert.equal(clientSeed.length, 8);
  const serverSeed = Buffer.from([0x7d, 0x02, 0x48, 0xff, 0x18, 0x08, 0x04, 0x04]);
  assert.deepEqual(value('IBMSUBSPW'), shaSubstitute('DLONG', 'Secret Phrase 1', serverSeed, clientSeed));

  // Asked again for a device name (no seed this time): the same sign-on goes with the next one.
  c.receive(Buffer.from([IAC, SB, 0x27, 0x01, 0x03, ...Buffer.from('DEVNAME'), IAC, SE]));
  assert.ok(Buffer.from(sent[1]!).toString('latin1').includes('USER\x01DLONG'));
  assert.deepEqual(sent[1]!.slice(0, 40), sent[0]!.slice(0, 40), 'the same seed and substitute');
  assert.equal(c.autoSignOnOffered, true, 'still signing on');
});

test('seed and substitute bytes that are NEW-ENVIRON codes go after ESC', () => {
  const sent: number[][] = [];
  const clientSeed = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0x40, 0x41, 0x42]);
  const c = new TelnetCodec({
    terminalType: 'IBM-3179-2',
    autoSignOn: { user: 'DLONG', password: 'pw', substitute: 'des' },
    clientSeed: () => clientSeed,
    send: (b) => sent.push([...b]), onRecord: () => {},
  });
  const serverSeed = hex('7D3E488F18080404');
  c.receive(Buffer.from([IAC, SB, 0x27, 0x01, 0x03, ...Buffer.from('IBMRSEED'), ...serverSeed, 0x00, 0x03, IAC, SE]));
  const text = Buffer.from(sent[0]!).toString('latin1');
  assert.ok(text.includes('IBMRSEED\x01\x02\x00\x02\x01\x02\x02\x02\x03\xff\xff\x40\x41\x42\x03IBMSUBSPW\x01'), 'escaped, and IAC doubled');
  const escape = (b: Buffer) => [...b].flatMap((x) => (x <= 3 ? [0x02, x] : x === 0xff ? [0xff, 0xff] : [x]));
  const substitute = desSubstitute('DLONG', 'pw', serverSeed, clientSeed);
  assert.ok(text.includes(`IBMSUBSPW\x01${Buffer.from(escape(substitute)).toString('latin1')}\x03IBMSENDCONFREC`));
});

test('a host that sends no seed gets no user or password', () => {
  const sent: number[][] = [];
  const c = new TelnetCodec({
    terminalType: 'IBM-3179-2',
    autoSignOn: { user: 'DLONG', password: 'pw', substitute: 'des' },
    send: (b) => sent.push([...b]), onRecord: () => {},
  });
  c.receive(Buffer.from([IAC, SB, 0x27, 0x01, 0x00, 0x03, IAC, SE]));
  assert.deepEqual(sent, [[IAC, SB, 0x27, 0x00, IAC, SE]]);
  assert.equal(c.autoSignOnOffered, false);
});

test('a session reports a host that offers no seed as not allowing automatic sign-on, before its first screen', async () => {
  const net = await import('node:net');
  const { Session } = await import('../src/session.ts');
  const { buildRecord } = await import('../src/terminal.ts');
  const server = net.createServer((s) => {
    s.on('error', () => {});
    s.write(Buffer.from([IAC, 0xfd, 0x27, IAC, SB, 0x27, 0x01, 0x00, 0x03, IAC, SE]));
    // No Startup Response Record: straight to a screen (Write To Display, unlock).
    s.write(Buffer.concat([buildRecord(0x03, [0x04, 0x40, 0x04, 0x11, 0x00, 0x08]), Buffer.from([IAC, 0xef])]));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const session = new Session({ host: '127.0.0.1', port, autoSignOn: { user: 'DLONG', password: 'pw', substitute: 'sha' } });
  const events: string[] = [];
  session.on('signOn', (r) => events.push(`signOn ${r.outcome}`));
  session.on('screen', () => events.push('screen'));
  try {
    await session.connect();
    const deadline = Date.now() + 3000;
    while (!events.includes('screen') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(events.slice(0, 2), ['signOn not-allowed', 'screen']);
  } finally {
    session.close();
    server.close();
  }
});
