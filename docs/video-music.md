# Background music from the private media library

Video Studio can optionally select one READY audio asset from the same brand's library and set its level to an integer 1–30% (UI default 15%). The default is no music. Upload MP3 or WAV in Media first; the library produces the private, normalized stereo 48 kHz MP3 used by the worker. Video assets, unfinished uploads, deleted records and another brand's or tenant's media are rejected. Existing ready media remains reusable when new library uploads are disabled.

## Persistence and authorization

The video request accepts optional `backgroundMusic: {assetId, volumePercent}`. It participates in the existing actor-bound idempotency hash. Migration 0051 creates `video_music` with a UUID primary key, one selection per tenant/project, composite tenant foreign keys to the video and library asset, and a 1–30 volume constraint. Existing projects have no selection. Selection is fixed for a render; changes require a new video request. Caption edits/confirmation, retry and recovery preserve it. The video list returns only the internal asset ID and volume, never storage keys or external URLs.

Creation checks the current writer, brand, media state/type and supported storage provider under the tenant lock before reserving video seconds. Execution checks current membership, approved script and subject-scoped consent as before, plus source readiness before provider submission, before media reads, before final storage writes and during completion. The source is fetched through the storage provider with its exact bounded declared size. There are no browser-to-provider calls or arbitrary URL/path imports.

Deleting a music source blocks pending renders, including a task paused for caption review. A deletion racing with a storage read/write cannot make the project READY or capture its video reservation; terminal failure releases the reserve. A task already waiting for caption review remains blocked until its video is deleted to release its reservation; deletion is available to writers. Existing uncertainty/reconciliation handling still applies to a remote submission of unknown outcome. Deletion of the source does not alter completed videos: they contain the mixed audio in their own final object. This is media lifecycle behavior, not an additional consent grant. Avatar/voice consent continues to apply to the completed video. Deleting the video removes its music selection during normal cleanup.

## Rendering

The adapter accepts only bytes and a validated level. It verifies a bounded MP3 header and probes a single stereo 48 kHz MP3 audio stream of at most 180.5 seconds. Generated private filenames, a forced MP3 demuxer, restricted protocols, minimal subprocess environment, bounded output and timeouts apply; temporary files are always removed.

FFmpeg loops short music, trims it to the original video duration and normalizes voice/music separately. The selected level scales the normalized music before mixing; a peak limiter protects the combined output. It is a relative mixing level, not a promise of exact perceived loudness for all tracks. Voice is retained, captions still refer to the unchanged original timeline, and quality control checks the final duration/codecs/dimensions as before. No extra generation credits or seconds are charged for music; the existing actual-duration video charge applies.

Filter behavior was checked against the [official FFmpeg filter documentation](https://www.ffmpeg.org/ffmpeg-filters.html#amix) and real FFmpeg tests. The tests measure both tone frequencies after several music loops and compare the selected levels, rather than treating a successful process exit as proof of mixing.

## Remaining scope

One music track from the start of the main video only. Timeline offsets, automatic ducking and multiple tracks remain separate future slices. Independent optional fades are implemented below. Optional [intro/outro](video-bookends.md) retain their own audio; the music bed does not extend into them. Up to five USER_MEDIA B-roll inserts are supported; see [B-roll](video-broll.md). There is no music catalogue or stock licence procurement. Live cloud storage/provider verification and production deployment remain outstanding.

## Optional music fades (2026-10-14)

`backgroundMusic` also accepts independent optional `fadeInMs` and `fadeOutMs`, each an integer from 100 to 5,000 ms. Omit an edge for no fade; API zero is rejected. The UI uses seconds, with zero meaning omission, and defaults both controls to zero. Clearing a control or entering an out-of-range value blocks submission. The sum must fit the main-video duration; creation checks the reservation excluding bookends, and rendering checks the actual main duration. An unexpectedly shorter provider result fails without capturing video seconds rather than silently shortening the fades.

Additive migration 0056 stores both edges with default zero and per-edge SQL bounds. Old requests retain their original shape and idempotency identity; public responses omit disabled edges. Changes participate in request idempotency, and selected fades survive caption review, local retry and source lifecycle checks. Deploy matching web and worker versions so older workers cannot silently ignore the settings.

FFmpeg applies linear `afade` to the looped, trimmed, normalized music after its volume adjustment and before mixing it with voice. Fade-in starts at main time zero, and fade-out ends at the main duration. Bookends are concatenated afterwards, so neither transition extends into them. The voice is not faded. There is no added duration or additional video charge. Installed FFmpeg filter help was checked; real audio tests measure separate voice/music tones during entry, middle and exit for either edge alone and both together, including bookends.
