/// <reference types='@gitpod/gitpod-protocol/lib/typings/globals'/>

import { IDEFrontendState } from "@gitpod/gitpod-protocol/lib/ide-frontend-service";
import ReconnectingWebSocket from "reconnecting-websocket";

export const initiateSupervisorClient = async (socket: ReconnectingWebSocket, devMode = true) => {
	let _state: IDEFrontendState = 'init';
	let _failureCause: Error | undefined;

	const doStart = async () => {
		console.debug("Starting IDE socket");
		socket.reconnect();
	};

	if (devMode) {
		console.debug("Starting in dev mode (can't access window.gitpod)")
		await doStart();
	} else {
		console.debug("Delaying the websocket until supervisor signal")
		window.gitpod.ideService = {
			get state() {
				return _state;
			},
			get failureCause() {
				return _failureCause;
			},
			//@ts-ignore
			start: () => {
				if (_state === "terminated") {
					console.debug("Got state terminated, closing the WebSocket...");
					socket.close();
				}
				_state = "ready";

				doStart();
				return [];
			}
		};
	}
};
