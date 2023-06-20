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
        section: "Terminal management",
        handler: createTerminalWindow
    },
    {
        id: 'WindowLeft',
        title: 'New Terminal (left half)',
        section: "Terminal management",
        handler: () => {
            createTerminalWindow({ right: "50%", max: true })
        }
    },
    {
        id: 'WindowRight',
        title: 'New Terminal (right half)',
        section: "Terminal management",
        handler: () => {
            createTerminalWindow({ left: "50%", max: true })
        }
    },
    {
        id: 'WindowTop',
        title: 'New Terminal (top half)',
        section: "Terminal management",
        handler: () => {
            createTerminalWindow({ bottom: "50%", max: true })
        }
    },
    {
        id: 'WindowBottom',
        title: 'New Terminal (bottom half)',
        section: "Terminal management",
        handler: () => {
            createTerminalWindow({ top: "50%", max: true })
        }
    },
];
