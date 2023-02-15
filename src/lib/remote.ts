export const resizeRemoteTerminal = (size: { cols: number; rows: number }, pid: number) => {
    if (!pid) {
        return;
    }
    const cols = size.cols;
    const rows = size.rows;
    const url = `/terminals/${pid}/size?cols=${cols}&rows=${rows}`;

    fetch(url, { method: "POST" });
}
