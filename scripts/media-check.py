#!/usr/bin/env python3
"""media-check.py <proof-dir>: automated part of the review-cards pre-publish media check.
Prints PASS<TAB>sha256<TAB>file or FAIL<TAB>reason<TAB>file for each .png/.mp4/.mov.
Checks: decodes as a real image/video, not tiny, not mostly empty space, tightly cropped (no large
uniform border), no duplicate file (sha256) within the run; videos need a video stream and >0.3 s.
Relevance to the card and Before/After labelling still need a human or agent reviewer."""
import hashlib, json, os, subprocess, sys
def pil():  # PIL from the user site of the real home too (lanes and tests may run with another HOME)
    import glob, pwd, site
    h = pwd.getpwuid(os.getuid()).pw_dir
    for d in glob.glob(h + "/Library/Python/*/lib/python/site-packages") + glob.glob(h + "/.local/lib/python3*/site-packages"):
        site.addsitedir(d)
def img(p):
    try:
        from PIL import Image
    except ImportError:
        pil()
        try:
            from PIL import Image
        except ImportError:
            return "PIL missing, cannot check"
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
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type:format=duration",
                            "-of", "json", p], capture_output=True, text=True, timeout=30)
        d = json.loads(r.stdout or "{}")
    except Exception as e:
        return "ffprobe failed (%s)" % type(e).__name__
    if not any(s.get("codec_type") == "video" for s in d.get("streams", [])): return "no video stream"
    if float(d.get("format", {}).get("duration") or 0) < 0.3: return "too short"
    return ""
seen = {}
d = sys.argv[1]
for f in sorted(os.listdir(d)):
    p = os.path.join(d, f); ext = f.lower().rsplit(".", 1)[-1]
    if ext not in ("png", "mp4", "mov") or not os.path.isfile(p): continue
    sha = hashlib.sha256(open(p, "rb").read()).hexdigest()
    why = "duplicate of " + seen[sha] if sha in seen else (img(p) if ext == "png" else vid(p))
    seen.setdefault(sha, f)
    print("FAIL\t%s\t%s" % (why, f) if why else "PASS\t%s\t%s" % (sha, f))
