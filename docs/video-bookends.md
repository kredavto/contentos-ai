# Intro and outro from the media library

Video creation optionally accepts `bookends.intro` and/or `bookends.outro`. Each selection contains an internal library `assetId`, integer `sourceStartMs`, integer `durationMs` (100–30,000 ms) and explicit `approved: true`. Empty selections, unknown fields, unconfirmed clips and excerpts beyond the source are rejected. Both controls default to disabled; changing a file or excerpt clears its confirmation.

Only READY, normalized MP4 files from the authenticated tenant and selected brand can be used. The additive `0053_redundant_gorgon.sql` migration creates `video_bookends`, with one row per project/slot, composite tenant foreign keys, approval and timing checks. Public project details contain identifiers/timing, never storage keys. The request identity includes the selections; the same idempotency key cannot silently select different clips. Existing requests without bookends retain their identity and reservation calculation.

## Timeline and sound

The final sequence is intro → main video → outro; either end can be omitted. Each clip uses the selected crop/contain mode, output dimensions, square pixels, H.264/yuv420p and 30 fps. There are hard cuts, not transitions. Timing is resolved to video frames during encoding.

Caption editing, B-roll timing, the watermark and background music remain relative to the main video. The worker composes the main video first and then concatenates the clips. This preserves caption/B-roll placement without modifying their stored timing or the original avatar render. Music loops only within the main part. Bookends keep their own normalized audio; a clip without audio receives stereo silence so that it cannot shift the main audio. Watermarks/captions are not added to bookends. Cover selection uses the complete final timeline, including intro/outro; the default first frame therefore comes from intro when present.

Each library input is capped at 64 MiB and inspected with a forced MOV demuxer; external references and network input protocols are disabled. Trim bounds are checked against the actual video stream. The main input and final file remain capped at 256 MiB and the full result at 180 seconds. FFmpeg uses private temporary files, bounded commands and cleanup in `finally`; no browser-controlled paths or filter expressions are accepted. QC verifies final codecs, dimensions and the combined duration, with the existing 0.3-second mux/frame tolerance. Output exceeding the reservation fails rather than being silently shortened to fit it.

## Reservation and lifecycle

Before creating the job, planned script duration plus selected bookend duration must fit the configured video maximum. The reservation is `min(maximum, max(15, plannedSeconds × 2) + ceil(bookendMilliseconds / 1000))`. This retains the existing main-video allowance where the maximum permits it. The UI displays this same total. The actual avatar render can still exceed the available allowance: the worker checks its duration plus the selected clips before encoding and checks the encoded result again. Success captures the rounded-up duration of the whole final video once; unused reserved seconds are released. Final failure releases the held reservation.

Current membership, consent, script approval and source readiness are rechecked before remote submission, during processing and in the final capture transaction under the tenant lock. Deleting a source before completion blocks pending work, including a deletion after source read or final storage write. Caption review and local retries retain both selections; local retries do not resubmit the avatar request. Completed video files are independent of their source clips and remain downloadable after source deletion, subject to the existing consent/access rules. Video deletion removes its bookend rows during durable cleanup.

Multiple intro/outro clips per side, transitions, separate bookend volume/mute controls, generated branded templates, advanced audio editing and live production acceptance remain outside this slice.
