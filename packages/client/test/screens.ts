// Realistic screens, built as host data streams and run through the real terminal.

import { Attr, HostStream, Terminal, buildRecord, getCodepage, snapshot, type ScreenSnapshot } from '@veneer/tn5250';

const cp = getCodepage(37);
const { WHITE, BLUE, NONDISPLAY } = Attr;

function render(build: (s: HostStream) => HostStream, error?: string): ScreenSnapshot {
  const t = new Terminal({ codepage: cp, terminalType: 'IBM-3179-2', sendRecord: () => {} });
  t.processRecord(buildRecord(0x03, build(new HostStream().clear().write()).readMdt().build()));
  if (error) t.processRecord(buildRecord(0x03, new HostStream().errorMessage(error).build()));
  return snapshot(t.screen, cp);
}

export const titled = (title: string, error?: string) => render((s) => s.text(1, 36, title, WHITE), error);

export const signOn = () => render((s) => s
  .text(1, 36, 'Sign On', WHITE)
  .text(2, 48, 'System . . . . . :   PUB400')
  .text(6, 17, 'User  . . . . . . . . . . . . . .')
  .field(6, 53, 10, { ffw: 0x4020 })
  .text(7, 17, 'Password  . . . . . . . . . . . .')
  .field(7, 53, 10, { attr: NONDISPLAY })
  .text(24, 40, '(C) COPYRIGHT IBM CORP. 1980, 2024.'));

export const mainMenu = () => render((s) => s
  .text(1, 2, 'MAIN')
  .text(1, 33, 'IBM i Main Menu', WHITE)
  .text(1, 64, 'System:   PUB400')
  .text(3, 2, 'Select one of the following:')
  .text(5, 6, '1. User tasks')
  .text(6, 6, '2. Office tasks')
  .text(15, 5, '90. Sign off')
  .text(19, 2, 'Selection or command')
  .text(20, 2, '===>')
  .field(20, 7, 70)
  .text(22, 2, 'F3=Exit   F4=Prompt   F9=Retrieve   F12=Cancel   F13=Information Assistant', BLUE)
  .text(23, 2, 'F23=Set initial menu', BLUE));

export const workWithJobs = (marker = 'More...') => render((s) => s
  .text(1, 30, 'Work with Active Jobs', WHITE)
  .text(1, 72, 'PUB400')
  .text(7, 2, 'Type options, press Enter.', BLUE)
  .text(8, 3, '2=Change   3=Hold   4=End   5=Work with   6=Release', BLUE)
  .text(10, 2, 'Opt  Subsystem/Job  User        Type    CPU %  Function        Status', WHITE)
  .field(11, 3, 1).text(11, 7, 'QBATCH').text(11, 22, 'QSYS        SBS').text(11, 45, '.0').text(11, 66, 'DEQW')
  .field(12, 3, 1).text(12, 7, 'QINTER').text(12, 22, 'QSYS        SBS').text(12, 43, '12.5').text(12, 66, 'DEQW')
  .field(13, 3, 1).text(13, 9, 'QPADEV0001').text(13, 22, 'DLONG       INT').text(13, 45, '.1')
  .text(13, 50, 'CMD-WRKACTJOB').text(13, 66, 'RUN')
  .text(19, 73, marker)
  .text(20, 2, 'Parameters or command')
  .text(21, 2, '===>')
  .field(21, 7, 73)
  .text(22, 2, 'F3=Exit   F5=Refresh   F7=Find   F10=Restart statistics', BLUE)
  .text(23, 2, 'F11=Display elapsed data   F12=Cancel   F23=More options   F24=More keys', BLUE));
