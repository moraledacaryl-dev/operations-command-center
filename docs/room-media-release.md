# Room media + sidebar readability release

- Owner can upload, replace, or reset one photo per room/area from the room detail page.
- Room cards and room detail use the assigned photo when configured and fall back to the global Default Room Placeholder otherwise.
- Public room-media metadata does not expose original filenames; mutation remains Owner-only.
- Sidebar text is enlarged without widening the compact mockup shell.
- Database migration: `0010_room_media`.
