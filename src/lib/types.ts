import { AttachAddon } from 'xterm-addon-attach';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { WebglAddon } from 'xterm-addon-webgl';
import { Unicode11Addon } from 'xterm-addon-unicode11';
import { LigaturesAddon } from 'xterm-addon-ligatures';
import { Terminal } from 'xterm';

export type AddonType = "attach" | "fit" | "unicode11" | "web-links" | "webgl" | "ligatures";

export interface IWindowWithTerminal extends Window {
  term: Terminal;
}

export interface Addon<T extends AddonType> {
    name: T;
    canChange: boolean;
    ctor: T extends "attach"
    ? typeof AttachAddon
    : T extends "fit"
    ? typeof FitAddon
    : T extends "web-links"
    ? typeof WebLinksAddon
    : T extends "unicode11"
    ? typeof Unicode11Addon
    : T extends "ligatures"
    ? typeof LigaturesAddon
    : typeof WebglAddon;
    instance?: T extends "attach"
    ? AttachAddon
    : T extends "fit"
    ? FitAddon
    : T extends "web-links"
    ? WebLinksAddon
    : T extends "webgl"
    ? WebglAddon
    : T extends "unicode11"
    ? typeof Unicode11Addon
    : T extends "ligatures"
    ? typeof LigaturesAddon
    : never;
  }