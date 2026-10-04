# Video post-processing

`FFmpegVideoProcessor` is a worker-only implementation of `VideoProcessingProvider`. It accepts MP4 bytes and validated rendering options, never browser-controlled paths, URLs, executable names or filter expressions. The job orchestration/storage integration is still pending.

Implemented: 9:16, 1:1 and 16:9 at 720p/1080p; crop or contain with padding; square pixels; 30 fps; H.264/yuv420p and stereo AAC; EBU R128 loudness filtering; fast-start MP4; metadata removal; optional Unicode ASS captions in clean/bold styles; separate JPEG cover frame. No default watermark. Caption segments must be ordered and non-overlapping, fit the actual duration and contain at most 500 characters each. User text cannot inject ASS override commands or filter options.

Input is limited to 256 MiB, 180 seconds, one video and one audio stream, bounded dimensions and stream count. FFprobe validates the real container and tracks. Both tools are forced to the MOV/MP4 demuxer; network protocols and external MOV track references are disabled. Commands use argument arrays without a shell, a restricted environment without application secrets, bounded captured output, timeouts, cancellation and a small thread count. Private temporary files/directories are removed after success or failure. Output is probed again for expected codecs/dimensions and preservation of duration; oversized/truncated output fails quality control.

FFmpeg is native code and must run in the dedicated worker container with OS-level memory/CPU/disk limits, non-root identity and restricted egress. The process limits here complement that deployment isolation; they do not replace it. Production release images must pin a maintained distribution package/version and retain required license notices.

Local development binaries: `/tmp/contentos-ffmpeg/ffmpeg` and `/tmp/contentos-ffmpeg/ffprobe`, version 9.0.2 from the macOS distributor linked by ffmpeg.org. Tests use `FFMPEG_PATH` and `FFPROBE_PATH`; CI defaults to `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` and must install them before running tests.

Still pending: durable video projects/transitions, original/final object storage, generation and editing of captions in the UI, background music, intro/outro, B-roll, optional watermark, editable cover design and full video approval/publishing. A standalone processor test is not proof that the Video Factory user journey is finished.

References: https://ffmpeg.org/ffmpeg.html, https://ffmpeg.org/ffprobe.html, https://ffmpeg.org/ffmpeg-filters.html. Installed binary help (`-h filter=scale`, `-h filter=loudnorm`, `-h demuxer=mov`) was checked against the actual executable.
