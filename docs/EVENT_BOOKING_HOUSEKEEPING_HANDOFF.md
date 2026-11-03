# Event preparation + Housekeeping clearance (release contract)

## Cross-app ownership

- **Accounting** owns booking inquiries, quotations, confirmation, date, contact details, payments, receivables, and any room-stay/venue financial arrangement.
- **Operations** owns the event preparation project, department tasks, notifications/review items, and cleaning checklists. It receives only an internal booking reference, confirmed date, whitelisted venue and service-category flags. It does not receive guest identity, contact information, money, quote descriptions, or payment details.
- **Beds24/PMS** owns room occupancy. The Housekeeping board does **not** query Beds24, automatically detect a checkout, or update sellable inventory.

## Event booking message contract

Accounting emits versioned, durable `accounting_program` events on its existing Operations outbox:

- `event.booking.confirmed`: one stable event ID per Accounting booking, creates one linked Operations project **atomically** with the integration inbox/review and a standard task list.
- `event.booking.changed`, `event.booking.cancelled`, `event.booking.completed`: a new immutable event ID per change, creating an Operations review item. Do **not** silently change project deadlines or erase employee tasks. Owner/lead reviews the booking in Accounting and updates the work as necessary.
- Subject: `{ "type": "event_booking", "id": "<accounting numeric booking ID>" }`.
- Payload: `booking_id`, `event_no`, `event_date`, `venue`, `services`, `guest_count`, and `status`.
- Strict event receiver validation, source-scoped credential, identity matching, two unique database constraints, and idempotent replay.

On confirmation, Operations creates one Project (Front Desk department, fallback Management) named `Event preparation · <event_no>` and assigns initially unassigned Tasks to Front Desk, Housekeeping, Maintenance, Kitchen, and Café as applicable. Employees or managers assign people and mark work through existing Operations workflows. Design/decor is included when an add-on or a design-related quoted item is detected; the description itself never leaves Accounting.

### Event booking example

1. In **Accounting → Events**, enter an event (Function Hall, confirmed date, quote lines such as Venue, Food, Decoration Add-on), save as Draft/Quoted.
2. Confirm in Accounting (or collect a payment, which already confirms). The financial source records the receivable and journals as normal, and queues an Operations event in the same business transaction.
3. The existing outbox worker securely retries the message. Operations receives it, creates the linked preparation project and tasks, and keeps an integration review record.
4. Staff see tasks in their department's Operations queue; managers may inspect the source reference and assign owners.
5. Changes/cancellations show in Operations Review. The event owner checks the updated Accounting booking and adjusts tasks or projects manually, avoiding dangerous silent scheduling and duplicate work.

## Housekeeping board

`/housekeeping` provides a daily room-by-room overview and an explicit checklist:

1. Front Desk or a manager **schedules cleaning** for an existing room and date.
2. Front Desk checks the actual PMS/guest checkout, then manually confirms **Room vacated**. Until then, **Start cleaning is blocked**.
3. Housekeeping begins cleaning; only the employee who started may tick the ten required checklist items.
4. Employee submits **For inspection** only after all items are checked.
5. A different Housekeeping lead or manager inspects. They may mark **Cleared** or return the room for cleaning with a reason. Returns reset the checklist for a fresh attempt.

No room/PMS occupancy or room inventory status is changed when cleaning is cleared. Other departments cannot read the Housekeeping board; Front Desk can read and confirm vacancy but cannot tick cleaning steps unless they also belong to Housekeeping.

**Limit:** The board is manually sourced until a separate reviewed Beds24/Accounting mapping proves exact room identities, checkout semantics, same-date reservations and date/time changes. Do **not** use a calendar date by itself as proof that a guest has left.

## Safe release sequence

1. Keep changes in draft PRs; merge and deploy neither without owner approval.
2. Run the Operations migration `0012_event_turnover` and its backend/authorization + browser tests first, with verified backups. Validate Operations receiver integration keys and read-only visibility.
3. Deploy Operations receiver **before** enabling Accounting booking event production messages. Otherwise the sender can reach a receiver that rejects this new event type; never replay without inspecting the outbox state.
4. Roll out Accounting producer with its event-accounting regression and privacy tests, preserving all existing receivables, journals, deposits, and booking records.
5. Test a fictional booking and the two Operations applications end-to-end in a protected staging environment. Verify exactly one project despite replay, correct tasks, and no private guest/money payload. Test cancellation/change review.
6. Test Housekeeping with two staff members and a supervisor on a phone; ensure occupancy remains untouched.

The new workflow intentionally does not create or modify real bookings, payroll rosters, staff shifts, supplier purchases or POS orders.

## Accounting room updates

The new room connection is described in [ACCOUNTING_ROOM_CONNECTION.md](ACCOUNTING_ROOM_CONNECTION.md). It adds automatic requests from mapped checkout dates, ordered status updates, combined-room support and a rollout cutoff. Existing staff cleaning and inspection work is preserved.
