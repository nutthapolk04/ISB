import { describe, expect, test } from 'bun:test';
import { __test__ } from '../src/lib/kioskAuditLog';

describe('UNLOCK audit line', () => {
    test('includes unsuccessful_transaction flag', () => {
        const line = __test__.buildAuditLine('UNLOCK', {
            ref: 'ref-123',
            method: 'CASH',
            payer_id: 'P001',
            receiver_id: 'R001',
            actual_amount: 500,
            unsuccessful_transaction: true,
        });
        expect(line).toContain('[UNLOCK]');
        expect(line).toContain('unsuccessful_transaction=true');
        expect(line).toContain('ref=ref-123');
        expect(line).toContain('actual_amount=500');
    });
});
