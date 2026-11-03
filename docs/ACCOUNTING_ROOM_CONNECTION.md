# Accounting room updates and event preparation

Accounting sends confirmed event bookings to Operations through its existing
authenticated, retryable outbox. Operations creates one preparation project and
department tasks. Later event changes and cancellation notices need staff review.

Beds24 continues to sync into Accounting. Accounting sends only local booking ID,
local room ID, arrival/departure dates, booking status, origin, and outbox revision
to Operations as `room.booking.updated`. It never sends guest names, contacts,
prices, deposits, payment details, or notes in this message.

Operations uses `ACCOUNTING_ROOM_MAP_JSON` to map Accounting room IDs to physical
Operations rooms. Values may be an integer or a list of integers, so a combined
Perch 2 + Crown reservation can schedule both rooms. Room names are verified at
setup; incoming free text never chooses or creates a room. Unmapped rooms create
a review item and no cleaning request. Inspect the source before correcting a map.

Set `ACCOUNTING_HOUSEKEEPING_START_DATE=YYYY-MM-DD` to the rollout date. Checkout
dates on or after that date create cleaning requests for confirmed, checked-in or
checked-out bookings. A scheduled checkout is not proof that the guest has left.
The board shows the reported state, source, and last-received time. Front Desk
confirms the room is empty on the cleaning date, the cleaner completes the
checklist, and a different authorized supervisor inspects it. No action changes
Beds24 occupancy or sellable inventory.

Unchanged snapshots do not enqueue again. New snapshots use increasing durable
outbox IDs; old retries cannot replace newer states. Cancellations, no-shows and
date/room changes withdraw only untouched automatic requests. Records already
confirmed or worked by staff remain for review. Historic imports before rollout
do not create old cleaning work. Source and local room IDs remain different.

Release Operations migration `0013_accounting_rooms` and receiver first, then the
Accounting sender. Preserve database/uploads backups and the previous release.
Check source credentials match without printing them. From the new Accounting
backend, run `PYTHONPATH=. python scripts/queue_operations_handoffs.py` to preview
counts, then `--apply` to queue current/future existing bookings and confirmed
events. This changes only outbox rows. Inspect delivered/pending/dead counts and
the linked Operations records. Do not reset existing queues or replay old dead
letters as part of release.

Training stays isolated. Its fictional bookings can exercise the same receiver;
never configure it with production credentials or import live booking records.
