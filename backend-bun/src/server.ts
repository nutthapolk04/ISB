import { logger } from "@/logger";
import { initIO } from "@/utils/SocketIO";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import app, { initializeServices } from "./app";

/**
 * Host Elysia on a Node http.Server so Socket.IO can share the same port.
 * (Bun implements node:http APIs, so this works on Bun runtime.)
 */

function nodeReqToWebRequest(req: IncomingMessage): Request {
    const host = req.headers.host ?? `localhost:${Bun.env.PORT || 4000}`;
    const url = `http://${host}${req.url ?? "/"}`;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) for (const vv of v) headers.append(k, vv);
        else headers.set(k, v);
    }

    const method = (req.method ?? "GET").toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD";

    const init: RequestInit = {
        method,
        headers,
        body: hasBody ? (req as unknown as ReadableStream) : undefined,
    };

    // `duplex` is required by Node's fetch when streaming request bodies, but it's
    // not part of the standard `RequestInit` typings. We pass it in a typed escape hatch.
    return new Request(
        url,
        hasBody ? ({ ...init, duplex: "half" } as any) : init,
    );
}

async function writeWebResponse(res: ServerResponse, webRes: Response) {
    res.statusCode = webRes.status;
    webRes.headers.forEach((val, key) => res.setHeader(key, val));

    if (!webRes.body) {
        res.end();
        return;
    }

    const reader = webRes.body.getReader();
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) res.write(value);
        }
    } finally {
        res.end();
    }
}

const port = Number(Bun.env.PORT) || 4000;

const httpServer = createServer(async (req, res) => {
    try {
        const webReq = nodeReqToWebRequest(req);
        const webRes = await app.handle(webReq);
        await writeWebResponse(res, webRes);
    } catch (err: any) {
        logger.error(`[server] request handling error: ${err?.message ?? err}`);
        if (!res.headersSent) res.statusCode = 500;
        res.end("Internal Server Error");
    }
});

initIO(httpServer);


await initializeServices().catch(error => {
    logger.error('Fatal error during initialization:', error)
    process.exit(1)
})

httpServer.listen(port, () => {
    logger.info(`App listening at port: ${port}`);
});

