export interface PurchaseItem {
    name: string;
    qty: number;
    price: number;
    addons?: string[];
}

export interface Transaction {
    id: string;
    type: 'topup' | 'purchase';
    date: string;
    time: string;
    amount: number;
    machine: string;
    balanceBefore: number;
    balanceAfter: number;
    items?: PurchaseItem[];
}

export interface Wallet {
    id: string;
    type: 'personal' | 'child';
    name: string;
    holderName: string;
    cardId: string;
    balance: number;
    colorTheme: string; // hex color or class
}

export interface User {
    id: string;
    name: string;
    employeeId: string;
    wallets: Wallet[];
}

const mockUsers: Record<string, User> = {
    '1234567890': {
        id: '1',
        name: 'Somchai Rakdee',
        employeeId: 'EMP001',
        wallets: [
            {
                id: 'w1',
                type: 'personal',
                name: 'Personal Wallet',
                holderName: 'Somchai Rakdee',
                cardId: '1234567890',
                balance: 1250.75,
                colorTheme: 'linear-gradient(135deg, #3b1f7e 0%, #6b3fa0 50%, #9b6fcf 100%)' // Purple
            }
        ]
    },
    '0987654321': {
        id: '2',
        name: 'Jane Doe',
        employeeId: 'EMP002',
        wallets: [
            {
                id: 'w2_1',
                type: 'personal',
                name: 'My Wallet',
                holderName: 'Jane Doe',
                cardId: '0987654321',
                balance: 3420.00,
                colorTheme: 'linear-gradient(135deg, #3b1f7e 0%, #6b3fa0 50%, #9b6fcf 100%)' // Purple for personal
            },
            {
                id: 'w2_2',
                type: 'child',
                name: "Son's Wallet",
                holderName: 'Baby Doe',
                cardId: 'CHILD001',
                balance: 150.00,
                colorTheme: 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)' // Orange for child
            }
        ]
    },
    '12345': {
        id: '3',
        name: 'Test Account',
        employeeId: '12345',
        wallets: [
            {
                id: 'w3',
                type: 'personal',
                name: 'Test Wallet',
                holderName: 'Test Account',
                cardId: '12345',
                balance: 500.00,
                colorTheme: 'linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)'
            }
        ]
    },
    'A1234': {
        id: '4',
        name: 'Admin User',
        employeeId: 'A1234',
        wallets: [
            {
                id: 'w4',
                type: 'personal',
                name: 'Admin Wallet',
                holderName: 'Admin User',
                cardId: 'ADMINCARD',
                balance: 9999.00,
                colorTheme: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 50%, #7f1d1d 100%)'
            }
        ]
    }
};

const mockTransactions: Record<string, Transaction[]> = {
    '1': [
        {
            id: 'TX001', type: 'purchase', date: '2024-05-10', time: '14:30', amount: 45.00, machine: 'Canteen A', balanceBefore: 1295.75, balanceAfter: 1250.75, items: [
                { name: 'ข้าวผัดกระเพรา', qty: 1, price: 35.00 },
                { name: 'น้ำเปล่า', qty: 1, price: 10.00 }
            ]
        },
        { id: 'TX002', type: 'topup', date: '2024-05-10', time: '08:15', amount: 500.00, machine: 'Kiosk 01', balanceBefore: 795.75, balanceAfter: 1295.75 },
        {
            id: 'TX003', type: 'purchase', date: '2024-05-09', time: '12:45', amount: 35.00, machine: 'Beverage Vending', balanceBefore: 830.75, balanceAfter: 795.75, items: [
                { name: 'ชาเขียว', qty: 1, price: 20.00, addons: ['แก้วใหญ่'] },
                { name: 'ชานม', qty: 1, price: 15.00, addons: ['หวานน้อย', 'เพิ่มไข่มุก'] }
            ]
        },
        {
            id: 'TX004', type: 'purchase', date: '2024-05-08', time: '17:20', amount: 120.00, machine: 'Minimart', balanceBefore: 950.75, balanceAfter: 830.75, items: [
                { name: 'ขนมปัง', qty: 2, price: 25.00 },
                { name: 'นมกล่อง', qty: 3, price: 15.00 },
                { name: 'ไข่ไก่', qty: 1, price: 25.00 }
            ]
        },
        { id: 'TX005', type: 'topup', date: '2024-05-07', time: '09:00', amount: 1000.00, machine: 'HR Office', balanceBefore: -49.25, balanceAfter: 950.75 },
    ],
    '2': [
        {
            id: 'TX101', type: 'purchase', date: '2024-05-10', time: '12:00', amount: 80.00, machine: 'Canteen B', balanceBefore: 3500.00, balanceAfter: 3420.00, items: [
                { name: 'ผัดไทย', qty: 1, price: 45.00, addons: ['พิเศษ', 'ใส่ไข่'] },
                { name: 'ชาเย็น', qty: 1, price: 20.00, addons: ['แก้วใหญ่'] },
                { name: 'ชานม', qty: 1, price: 15.00, addons: ['หวานน้อย'] }
            ]
        },
        { id: 'TX102', type: 'topup', date: '2024-05-09', time: '09:30', amount: 2000.00, machine: 'Kiosk 03', balanceBefore: 1500.00, balanceAfter: 3500.00 },
        {
            id: 'TX103', type: 'purchase', date: '2024-05-09', time: '13:15', amount: 65.00, machine: 'Food Court', balanceBefore: 1565.00, balanceAfter: 1500.00, items: [
                { name: 'ก๋วยเตี๋ยว', qty: 1, price: 40.00, addons: ['พิเศษ', 'ใส่หมูกรอบ'] },
                { name: 'น้ำอัดลม', qty: 1, price: 25.00 }
            ]
        },
        {
            id: 'TX104', type: 'purchase', date: '2024-05-08', time: '15:45', amount: 150.00, machine: 'Pharmacy', balanceBefore: 1715.00, balanceAfter: 1565.00, items: [
                { name: 'ยาแก้ปวด', qty: 1, price: 50.00 },
                { name: 'พลาสเตอร์', qty: 2, price: 25.00 },
                { name: 'วิตามินซี', qty: 1, price: 50.00 }
            ]
        },
        { id: 'TX105', type: 'topup', date: '2024-05-08', time: '08:00', amount: 1000.00, machine: 'HR Office', balanceBefore: 715.00, balanceAfter: 1715.00 },
        {
            id: 'TX106', type: 'purchase', date: '2024-05-07', time: '12:30', amount: 55.00, machine: 'Canteen A', balanceBefore: 770.00, balanceAfter: 715.00, items: [
                { name: 'ข้าวมันไก่', qty: 1, price: 40.00 },
                { name: 'น้ำเปล่า', qty: 1, price: 15.00 }
            ]
        },
        {
            id: 'TX107', type: 'purchase', date: '2024-05-07', time: '08:10', amount: 30.00, machine: 'Coffee Kiosk', balanceBefore: 800.00, balanceAfter: 770.00, items: [
                { name: 'กาแฟร้อน', qty: 1, price: 30.00, addons: ['เอสเพรสโซ่ช็อต', 'ไม่ใส่น้ำตาล'] }
            ]
        },
        { id: 'TX108', type: 'topup', date: '2024-05-06', time: '10:00', amount: 500.00, machine: 'Kiosk 01', balanceBefore: 300.00, balanceAfter: 800.00 },
        {
            id: 'TX109', type: 'purchase', date: '2024-05-05', time: '17:00', amount: 200.00, machine: 'Minimart', balanceBefore: 500.00, balanceAfter: 300.00, items: [
                { name: 'สบู่', qty: 2, price: 35.00 },
                { name: 'แชมพู', qty: 1, price: 80.00 },
                { name: 'ยาสีฟัน', qty: 1, price: 50.00 }
            ]
        },
        { id: 'TX110', type: 'topup', date: '2024-05-04', time: '09:00', amount: 500.00, machine: 'Lobby Term', balanceBefore: 0, balanceAfter: 500.00 },
    ],
    '3': [
        { id: 'TX006', type: 'topup', date: '2024-05-10', time: '10:00', amount: 1000.00, machine: 'Test Term', balanceBefore: 0, balanceAfter: 1000.00 },
        {
            id: 'TX007', type: 'purchase', date: '2024-05-10', time: '10:05', amount: 500.00, machine: 'Test Term', balanceBefore: 1000.00, balanceAfter: 500.00, items: [
                { name: 'อุปกรณ์ทดสอบ', qty: 1, price: 500.00 }
            ]
        },
        {
            id: 'TX008', type: 'purchase', date: '2024-05-09', time: '15:30', amount: 50.00, machine: 'Coffee Kiosk', balanceBefore: 500.00, balanceAfter: 450.00, items: [
                { name: 'ลาเต้เย็น', qty: 1, price: 50.00 }
            ]
        },
        { id: 'TX009', type: 'topup', date: '2024-05-09', time: '09:00', amount: 200.00, machine: 'Lobby Term', balanceBefore: 250.00, balanceAfter: 450.00 },
        {
            id: 'TX010', type: 'purchase', date: '2024-05-08', time: '12:15', amount: 120.00, machine: 'Canteen B', balanceBefore: 370.00, balanceAfter: 250.00, items: [
                { name: 'ข้าวหมูแดง', qty: 1, price: 45.00 },
                { name: 'ส้มตำ', qty: 1, price: 35.00 },
                { name: 'น้ำมะนาว', qty: 2, price: 20.00 }
            ]
        },
        {
            id: 'TX011', type: 'purchase', date: '2024-05-08', time: '08:45', amount: 45.00, machine: 'Convenience Store', balanceBefore: 415.00, balanceAfter: 370.00, items: [
                { name: 'ดินสอ', qty: 3, price: 10.00 },
                { name: 'ยางลบ', qty: 1, price: 15.00 }
            ]
        },
        { id: 'TX012', type: 'topup', date: '2024-05-07', time: '18:00', amount: 500.00, machine: 'Kiosk 02', balanceBefore: -85.00, balanceAfter: 415.00 },
        {
            id: 'TX013', type: 'purchase', date: '2024-05-06', time: '13:00', amount: 65.00, machine: 'Food Court', balanceBefore: -20.00, balanceAfter: -85.00, items: [
                { name: 'ข้าวราดแกง', qty: 1, price: 40.00 },
                { name: 'ไข่ดาว', qty: 1, price: 10.00 },
                { name: 'น้ำเปล่า', qty: 1, price: 15.00 }
            ]
        }
    ],
    '4': [
        { id: 'TX201', type: 'topup', date: '2024-05-10', time: '09:00', amount: 5000.00, machine: 'Admin Panel', balanceBefore: 4999.00, balanceAfter: 9999.00 },
        {
            id: 'TX202', type: 'purchase', date: '2024-05-09', time: '14:00', amount: 1.00, machine: 'System Test', balanceBefore: 5000.00, balanceAfter: 4999.00, items: [
                { name: 'Test Item', qty: 1, price: 1.00 }
            ]
        },
        { id: 'TX203', type: 'topup', date: '2024-05-08', time: '08:00', amount: 5000.00, machine: 'Admin Panel', balanceBefore: 0, balanceAfter: 5000.00 },
    ]
};

export const mockApi = {
    async checkBalance(identifier: string): Promise<User | null> {
        await new Promise(resolve => setTimeout(resolve, 800)); // Simulate network lag
        // Try matching cardId in any of user's wallets or employeeId
        const user = Object.values(mockUsers).find(u =>
            u.employeeId === identifier ||
            u.wallets.some(w => w.cardId === identifier)
        );
        return user || null;
    },

    async getLatestTransactions(userId: string, limit = 10): Promise<Transaction[]> {
        await new Promise(resolve => setTimeout(resolve, 500));
        return (mockTransactions[userId] || []).slice(0, limit);
    },

    async getReceipt(transactionId: string): Promise<Transaction | null> {
        await new Promise(resolve => setTimeout(resolve, 300));
        for (const userId in mockTransactions) {
            const tx = mockTransactions[userId].find(t => t.id === transactionId);
            if (tx) return tx;
        }
        return null;
    }
};
