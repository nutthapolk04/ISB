import { t } from "elysia";

export const login = {
    body: t.Object({
        username: t.String({
            description: "Username for dashboard account",
        }),
        password: t.String({
            description: "Account password",
        }),
    }),
    detail: {
        tags: ["Auth"],
    },
}

export const logout = {
    detail: {
        tags: ["Auth"],
    },
}

export const createUser = {
    body: t.Object({
        username: t.String(),
        password: t.String(),
        role: t.Enum(Role),
    }),
    detail: {
        tags: ["User"],
    }
}

export const deleteUser = {
    body: t.Object({
        username: t.String(),
    }),
    detail: {
        tags: ["User"],
    }
}
export const changePassword = {
    body: t.Object({
        username: t.String(),
        password: t.String(),
        newPassword: t.String(),
    }),
    detail: {
        tags: ["User"],
    }
}

export const me = {
    detail: {
        tags: ["User"],
    }
}

export const linkLineUser = {
    body: t.Object({
        idToken: t.String({ description: "LIFF idToken" }),
        lineSchID: t.String({ description: "Schoolney LINE userId" }),
        code: t.String({ description: "School code" }),
        role: t.Enum(LineUserRole, { description: "User role (parents | student | teacher | staff | restaurant)" }),
        fullName: t.Optional(t.String({ description: "User full name" })),
        idNumber: t.Optional(t.String({ description: "User id number" })),
    }),
    detail: {
        tags: ["LineUser"],
    }
}

export const updateSelectedStudent = {
    body: t.Object({
        idToken: t.String({ description: "LIFF idToken" }),
        selectedStudent: t.Array(t.Object({
            studentNumber: t.String(),
            fullname: t.String(),
            classroom: t.String(),
        }), {
            description: "All selected student numbers (replaces entire array)",
        }),
    }),
    detail: {
        tags: ["LineUser"],
    }
}

export const updateDisplayName = {
    body: t.Object({
        idToken: t.String({ description: "LIFF idToken" }),
        displayName: t.String(),
    }),
    detail: {
        tags: ["LineUser"],
    }
}

export const getByLineID = {
    params: t.Object({ lineID: t.String() }),
    detail: {
        tags: ["LineUser"],
    }
}

export const getByNameID = {
    params: t.Object({ nameID: t.String() }),
    detail: {
        tags: ["LineUser"],
    }
}

export const studentOptions = {
    query: t.Object({
        lineId: t.String({ description: "lineSchID (Schoolney LINE userId)" }),
    }),
    detail: {
        tags: ["Student"],
    }
}

export const schoolList = {
    query: t.Object({
        code: t.Optional(t.String({ description: "filter by school code" })),
    }),
    detail: {
        tags: ["School"],
    }
}

export const createSchool = {
    body: t.Object({
        code: t.String(),
        name: t.String(),
        url: t.String(),
        angerThreshold: t.Optional(
            t.Integer({ minimum: 1, maximum: 10, description: "Anger score handoff threshold" }),
        ),
    }),
    detail: {
        tags: ["School"],
    }
}

export const getSchoolById = {
    params: t.Object({ id: t.String() }),
    detail: {
        tags: ["School"],
    }
}

export const updateSchool = {
    params: t.Object({ id: t.String() }),
    body: t.Object(
        {
            name: t.Optional(t.String()),
            url: t.Optional(t.String()),
            angerThreshold: t.Optional(
                t.Integer({ minimum: 1, maximum: 10 }),
            ),
        },
        {
            minProperties: 1,
            description: "At least one of name, url, angerThreshold",
        },
    ),
    detail: {
        tags: ["School"],
    }
}

export const deleteSchool = {
    params: t.Object({ id: t.String() }),
    detail: {
        tags: ["School"],
    }
}

export const ticketList = {
    query: t.Object({
        status: t.Optional(t.Enum(TicketStatus)),
        code: t.Optional(t.String()),
        closedOn: t.Optional(
            t.String({ description: "YYYY-MM-DD (tickets closed on this calendar day)" }),
        ),
    }),
    detail: {
        tags: ["Ticket"],
    }
}

export const getTicketById = {
    params: t.Object({ id: t.String() }),
    detail: {
        tags: ["Ticket"],
    }
}

export const updateTicketStatus = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        status: t.Enum(TicketStatus),
        expectedUpdatedAt: t.String({
            description: "Last seen updatedAt (ISO string) for optimistic locking",
        }),
    }),
    detail: {
        tags: ["Ticket"],
    }
}

export const updateTicketNote = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        note: t.String(),
        expectedUpdatedAt: t.String({
            description: "Last seen updatedAt (ISO string) for optimistic locking",
        }),
    }),
    detail: {
        tags: ["Ticket"],
    }
}

export const lineWebHook = {
    detail: {
        tags: ["LineWebHook"],
    }
}
