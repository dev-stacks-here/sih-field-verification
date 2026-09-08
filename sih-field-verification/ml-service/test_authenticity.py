import io
import json
import urllib.request
from PIL import Image

def test():
    img = Image.new("RGB", (224, 224), color=(180, 50, 120))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    raw = buf.getvalue()

    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    part = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="test.jpg"\r\n'
        f"Content-Type: image/jpeg\r\n\r\n"
    ).encode("utf-8")
    body = part + raw + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request(
        "http://localhost:8000/classify",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        print("Classify response:")
        print(json.dumps(res, indent=2))
        assert "authenticity" in res
        print("SUCCESS: authenticity key present!")
        print("Authenticity score:", res["authenticity"]["authenticity_score"])
        print("Verdict:", res["authenticity"]["verdict"])

if __name__ == "__main__":
    test()
