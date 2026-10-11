# Video cover design at creation

The Video Studio can optionally attach a cover design to a new video request: relative frame position, editable headline (80 characters), frame plus colored panel or a solid background, three font presets, top/center/bottom layout, text and background hex colors. Default remains the legacy first-frame thumbnail. This is the first cover-design slice, not the complete standalone Cover Studio.

The validated design is stored in the existing video options JSON and included in request idempotency. Caption editing retains it. The worker renders the selected frame of the completed video using FFmpeg/libass, at the video's resolution, into the existing private cover object. Headline text is literal ASS data with override characters neutralized; the filtergraph receives only validated colors and server-computed values. There are no user-controlled paths, remote URLs or font files. Worker time/output/memory/thread bounds and temporary-directory cleanup apply. Docker already supplies DejaVu fonts; local font fallback can differ.

Position is a percentage of duration (0–95), clamped away from the end; the UI offers five positions because the provider video does not yet exist when the request is created. The frame includes burned-in captions. A solid background hides the frame. Long headlines wrap automatically; no AI headline request or paid image generation is made. Video output and billing duration are unaffected. Failure follows existing video processing retry/reconciliation; it never reports a completed cover when rendering fails.

Access, approval, signed URL expiry and deletion follow the existing video lifecycle and consent checks. Deletion also removes the saved headline/design. Covers are not automatically uploaded as social-platform custom thumbnails; the current publishing adapters retain their existing behavior.

Still required for full Cover Studio: browsing actual frames of an already generated video, independent versioned cover rendering/editing with a durable job, preview and selection of versions, and approval invalidation/publishing snapshot rules. Image-upload backgrounds and AI headline suggestions are also not implemented here.

References checked 2026-10-12: [FFmpeg ASS filter](https://ffmpeg.org/ffmpeg-filters.html#ass), [drawbox](https://ffmpeg.org/ffmpeg-filters.html#drawbox). Uses filename-based ASS compatible with the packaged worker; does not require newer inline-script options.
