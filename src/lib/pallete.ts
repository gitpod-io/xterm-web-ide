import 'ninja-keys';
import { createTerminalWindow } from '../windows';

const ninja = document.querySelector('ninja-keys')!;

ninja.data = [
  {
    id: 'Projects',
    title: 'Open Projects',
    hotkey: 'ctrl+N',
    icon: 'apps',
    section: 'Projects',
    handler: () => {
      // it's auto register above hotkey with this handler
      alert('Your logic to handle');
    },
  },
  {
    id: 'Window',
    title: 'Create new Terminal',
    hotkey: 'ctrl+I',
    handler: createTerminalWindow
  }
];

document.documentElement.style.setProperty('--ninja-z-index', '100'); // Hack for displaying terminals below the palette