"""Windows host: native fullscreen portrait, audio output and rotating phone QR."""
import base64
from collections import deque
import io
import json
import os
from pathlib import Path
import queue
import sys
import threading
import time
from urllib.request import Request, build_opener, ProxyHandler
import wave
import webbrowser

from .avatar_motion import Motion, mesh

ROOT = Path(__file__).resolve().parents[1]


def projection_layout(width, height, aspect):
    """A large centered cutout and a quiet, scanable QR outside its silhouette."""
    margin = max(18, round(min(width, height)*.025))
    qr = max(132, min(220, round(min(width, height)*.22)))
    actor_h = int(height*.97)
    actor_w = int(actor_h*aspect)
    return {"actor_size": (actor_w, actor_h), "actor_center": (width*.5, height*.505),
            "qr_size": qr, "qr_center": (width-margin-qr/2, height-margin-qr/2)}


def wav_bytes(pcm, sample_rate=22050):
    if sample_rate != 22050 or not pcm or len(pcm) % 2 or len(pcm) > 22050*2*120:
        raise ValueError("Invalid projector audio")
    target = io.BytesIO()
    with wave.open(target, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return target.getvalue()


def pose_at(track, elapsed):
    for start, end, pose in track.get("cues", []):
        if start <= elapsed < end:
            return pose
    return "rest"


class Host:
    def __init__(self, api):
        self.api = api
        self.key = os.environ["STATION_KEY"]
        self.http = build_opener(ProxyHandler({}))
        self.inbox = queue.Queue()
        self.acks = queue.Queue()
        self.stop = threading.Event()
        self.seen = set()
        self.states = {}
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self.poll, daemon=True)

    def post(self, path, data):
        request = Request(self.api.bridge_url+path, data=json.dumps(data).encode(), headers={
            "Content-Type": "application/json", "Authorization": "Bearer "+self.key})
        with self.http.open(request, timeout=5) as response:
            raw = response.read(12*1024*1024+1)
            if len(raw) > 12*1024*1024:
                raise ValueError("Station response too large")
            return json.loads(raw)

    def state(self, key, value):
        with self.lock:
            self.states[key] = value
        self.acks.put((key, value))

    def poll(self):
        pending = deque()
        while not self.stop.is_set():
            try:
                while not self.acks.empty():
                    pending.append(self.acks.get_nowait())
                while pending:
                    key, state = pending[0]
                    try:
                        self.post("/station/jobs/"+key, {"state": state})
                    except Exception as exc:
                        # A server-expired job must not block every future acknowledgement.
                        if getattr(exc, "code", 0) in (404, 409):
                            pending.popleft()
                            continue
                        raise
                    pending.popleft()
                data = self.post("/station/poll", {"ready": True})
                self.inbox.put(("qr", (data["url"], data["expires_at"])))
                job = data.get("job")
                if job and job["id"] not in self.seen:
                    self.seen.add(job["id"])
                    self.state(job["id"], "prepared")
                    self.inbox.put(("play", job))
            except Exception as exc:
                self.inbox.put(("error", "Нет связи с сервером: "+type(exc).__name__))
            self.stop.wait(.4)


class Projector:
    def __init__(self, host):
        import tkinter as tk
        from PIL import Image, ImageTk
        self.tk, self.Image, self.ImageTk = tk, Image, ImageTk
        self.host = host
        self.guide = os.getenv("POPOV_GUIDE", "popov")
        self.guide_name = "Минин" if self.guide == "minin" else "Попов"
        self.root = tk.Tk()
        self.root.title(self.guide_name+" · Проекция")
        self.root.configure(bg="black")
        screen_w, screen_h = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        self.root.geometry(f"{max(480, screen_w//2)}x{max(550, screen_h-85)}+0+0")
        self.root.minsize(450, 500)
        self.root.bind("<F11>", self.fullscreen)
        self.root.bind("<Escape>", lambda e: self.root.attributes("-fullscreen", False))
        self.root.bind("<F2>", lambda e: self.open_controls())
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.canvas = tk.Canvas(self.root, bg="black", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        names = ("rest", "open", "soft", "round", "wide", "teeth", "hush", "reduced", "blink", "brow")
        folder = ROOT/"Ресурсы"
        if self.guide == "minin":
            folder /= "Персонажи/minin"
        originals = {name: Image.open(folder/(name+".png")).convert("RGBA") for name in names}
        bounds = originals["rest"].getbbox()
        self.images = {name: img.crop(bounds) for name, img in originals.items()}
        band = (.06, .10) if self.guide == "minin" else (.065, .13)
        self.eye_band = tuple((originals["rest"].height*y-bounds[1])/self.images["rest"].height for y in band)
        self.motion = Motion()
        self.motion_clock = time.perf_counter()
        self.cached = {}
        self.current_size = None
        self.current_pose = None
        self.actor = self.canvas.create_image(0, 0)
        self.qr_item = self.canvas.create_image(0, 0)
        self.qr_url, self.qr_until, self.qr_image = "", 0, None
        self.track, self.began, self.current = None, 0, None
        self.story = None
        self.status = "Запускается сервер…"
        self.closing = False
        self.controls = None
        self.host.thread.start()
        self.open_controls()
        self.root.after(20, self.frame)

    def fullscreen(self, event=None):
        self.root.attributes("-fullscreen", not self.root.attributes("-fullscreen"))

    def open_chat(self):
        if self.qr_url and time.time() < self.qr_until:
            webbrowser.open(self.qr_url, new=1)
        else:
            self.status = "Ожидаем свежий QR — повторите через секунду"

    def open_controls(self):
        if self.controls and self.controls.winfo_exists():
            self.controls.lift()
            return
        tk = self.tk
        self.controls = tk.Toplevel(self.root)
        self.controls.title(self.guide_name+" · Тестирование")
        self.controls.configure(bg="#e8f2ff")
        self.controls.geometry("380x280+40+50")
        tk.Label(self.controls, text="Тестирование проекции", bg="#e8f2ff", fg="#163b63", font=("Segoe UI", 16, "bold")).pack(pady=(24,12))
        self.control_status = tk.StringVar(value=self.status)
        tk.Label(self.controls, textvariable=self.control_status, bg="#e8f2ff", fg="#284c70", wraplength=330).pack(pady=4)
        tk.Button(self.controls, text="Открыть разговор в браузере", command=self.open_chat, bg="#1164bd", fg="white", relief="flat", padx=18, pady=10).pack(pady=10)
        tk.Button(self.controls, text="Полный экран / окно", command=self.fullscreen, bg="#d3e6ff", fg="#163b63", relief="flat", padx=18, pady=8).pack()
        tk.Label(self.controls, text="F2 — это окно · F11 — полный экран\nEsc — вернуться к окну", bg="#e8f2ff", fg="#284c70").pack(pady=12)

    def show_qr(self, url, until):
        if url != self.qr_url:
            import qrcode
            code = qrcode.QRCode(box_size=5, border=4)
            code.add_data(url); code.make(fit=True)
            self.qr_image = code.make_image(fill_color="black", back_color="white").convert("RGB")
            self.qr_url = url
            self.qr_photo = None
        self.qr_until = until

    def play(self, job):
        key = job["id"]
        if self.current is not None or job["expiry"] <= time.time():
            self.host.state(key, "failed")
            return
        if "story" in job:
            path = ROOT/"Ресурсы/Рассказы/minin.mp4"
            if job["story"] != self.guide or self.guide != "minin" or not path.is_file():
                self.host.state(key, "failed")
                return
            from .story_video import StoryVideo
            try:
                self.story = StoryVideo(path)
            except OSError:
                self.host.state(key, "failed")
                return
            self.current = key
            self.story_requested, self.began = time.perf_counter(), 0
            self.story_next = self.story_image = None
            self.status = "Готовим показ…"
            return
        try:
            audio = wav_bytes(base64.b64decode(job["pcm"], validate=True), job.get("sample_rate"))
        except Exception:
            self.host.state(key, "failed")
            return
        self.current = key
        self.track = job["track"]
        self.began = time.perf_counter()
        self.status = self.guide_name+" говорит"
        def sound():
            import winsound
            try:
                # Synchronous WinMM playback keeps the WAV bytes alive until audio ends.
                self.host.state(key, "started")
                winsound.PlaySound(audio, winsound.SND_MEMORY | winsound.SND_NODEFAULT)
                state = "finished" if not self.closing else "cancelled"
            except Exception:
                state = "failed"
            self.host.inbox.put(("ended", (key, state)))
        threading.Thread(target=sound, daemon=True).start()

    def end_story(self, state):
        import winsound
        winsound.PlaySound(None, 0)
        self.story.close()
        self.story = self.story_next = self.story_image = None
        self.host.state(self.current, state)
        self.current = None
        self.status = "Готов к разговору" if state == "finished" else "Не удалось воспроизвести историю"

    def story_frame(self, now, width, height):
        """Return the video frame or the avatar opacity for either transition."""
        story = self.story
        if story.error or now-self.story_requested > 85:
            self.end_story("failed")
            return None, 1.
        if not story.info:
            return None, 1.
        if not self.began:
            import winsound
            try:
                winsound.PlaySound(str(story.audio), winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT)
            except RuntimeError:
                self.end_story("failed")
                return None, 1.
            self.began = now
            self.host.state(self.current, "started")
            self.status = "История Минина"
        elapsed = now-self.began
        duration = story.info["duration"]
        if elapsed >= duration and story.eof:
            self.end_story("finished")
            return None, 1.
        target = int(elapsed*story.info["fps"])
        while True:
            if self.story_next is None:
                try:
                    self.story_next = story.frames.get_nowait()
                except queue.Empty:
                    break
            index, data = self.story_next
            if index > target:
                break
            self.story_image = data
            self.story_next = None
        if elapsed < .20:
            return None, max(0., 1-elapsed/.20)
        if elapsed > duration-.25:
            return None, min(1., (elapsed-duration+.25)/.25)
        if self.story_image is None:
            return None, 0.
        image = self.Image.frombytes("RGB", story.info["size"], self.story_image)
        scale = min(width/image.width, height/image.height)
        image = image.resize((round(image.width*scale), round(image.height*scale)), self.Image.Resampling.BILINEAR)
        return image, 0.

    def frame(self):
        if self.closing:
            return
        frame_started = time.perf_counter()
        for _ in range(30):
            try:
                kind, data = self.host.inbox.get_nowait()
            except queue.Empty:
                break
            if kind == "qr":
                self.show_qr(*data)
                if not self.current:
                    self.status = "Готов к разговору"
            elif kind == "play":
                self.play(data)
            elif kind == "ended":
                key, state = data
                if key == self.current:
                    self.current = self.track = None
                    self.host.state(key, state)
                    self.status = "Готов к разговору"
            elif kind == "error":
                self.status = data
        width, height = max(420, self.canvas.winfo_width()), max(440, self.canvas.winfo_height())
        if self.story:
            movie, opacity = self.story_frame(frame_started, width, height)
            if movie is not None:
                self.actor_photo = self.ImageTk.PhotoImage(movie)
                self.canvas.itemconfigure(self.actor, image=self.actor_photo)
                self.canvas.coords(self.actor, width/2, height/2)
                self.canvas.itemconfigure(self.qr_item, state="hidden")
                self.finish_frame(frame_started)
                return
        else:
            opacity = 1.
        layout = projection_layout(width, height, self.images["rest"].width/self.images["rest"].height)
        size = layout["actor_size"]
        if self.current_size != size:
            self.cached.clear()
            self.current_size = size
            self.current_pose = None
        elapsed = time.perf_counter()-self.began
        pose = pose_at(self.track, elapsed) if self.track else "rest"
        if pose not in self.images:
            pose = "soft"
        if pose not in self.cached:
            self.cached[pose] = self.images[pose].resize(size, self.Image.Resampling.LANCZOS)
        now = time.perf_counter()
        state = self.motion.step(now-self.motion_clock, self.track, elapsed)
        face = self.cached[pose].copy()
        # Use the repository's actual eyelid/brow artwork, confined to its eye band.
        band = (0, max(0, round(size[1]*self.eye_band[0])), size[0], round(size[1]*self.eye_band[1]))
        for layer, strength in (("brow", state[5]), ("blink", state[4])):
            if strength > .01:
                if layer not in self.cached:
                    self.cached[layer] = self.images[layer].resize(size, self.Image.Resampling.LANCZOS)
                face.paste(self.Image.blend(face.crop(band), self.cached[layer].crop(band), strength), band)
        pad = max(12, round(size[1]*.035))
        padded = self.Image.new("RGBA", (size[0]+2*pad, size[1]+2*pad))
        padded.paste(face, (pad,pad))
        animated = padded.transform(padded.size, self.Image.Transform.MESH,
                                    mesh(*size, pad, state), self.Image.Resampling.BILINEAR)
        if opacity < 1.:
            animated.putalpha(animated.getchannel("A").point(lambda value: value*opacity))
        self.actor_photo = self.ImageTk.PhotoImage(animated)
        self.canvas.itemconfigure(self.actor, image=self.actor_photo)
        self.canvas.coords(self.actor, *layout["actor_center"])
        qr_size = layout["qr_size"]
        if not self.story and self.qr_image is not None and time.time() < self.qr_until:
            if not getattr(self, "qr_photo", None) or self.qr_photo.width() != qr_size:
                self.qr_photo = self.ImageTk.PhotoImage(self.qr_image.resize((qr_size, qr_size), self.Image.Resampling.NEAREST))
            self.canvas.itemconfigure(self.qr_item, image=self.qr_photo, state="normal")
            self.canvas.coords(self.qr_item, *layout["qr_center"])
        else:
            self.canvas.itemconfigure(self.qr_item, state="hidden")
        self.finish_frame(frame_started)

    def finish_frame(self, frame_started):
        if self.controls and self.controls.winfo_exists():
            self.control_status.set(self.status+"\n"+self.host.api.public_url)
        self.root.after(max(1, round(1000/30-(time.perf_counter()-frame_started)*1000)), self.frame)

    def close(self):
        self.closing = True
        import winsound
        if self.story:
            self.end_story("cancelled")
        else:
            winsound.PlaySound(None, 0)
        self.host.stop.set()
        self.host.thread.join(timeout=2)
        self.root.destroy()

    def run(self):
        self.root.mainloop()


def main():
    if sys.platform != "win32":
        raise RuntimeError("This renderer requires Windows")
    from .configure_local import configure
    from .local import LocalServer
    # pythonw has no console: keep worker failures available for diagnosis.
    import logging
    from logging.handlers import RotatingFileHandler
    (ROOT / "work").mkdir(exist_ok=True)
    handler = RotatingFileHandler(ROOT / "work" / "server.log", maxBytes=2_000_000,
                                  backupCount=2, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logging.getLogger("popov").addHandler(handler)
    configure(ROOT)
    api = LocalServer(ROOT)
    try:
        Projector(Host(api)).run()
    finally:
        api.close()


if __name__ == "__main__":
    main()
