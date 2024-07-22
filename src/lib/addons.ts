export const webLinksHandler = (_event: MouseEvent, uri: string): void => {
    const newWindow = window.open();
    if (newWindow) {
        newWindow.opener = null;
        const uriToOpen = new URL(uri);
        const localHostnames = ["0.0.0.0", "localhost", "127.0.0.1"];

        const shouldRewrite = localHostnames.includes(uriToOpen.hostname);

        if (shouldRewrite) {
            const workspaceUrl = new URL(location.href).hostname.replace(/\d{1,5}-/, "");
            uriToOpen.protocol = "https:";
            uriToOpen.hostname = `${uriToOpen.port}-${workspaceUrl}`;
            uriToOpen.port = "";
            newWindow.location.href = uriToOpen.toString();
            console.info(`Rewrote ${uri} to ${uriToOpen.toString()}`);
            return;
        }

        newWindow.location.href = uri;
    } else {
        console.warn("Opening link blocked as opener could not be cleared");
    }
};
