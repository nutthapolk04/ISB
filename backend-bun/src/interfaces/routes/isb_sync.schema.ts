import { t } from "elysia";

const staffLoginSchema = t.Object({
    loginId: t.String(),
    email: t.String(),
});

const smartCardSchema = t.Object({ cardNumber: t.String() });

const staffItemSchema = t.Object({
    customerId: t.Number(),
    customerType: t.Literal("Staff"),
    staffType: t.String(),
    department: t.String(),
    familyCode: t.Number(),
    firstName: t.String(),
    lastName: t.String(),
    hasChildren: t.Boolean(),
    profileImage: t.String(),
    smartCard: smartCardSchema,
    login: staffLoginSchema,
});

const parentSchema = t.Object({
    customerId: t.Number(),
    customerType: t.Union([t.Literal("Parent"), t.Literal("Staff")]),
    firstName: t.String(),
    lastName: t.String(),
    profileImage: t.String(),
    login: t.String(),
    smartCard: smartCardSchema,
});

const studentSchema = t.Object({
    customerId: t.Number(),
    customerType: t.Literal("Student"),
    firstName: t.String(),
    lastName: t.String(),
    grade: t.String(),
    schoolType: t.String(),
    profileImage: t.String(),
    smartCard: smartCardSchema,
});

const departmentItemSchema = t.Object({
    departmentId: t.Number(),
    customerType: t.Literal("Department"),
    departmentDescription: t.String(),
    login: t.Optional(t.Nullable(staffLoginSchema)),
    smartCard: t.Optional(smartCardSchema),
});

export const isbSyncStaffs = {
    body: t.Object({
        staffs: t.Array(staffItemSchema),
    }),
    detail: { tags: ["ISB Sync"], summary: "Sync staff batch (x-api-key)" },
};

export const isbSyncFamilies = {
    body: t.Object({
        families: t.Array(
            t.Object({
                familyCode: t.Number(),
                notificationEmails: t.Array(t.String()),
                mainParent: parentSchema,
                secondaryParent: t.Nullable(parentSchema),
                students: t.Array(studentSchema),
            }),
        ),
    }),
    detail: { tags: ["ISB Sync"], summary: "Sync families batch (x-api-key)" },
};

export const isbSyncDepartments = {
    body: t.Object({
        departments: t.Array(departmentItemSchema),
    }),
    detail: { tags: ["ISB Sync"], summary: "Sync departments batch (x-api-key)" },
};
