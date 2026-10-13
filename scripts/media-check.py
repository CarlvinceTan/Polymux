#!/usr/bin/env python3
"""media-check.py <proof-dir>: automated part of the review-cards pre-publish media check.
Prints PASS<TAB>sha256<TAB>file or FAIL<TAB>reason<TAB>file for each .png/.mp4/.mov.
.mov always FAILs: publish_proof uploads only .png/.mp4, so a .mov card link would be dead.
Exit 3 (message on stderr) when Pillow or ffprobe/ffmpeg is missing for the files present, so callers
fail loudly instead of holding every file back. Test hooks: MC_NOPIL=1, MC_FFPROBE, MC_FFMPEG.
Checks: decodes as a real image/video, not tiny, not mostly empty space, tightly cropped (no large
uniform border), no duplicate file (sha256) within the run; videos need a video stream, >0.3 s, and ~3 sampled frames (ffmpeg) that pass the image checks.
Relevance to the card and Before/After labelling still need a human or agent reviewer."""
import hashlib, json, os, shutil, subprocess, sys, tempfile
FFPROBE = os.environ.get("MC_FFPROBE", "ffprobe"); FFMPEG = os.environ.get("MC_FFMPEG", "ffmpeg")
def pil():  # PIL from the user site of the real home too (lanes and tests may run with another HOME)
    import glob, pwd, site
    h = pwd.getpwuid(os.getuid()).pw_dir
    for d in glob.glob(h + "/Library/Python/*/lib/python/site-packages") + glob.glob(h + "/.local/lib/python3*/site-packages"):
        site.addsitedir(d)
def have_pil():
    if os.environ.get("MC_NOPIL"): return False
    try:
        import PIL
    except ImportError:
        pil()
        try:
            import PIL
        except ImportError:
            return False
    return True
def img(p):
    from PIL import Image
    try:
        im = Image.open(p); im.verify(); im = Image.open(p).convert("RGB")
    except Exception as e:
        return "not a valid image (%s)" % type(e).__name__
    w, h = im.size
    if w < 64 or h < 32: return "too small (%dx%d)" % (w, h)
    s = im.resize((120, 120)); cols = s.getcolors(120 * 120) or []
    if max(c for c, _ in cols) > 0.9 * 120 * 120: return "mostly empty space (one colour > 90%)"
    from PIL import ImageChops
    bg = Image.new("RGB", im.size, im.getpixel((0, 0)))
    box = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > 12 else 0).getbbox()
    if not box: return "blank"
    if (box[2] - box[0]) * (box[3] - box[1]) < 0.6 * w * h: return "not tightly cropped (empty border)"
    return ""
def vid(p):
    try:
        r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_type:format=duration",
                            "-of", "json", p], capture_output=True, text=True, timeout=30)
        d = json.loads(r.stdout or "{}")
    except Exception as e:
        return "ffprobe failed (%s)" % type(e).__name__
    if not any(s.get("codec_type") == "video" for s in d.get("streams", [])): return "no video stream"
    dur = float(d.get("format", {}).get("duration") or 0)
    if dur < 0.3: return "too short"
    with tempfile.TemporaryDirectory() as td:
        for i, frac in enumerate((0.25, 0.5, 0.75)):
            fp = os.path.join(td, "f%d.png" % i)
            r = subprocess.run([FFMPEG, "-v", "error", "-ss", "%.3f" % (dur * frac), "-i", p, "-frames:v", "1", "-y", fp],
                               capture_output=True, timeout=60)
            if r.returncode or not os.path.isfile(fp): return "frame %d at %.1fs could not be extracted" % (i + 1, dur * frac)
            why = img(fp)
            if why: return "frame %d at %.1fs: %s" % (i + 1, dur * frac, why)
    return ""
seen = {}
d = sys.argv[1]
exts = {f.lower().rsplit(".", 1)[-1] for f in os.listdir(d) if os.path.isfile(os.path.join(d, f))}
if exts & {"png", "mp4"} and not have_pil():
    sys.exit(print("media-check: Pillow missing; run scripts/bootstrap-mac.sh (python3 -m pip install --user Pillow)", file=sys.stderr) or 3)
if "mp4" in exts and not (shutil.which(FFPROBE) and shutil.which(FFMPEG)):
    sys.exit(print("media-check: ffprobe/ffmpeg missing; run scripts/bootstrap-mac.sh (brew install ffmpeg)", file=sys.stderr) or 3)
for f in sorted(os.listdir(d)):
    p = os.path.join(d, f); ext = f.lower().rsplit(".", 1)[-1]
    if ext not in ("png", "mp4", "mov") or not os.path.isfile(p): continue
    sha = hashlib.sha256(open(p, "rb").read()).hexdigest()
    why = "duplicate of " + seen[sha] if sha in seen else (img(p) if ext == "png" else
        ".mov is not uploaded by publish_proof; record .mp4" if ext == "mov" else vid(p))
    seen.setdefault(sha, f)
    print("FAIL\t%s\t%s" % (why, f) if why else "PASS\t%s\t%s" % (sha, f))
