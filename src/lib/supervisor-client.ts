/// <reference types='@gitpod/gitpod-protocol/lib/typings/globals'/>

import type { IDEFrontendState } from '@gitpod/gitpod-protocol/lib/ide-frontend-service';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { Disposable, DisposableCollection } from "@gitpod/gitpod-protocol/lib/util/disposable";
import { Emitter } from '@gitpod/gitpod-protocol/lib/util/event';


export const initiateSupervisorClient = async (socket: ReconnectingWebSocket, devMode = true) => {
	let _state: IDEFrontendState = 'init';
	let _failureCause: Error | undefined;
    const onDidChangeEmitter = new Emitter<void>();
    const toStop = new DisposableCollection();
    toStop.push(onDidChangeEmitter);

	const doStart = async () => {
		console.debug("Starting IDE socket");
		socket.reconnect();
	};

	if (devMode) {
		await doStart();
	} else {
		window.gitpod.ideService = {
			get state() {
				return _state;
			},
			get failureCause() {
				return _failureCause;
			},
			onDidChange: onDidChangeEmitter.event,
			start: () => {
				if (_state === "terminated") {
					
				}
				_state = "ready";
				toStop.push(
					Disposable.create(() => {
						_state = "terminated";
						onDidChangeEmitter.fire();
					}),
				);
	
				doStart();
				return toStop;
			}
		};
	}
};
