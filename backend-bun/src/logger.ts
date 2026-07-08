import fs from 'node:fs'
import { addColors, createLogger, format, transports } from 'winston'
import winstonDaily from 'winston-daily-rotate-file'
import Elysia from 'elysia'
import { nanoseconds } from 'bun'
import { ip } from 'elysia-ip'

// logs dir
const logDir: string = Bun.env.LOG_DIR ?? './logs'
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
}

const level = () => {
    const isDebug = Bun.env.NODE_ENV == 'development' || Bun.env.DEBUG_MODE == 'true'
    return isDebug ? 'debug' : 'info'
}

// Define different colors for each level.
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    verbose: 'white',
    debug: 'blue',
    silly: 'gray',
}

addColors(colors)

const isObjectOrArray = (obj: any): boolean => {
    return obj !== null && !!obj && (typeof obj === 'object' || Array.isArray(obj))
}

const stringify = (obj: any, stack: any[] = []): any => {
    if (!obj || typeof obj !== 'object') return obj

    if (stack.includes(obj)) return null

    const s = stack.concat([obj])

    return JSON.stringify(
        Array.isArray(obj)
            ? obj.map((x) => stringify(x, s))
            : Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, stringify(v, s)])),
        null,
        4,
    )
}

const logFormat = format.printf(({ timestamp, level, message, ...meta }) => {
    if (isObjectOrArray(meta) && Object.keys(meta).length) {
        return `[${timestamp as string}] [${level}]: ${isObjectOrArray(message) ? stringify(message) : message
            } ${stringify(meta)}`
    } else {
        return `[${timestamp as string}] [${level}]: ${isObjectOrArray(message) ? stringify(message) : message}`
    }
})

const requestId = () => {
    return Date.now().toString() + nanoseconds().toString().substring(0, 7)
}

/** Log an error with message + stack trace for incident debugging. */
export function logError(message: string, error: unknown, meta?: Record<string, unknown>) {
    logger.error(message, {
        ...meta,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
    })
}

// Winston logger
export const logger = createLogger({
    level: level(),
    format: format.combine(
        format.splat(),
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss.SSS',
        }),
        logFormat,
    ),

    // Log to the console
    transports: [
        new transports.Console({
            level: level(),
            format: format.combine(format.splat(), format.colorize({ colors, all: true })),
        }),
        new winstonDaily({
            level: level(),
            datePattern: 'YYYY-MM-DD',
            dirname: logDir,
            filename: `%DATE%.log`,
            maxFiles: 30, // 30 Days saved
            json: false,
            zippedArchive: true,
        }),
    ],
})

export const logging = (app: Elysia) =>
    app
        .use(ip({ headersOnly: true }))
        .derive({ as: 'global' }, () => ({
            start: performance.now(),
            requestId: `${requestId()}`,
        }))
        .onBeforeHandle({ as: 'global' }, (ctx) => {
            ctx.set.headers['X-Request-Id'] = ctx.requestId
            logger.debug(
                `Req:-->[${Bun.env.WORKER_ID}:${process.pid}] [${ctx.requestId}] [${ctx.ip}] ${ctx.request.method} ${ctx.path}`,
            )
        })
        .onAfterHandle({ as: 'global' }, (ctx) => {
            if (!ctx.set.status) {
                logger.error(
                    `Res:<--[${Bun.env.WORKER_ID}:${process.pid}] [${ctx.requestId}] [${ctx.ip}] ${ctx.request.method
                    } ${ctx.path} [500] in ${(performance.now() - ctx.start).toFixed(2)} ms`,
                )
            } else {
                logger.info(
                    `Res:<--[${Bun.env.WORKER_ID}:${process.pid}] [${ctx.requestId}] [${ctx.ip}] ${ctx.request.method
                    } ${ctx.path} [${ctx.set.status}] in ${(performance.now() - ctx.start).toFixed(2)} ms`,
                )
            }
        })
        .onError({ as: 'global' }, (ctx) => {
            const err = 'error' in ctx ? ctx.error : undefined
            logError(
                `Res:<--[${Bun.env.WORKER_ID}:${process.pid}] [${ctx.requestId}] [${ctx.ip}] ${ctx.request.method} ${ctx.path} [${ctx.set.status}]`,
                err,
                {
                    durationMs: ctx.start ? (performance.now() - ctx.start).toFixed(2) : undefined,
                },
            )
        })
