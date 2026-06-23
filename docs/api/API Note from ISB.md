# API Note from ISB

ISB will push Staff, Family, and Department master data to your API as sequential JSON batches\.

- One batch per HTTP request

- Requests are sent serially

- ISB owns the request\-body contract

- Please implement endpoints that accept exactly these request bodies

**Required Endpoints**

- `POST /v1/sync/staffs`

- `POST /v1/sync/families`

- `POST /v1/sync/departments`



Below is additional information\. If you would like me to modify anything, please let me know\.

1. **Authentication**

2. ISB will send the API key in the `x-api-key` HTTP request header\.

3. Please confirm that your endpoints will require and validate this header, and please provide the API key provisioning process\.

4. **Response Schema and Success Condition**

5. Our client currently treats a batch as successful only when:

    - HTTP status is `200`

    - Response body has `status == "SUCCESS"`

6. Current expected response:

```Plain Text
{
  "status": "SUCCESS",
  "code": "200",
  "message": "Accepted"
}
```

1. Anything else will be treated as failed and retried\.

2. Please confirm this response contract, or provide your actual response schema and success rule\.

3. **Idempotency / Upsert by ****`customerId`**

4. Re\-sending the same `customerId` must update the existing record, not create a duplicate\.

5. In case of conflict, the latest record received should be treated as the source of truth\.

6. Please confirm that your implementation supports idempotent upsert keyed by `customerId`\.

7. **Staff Who Is Also a Parent**

8. A person who is both Staff and Parent may be sent to both endpoints with the same `customerId`:

    - `/v1/sync/staffs`

    - `/v1/sync/families`

9. Please apply the same last\-write\-wins rule\.

10. Shared fields such as `profileImage` and `smartCard` are expected to contain identical data across both endpoints, so there should be no real conflict\.

11. **Batch Size and Rate Limits**

12. ISB currently sends 500 records per batch\.

13. **Department Endpoint**

14. We added a new `customerType`: `"Department"` for POS expense tracking against a department, for example:

    - `departmentId`: `520`

    - `departmentDescription`: `"ED-TECH"`

15. Department charges are made against the department, not an individual card\.

16. Notes:

    - A Department record does not carry `smartCard` today

    - A Department `smartCard` may be introduced later, but it is not currently in use and will not be sent now

    - Please design the Department schema so `smartCard` can be added later as an optional field without causing a breaking change



**Notes**

No action is required on these items, but please follow them when implementing the API:

- All IDs such as `customerId`, `familyCode`, and `departmentId` are JSON integers

- Staff `login` is an object: `{ loginId, email }`

- Family parent `login` is a string

- The Staff and Family login formats are intentionally different; please do not normalize them

- `secondaryParent` is `null` for single\-parent families, and the key is always present

- For a person with no card, `smartCard.cardNumber` is sent as an empty string `""`

- The `smartCard` object is never omitted

