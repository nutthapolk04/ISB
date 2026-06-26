import ResponseStatus from '@/constants/ResponseStatus';
import { AuthController } from '@/controllers/AuthController';
import { LineUserController } from '@/controllers/LineUserController';
import { lineWebHookController } from '@/controllers/LineWebHookController';
import { SchoolController } from '@/controllers/SchoolController';
import { StudentController } from '@/controllers/StudentController';
import { TicketController } from '@/controllers/TicketController';
import { Role } from '@/enumerate/UserRole';
import * as RoutesSchema from '@/interfaces/RoutesSchema';
import { authMiddleware } from '@/middlewares/AuthMiddleware';
import { jwtPlugin } from '@/utils/AuthUtils';
import { Context, Elysia } from 'elysia';
import { UserController } from '@/controllers/UserController';
import { createRateLimit } from '@/middlewares/RateLimitMiddleware';
import timer from '@/middlewares/TimerMiddleware';

const scanIngestLimit = createRateLimit(120);
const scanReadLimit = createRateLimit(60);

const router = (app: Elysia) =>
    app
        .trace(timer())
        .use(jwtPlugin)
        .group('/api/v1/auth', (app) =>
            app.post('/login', AuthController.login, RoutesSchema.login).guard(
                {
                    beforeHandle: authMiddleware([Role.ADMIN, Role.SUPPORT]),
                },
                (app) => app.post('/logout', AuthController.logout, RoutesSchema.logout),
            ),
        )

        .group('/api/v1/users', (app) =>
            app
                .guard(
                    {
                        beforeHandle: authMiddleware([Role.ADMIN]),
                    },
                    (protectedApp) =>
                        protectedApp
                            .post('/', UserController.create, RoutesSchema.createUser)
                            .delete('/', UserController.delete, RoutesSchema.deleteUser),
                )
                .put('/change-password', UserController.changePassword, RoutesSchema.changePassword)
                .guard(
                    {
                        beforeHandle: authMiddleware([Role.ADMIN, Role.SUPPORT]),
                    },
                    (protectedApp) => protectedApp.get('/me', UserController.me, RoutesSchema.me),
                ),
        )
        .group('/api/v1/line-users', (app) =>
            app
                .post('/link', LineUserController.link, RoutesSchema.linkLineUser)
                .put('/select-student', LineUserController.updateSelectedStudent, RoutesSchema.updateSelectedStudent)
                .put('/display-name', LineUserController.updateDisplayName, RoutesSchema.updateDisplayName)
                .get('/:lineID', LineUserController.getByLineID, RoutesSchema.getByLineID)
        )

        .group('/api/v1/student', (app) => app.get('/options', StudentController.options, RoutesSchema.studentOptions))
        .group('/api/v1/schools', (app) =>
            app.guard(
                {
                    beforeHandle: authMiddleware([Role.ADMIN, Role.SUPPORT]),
                },
                (protectedApp) =>
                    protectedApp
                        .get('/', SchoolController.list, RoutesSchema.schoolList)
                        .get('/:id', SchoolController.getById, RoutesSchema.getSchoolById)
                        .post('/', SchoolController.create, RoutesSchema.createSchool)
                        .put('/:id', SchoolController.update, RoutesSchema.updateSchool)
                        .delete('/:id', SchoolController.delete, RoutesSchema.deleteSchool),
            ),
        )
        .group('/api/v1/tickets', (app) =>
            app.guard(
                {
                    beforeHandle: [authMiddleware([Role.ADMIN, Role.SUPPORT]), scanIngestLimit],
                },
                (protectedApp) =>
                    protectedApp
                        .get('/', TicketController.list, RoutesSchema.ticketList)
                        .get('/:id', TicketController.getById, RoutesSchema.getTicketById)
                        .put('/:id/status', TicketController.updateStatus, RoutesSchema.updateTicketStatus)
                        .put('/:id/note', TicketController.updateNote, RoutesSchema.updateTicketNote),
            ),
        )
        .post('/webhook/line', lineWebHookController.handler, RoutesSchema.lineWebHook)
        .all('*', (ctx: Context) => {
            ctx.set.status = 404;
            return {
                status: ResponseStatus.NOT_FOUND,
                message: `You have no permission to access this content. | service version ${1.0}`,
            };
        })
        .onError(({ code }) => {
            return {
                status: code,
                message: 'An error occurred while processing your request.',
            };
        });
export default router;
