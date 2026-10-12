# Optional video watermarks

Watermarks are disabled by default. Before requesting a video, a writer may enable a single-line text mark (up to 40 characters), choose one of four corners and set opacity from 20% to 100%. White text with a dark outline scales to the frame and text length; the upper corners are recommended when subtitles are enabled. This is a text watermark; uploaded logo overlays are not implemented.

The strict API schema rejects control/format characters, extra fields, unsupported positions and invalid opacity. The normalized option is included in the existing actor-bound request hash and stored with immutable video intent. Reusing a request key with another mark is a conflict. Caption confirmation retains the option. Existing projects and requests without the option receive no application watermark.

The worker burns the mark across the final video using the existing FFmpeg/libass dependency, after caption rendering. Literal text is written to a private local ASS file, with override syntax neutralized; it never enters a shell or filter expression. No external image URL or user file path is accepted. The original provider render is retained separately and is not modified. The feature does not remove any watermark already present in the provider source. Frame-based covers inherit the mark from final video; solid-color cover designs do not. Deletion scrubs watermark text with the rest of the processing options.

No extra external provider request or credit policy is introduced. Current render duration, resource, permissions, consent, approval and deletion rules still apply. Changing an already rendered video's mark is not supported by this control; it is chosen for a new video. B-roll, background music and intro/outro remain separate unfinished post-processing requirements.

Implementation uses the official [FFmpeg ass filter](https://ffmpeg.org/ffmpeg-filters.html#ass). Verification covers actual decoded frame pixels in all four corners, unsafe inputs, preserved source bytes, idempotency, caption confirmation and deletion. Browser and full regression results are recorded in [implementation status](IMPLEMENTATION_STATUS.md).
