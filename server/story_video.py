"""Prepare and pace the Windows projector movie with the packaged FFmpeg."""
from pathlib import Path
import queue
import subprocess
import tempfile
import threading


class StoryVideo:
    def __init__(self, path):
        self.path = path
        self.frames = queue.Queue(maxsize=4)
        self.stop = threading.Event()
        self.directory = tempfile.TemporaryDirectory(prefix="minin-story-")
        self.audio = Path(self.directory.name) / "story.wav"
        self.info = None
        self.eof = False
        self.error = None
        self.thread = threading.Thread(target=self.decode, daemon=True)
        self.thread.start()

    def decode(self):
        import imageio_ffmpeg
        try:
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", str(self.path),
                            "-vn", "-c:a", "pcm_s16le", str(self.audio)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True, timeout=15,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            decoder = imageio_ffmpeg.read_frames(str(self.path), pix_fmt="rgb24")
            try:
                info = next(decoder)
                frames = 0
                for index, frame in enumerate(decoder):
                    while not self.stop.is_set():
                        try:
                            self.frames.put((index, frame), timeout=.1)
                            break
                        except queue.Full:
                            continue
                    if self.stop.is_set():
                        return
                    self.info = info
                    frames = index + 1
                if not frames or frames / info["fps"] < info["duration"] - .25:
                    raise ValueError("The story video ended before its expected duration")
                self.eof = True
            finally:
                decoder.close()
        except Exception as exc:
            self.error = exc

    def close(self):
        self.stop.set()
        self.thread.join(timeout=.3)
        if self.thread.is_alive():
            # Reclaim the temporary WAV once FFmpeg has released it.
            def cleanup():
                self.thread.join()
                self.directory.cleanup()
            threading.Thread(target=cleanup, daemon=True).start()
        else:
            self.directory.cleanup()
