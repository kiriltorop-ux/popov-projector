"""Export a synchronized full figure and facial close-up using the live renderer."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import imageio_ffmpeg
from speech_core import SpeechCore, choose_answer

ROOT = Path(__file__).resolve().parents[1]


def export(text, destination, close_up=False):
    wav, track = SpeechCore().synthesize(text)
    with tempfile.TemporaryDirectory(prefix="popov-movie-") as temp:
        folder = Path(temp)
        (folder/"take.wav").write_bytes(wav)
        (folder/"take.json").write_text(json.dumps(track))
        subprocess.run([ROOT/"Пульт Попова.app/Contents/MacOS/Projector","--frames",temp],check=True)
        filters = ("[0:v]split[full][face];"
                   "[full]scale=400:720:force_original_aspect_ratio=decrease,"
                   "pad=400:720:(ow-iw)/2:(oh-ih)/2[left];"
                   "[face]crop=iw*0.76:ih*0.28:iw*0.12:0,scale=880:720[right];"
                   "[left][right]hstack=inputs=2[v]")
        if close_up:
            filters = "[0:v]crop=iw:iw*9/16:0:0,scale=1024:576,setsar=1[v]"
        # Encode in the destination directory so the final replace is atomic.
        with tempfile.TemporaryDirectory(dir=destination.parent) as staging:
            target = Path(staging)/"movie.mp4"
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),"-loglevel","error","-y",
                "-framerate","30","-i",str(folder/"%04d.png"),"-i",str(folder/"take.wav"),
                "-filter_complex",filters,"-map","[v]","-map","1:a",
                "-af","adelay=250:all=1,apad","-shortest","-c:v","libx264","-crf","16",
                "-pix_fmt","yuv420p","-c:a","aac","-b:a","128k","-movflags","+faststart",str(target)],
                check=True)
            target.replace(destination)
    print(f"{destination}  ({track['seconds']:.2f} с речи)")

if __name__ == "__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("text")
    p.add_argument("--ask",action="store_true")
    p.add_argument("--close-up", action="store_true", help="Только лицо крупным планом")
    p.add_argument("--out",type=Path,required=True)
    args=p.parse_args()
    export(choose_answer(args.text) if args.ask else args.text,args.out.resolve(),args.close_up)
