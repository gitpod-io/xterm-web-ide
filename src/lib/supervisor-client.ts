/// <reference types='@gitpod/gitpod-protocol/lib/typings/globals'/>

import { Disposable, DisposableCollection, Emitter } from "@gitpod/gitpod-protocol";
import { IDEFrontendState } from "@gitpod/gitpod-protocol/lib/ide-frontend-service";
import ReconnectingWebSocket from "reconnecting-websocket";

export const initiateSupervisorClient = async (socket: ReconnectingWebSocket, devMode = true) => {
	let _state: IDEFrontendState = 'init';
	let _failureCause: Error | undefined;
    const onDidChangeEmitter = new Emitter<void>();

	let toStop = new DisposableCollection();

	const doStart = async () => {
		console.debug("Starting IDE socket");
		socket.reconnect();
	};

	if (devMode) {
		console.debug("Starting in dev mode (can't access window.gitpod)")
		await doStart();
	} else {
		console.debug("Delaying the websocket until supervisor signal")
		//@ts-ignore
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
					console.debug("Got state terminated, closing the WebSocket...");
					socket.close();
				}

				toStop.push(Disposable.create(() => {
					console.debug("Stopping IDE socket");
					socket.close();
				}));

				toStop.push(
					Disposable.create(() => {
						_state = "terminated";
						onDidChangeEmitter.fire();
					}),
				);

				_state = "ready";

				doStart();
				return toStop;
			}
		};
	}
};
